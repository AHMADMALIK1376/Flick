"""English, Urdu, and Urdu + English mixed (the way Pakistani teachers talk)."""

import asyncio
import json

from fastapi.testclient import TestClient

from flick import lessons, prompts
from flick.api import create_app
from flick.presenter import LINES
from flick.voice import has_urdu, split_sentences, urdu_voice_like

from .conftest import FakeLLM, make_pptx, make_service, make_speaker
from .test_presenting import wait_for


def test_urdu_sentences_are_split_for_speaking():
    text = "السلام علیکم! آج ہم RLS سیکھیں گے۔ سوچیں، یہ کیوں ضروری ہے؟ Simple سی بات ہے۔"
    assert split_sentences(text) == ["السلام علیکم!", "آج ہم RLS سیکھیں گے۔", "سوچیں، یہ کیوں ضروری ہے؟", "Simple سی بات ہے۔"]
    assert split_sentences("Hello there. How are you?") == ["Hello there.", "How are you?"]


def test_urdu_voice_follows_the_english_voices_gender():
    assert urdu_voice_like("af_heart") == "hf_alpha" and urdu_voice_like("am_michael") == "hm_omega"


def test_language_rules_reach_every_prompt_that_writes_speech():
    for lang in ("ur", "mix"):
        assert "LANGUAGE" in prompts.live_system(lang) and "LANGUAGE" in prompts.explain_system(lang)
        assert "LANGUAGE" in lessons.lesson_system("story", True, lang)
        assert "LANGUAGE" in lessons.draw_system("class", True, lang)
    assert "LANGUAGE" not in prompts.live_system("en") and prompts.explain_system("en") == prompts.EXPLAIN_SYSTEM
    assert "Never write Urdu in English letters" in prompts.language_rule("mix")
    assert "کرتی ہوں" in prompts.language_rule("ur", female=True)
    assert "کرتا ہوں" in prompts.language_rule("ur", female=False)


def test_flicks_own_lines_exist_in_every_language():
    for lang in ("ur", "mix"):
        lines = LINES[lang]
        for kind in ("greeting", "study_greeting", "closing", "study_closing", "asked_draw", "asked_example",
                     "again_same", "again_back", "again_ahead", "return"):
            assert has_urdu(str(lines[kind])), (lang, kind)
        assert "{n}" in lines["again_back"] and "{n}" in lines["return"]


def test_plan_keys_keep_languages_apart():
    assert lessons.plan_key("story", True, "ur") == "story@study#ur"
    assert lessons.plan_key("class+draw", False, "en") == "class+draw"
    assert lessons.language_of("story+draw@study#mix") == "mix"
    assert lessons.split_style("story+draw@study#mix") == ("story", "draw")


async def test_an_urdu_talk_writes_new_slide_text_in_urdu(db, tmp_path):
    systems = []

    def reply(system, message):
        systems.append(system)
        return json.dumps({"text": "تو basically، یہ slide security کے بارے میں ہے۔", "drawing": None})

    speaker = make_speaker(tmp_path)
    service = make_service(db, FakeLLM(complete_text=reply), speaker=speaker)
    deck = await service.load_deck("/t/X.pptx", data=make_pptx(["Intro", "RLS"]), prepare=False)
    db.save_explanations(deck.id, {1: "English one.", 2: "English two."})  # prepared in English
    db.update_settings({"talk_language": "mix"})
    service.start_presenting()
    await wait_for(lambda: service.presenter.state == "finished", timeout=10)
    said = speaker.played_texts
    assert "English one." not in said  # English prepared text is not used in a mixed talk
    assert said[0] == LINES["mix"]["greeting"] and said[-1] == LINES["mix"]["closing"]
    assert all("LANGUAGE" in s for s in systems)
    assert db.get_lesson(deck.id, 2, "class#mix")
    speaker.close()


async def test_answers_in_urdu_skip_english_prepared_answers(db):
    from flick.models import PredictedQuestion

    llm = FakeLLM()
    service = make_service(db, llm)
    deck = await service.load_deck("/t/X.pptx", data=make_pptx(["Intro"]), prepare=False)
    db.replace_predicted(deck.id, [PredictedQuestion(id="q1", slide=1, question="What is RLS?", answer="Prepared English.")])
    db.update_settings({"talk_language": "ur"})
    answer = await service.ask("What is RLS?")
    assert answer.answer != "Prepared English." and llm.search_calls
    assert "LANGUAGE" in llm.search_calls[0][0]


def test_choosing_urdu_lets_the_mic_hear_urdu(db):
    service = make_service(db)
    h = {"X-Flick-Token": "t"}
    with TestClient(create_app(service, "t")) as c:
        s = c.patch("/settings", headers=h, json={"talk_language": "mix"}).json()
        assert s["talk_language"] == "mix" and s["language"] == "auto"
        assert c.patch("/settings", headers=h, json={"urdu_voice": "zz"}).status_code == 400
        assert [v["id"] for v in c.get("/urdu-voices", headers=h).json()][:1] == ["hf_alpha"]
