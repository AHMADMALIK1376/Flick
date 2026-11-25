"""Flick talks like a teacher (class) or a friend (study), not like a machine reading slides."""

import json
import re

from flick import lessons, presenter, prompts, service as service_mod
from flick.db import Database

from .conftest import FakeLLM, make_pptx, make_service

BANNED = re.compile(
    r"\b(this slide|as you can see|delve|it is important to note|furthermore|moreover|in conclusion|"
    r"in summary|crucial role|vital role|as an ai)\b",
    re.IGNORECASE,
)


def test_every_prompt_that_writes_speech_carries_the_teacher_voice():
    assert "HOW FLICK TALKS" in prompts.EXPLAIN_SYSTEM
    assert "HOW FLICK TALKS" in prompts.EXPLAIN_BATCH_SYSTEM
    assert "HOW FLICK TALKS" in lessons.lesson_system("story", study=True)
    assert "HOW FLICK TALKS" in lessons.lesson_system("exam", study=False)
    assert "Never read the bullet points back" in prompts.TEACHER_VOICE
    assert "teacher answers a student's question" in prompts.LIVE_SYSTEM


def test_class_and_study_are_spoken_to_differently():
    assert "front of the class" in lessons.lesson_system("professional", study=False)
    assert "their friend" in lessons.lesson_system("professional", study=True)


def test_a_full_talk_is_written_as_one_lesson_not_separate_summaries():
    batch = prompts.EXPLAIN_BATCH_SYSTEM
    assert "ONE teacher giving ONE lesson" in batch and "DIFFERENT kind of link" in batch


def test_flicks_own_lines_sound_human_and_rotate():
    lines = [presenter.GREETING, presenter.STUDY_GREETING, presenter.CLOSING, presenter.STUDY_CLOSING,
             *presenter.CONTINUES, *presenter.DRAW_INTROS_DEFAULT, *service_mod.ONE_MOMENTS]
    for line in lines:
        assert not BANNED.search(line), line
    assert len(set(presenter.CONTINUES)) >= 3 and len(set(presenter.DRAW_INTROS_DEFAULT)) >= 3


def test_rotation_never_repeats_back_to_back(db):
    service = make_service(db)
    p = service.presenter
    said = [p._rotate("continue", presenter.CONTINUES) for _ in range(6)]
    assert all(a != b for a, b in zip(said, said[1:]))


def test_old_voice_text_is_reset_once(tmp_path):
    db = Database(tmp_path / "flick.db")
    db._conn.execute("INSERT INTO settings(key, value) VALUES ('__voice_version', '1')")
    db._conn.commit()
    service = make_service(db)  # an older version of Flick prepared this deck
    assert service.voice_refreshed is False  # nothing was saved yet
    db._conn.execute("UPDATE settings SET value = '1' WHERE key = '__voice_version'")
    db._conn.commit()

    import asyncio

    deck = asyncio.run(service.load_deck("/t/X.pptx", data=make_pptx(["A", "B"]), prepare=False))
    db.save_explanations(deck.id, {1: "This slide discusses A.", 2: "This slide discusses B."})
    again = make_service(db)
    assert again.voice_refreshed is True and db.get_explanations(deck.id) == {}
    assert make_service(db).voice_refreshed is False  # only once


async def test_rewrite_explanations_writes_the_active_deck_again(db):
    def reply(system, message):
        return json.dumps({"explanations": [{"slide": 1, "text": "Hi everyone! Ever wondered why..."},
                                            {"slide": 2, "text": "So here's the thing."}]})

    service = make_service(db, FakeLLM(complete_text=reply))
    db.update_settings({"anthropic_api_key": "sk-test"})
    deck = await service.load_deck("/t/X.pptx", data=make_pptx(["A", "B"]), prepare=False)
    assert await service.rewrite_explanations() == 2
    assert db.get_explanations(deck.id)[2] == "So here's the thing."
