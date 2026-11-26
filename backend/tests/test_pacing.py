"""Flick talks at a steady pace: no dramatic pauses, no waiting behind work that can wait, short text."""

import asyncio
import threading

from flick import lessons, presenter, prompts
from flick.voice import ANSWERS, OWN_LINES, SOON, speakable, speech_chunks

from .conftest import FakeVoice, make_speaker


def test_dramatic_pauses_become_commas():
    assert speakable("So what if the app forgets? ... Exactly, nothing leaks.") == "So what if the app forgets? Exactly, nothing leaks."
    assert speakable("Picture the canteen... one big menu.") == "Picture the canteen, one big menu."
    assert speakable("That's the idea… simple, but powerful.") == "That's the idea, simple, but powerful."
    assert speakable("The rule lives in the database — not the app — so bugs can't leak.") == (
        "The rule lives in the database, not the app, so bugs can't leak."
    )
    assert speakable("Wait for it...") == "Wait for it."
    assert speakable("Well-known e-commerce apps use it.") == "Well-known e-commerce apps use it."  # hyphens stay
    assert speakable("تو basically، database ہر user کو صرف اپنی rows دکھاتا ہے۔") == "تو basically، database ہر user کو صرف اپنی rows دکھاتا ہے۔"
    assert speech_chunks("...") == []


async def test_what_is_said_is_the_audio_that_was_made_ahead(tmp_path):
    """A sentence with "..." was once said from its raw text, so the audio made ahead was never
    used and the talk went silent while it was made again (40 seconds behind a drawing)."""
    voice = FakeVoice()
    speaker = make_speaker(tmp_path, voice=voice)
    text = "So what if the app forgets? ... Exactly, nothing leaks."
    speaker.prefetch([text], urgent=True)
    assert await speaker.say(text) is True
    assert voice.spoken == [speakable(text)]  # made once, the cleaned text
    assert await speaker.say("...") is True  # nothing to say is not an error
    speaker.close()


async def test_spare_time_audio_is_made_most_needed_first(tmp_path):
    gate = threading.Event()

    class HeldVoice(FakeVoice):
        def synthesize(self, text, voice, speed):
            gate.wait(2)
            return super().synthesize(text, voice, speed)

    voice = HeldVoice()
    speaker = make_speaker(tmp_path, voice=voice)
    speaker.prefetch(["Held first."], priority=ANSWERS)  # occupies the worker until the gate opens
    await asyncio.sleep(0.1)
    speaker.prefetch(["Answer one.", "Answer two."], priority=ANSWERS)
    speaker.prefetch(["Carry on."], priority=OWN_LINES)
    speaker.prefetch(["Next slide."], priority=SOON)
    speaker.prefetch(["Answer one."], priority=SOON)  # needed sooner now: moves up
    gate.set()
    for _ in range(200):
        if len(voice.spoken) == 5:
            break
        await asyncio.sleep(0.02)
    assert voice.spoken == ["Held first.", "Next slide.", "Answer one.", "Carry on.", "Answer two."]
    speaker.close()


async def test_a_slide_waits_for_its_first_words_not_mid_sentence(tmp_path):
    voice = FakeVoice()
    speaker = make_speaker(tmp_path, voice=voice)
    texts = ["Short one.", "A much longer second sentence that would otherwise still be in the making."]
    await speaker.ready(texts, buffer_s=10)
    assert voice.spoken == texts  # both made before the first is played
    await speaker.ready(texts)  # made already: returns at once
    assert len(voice.spoken) == 2
    speaker.close()


def test_talks_are_short_and_plain():
    assert "60 to 110 words" in prompts.EXPLAIN_SYSTEM
    assert '"..."' in prompts.TEACHER_VOICE and "Short sentences" in prompts.TEACHER_VOICE
    assert "50-100 words" in lessons.lesson_system("story", study=True)
    assert "3-5 steps" in lessons.DRAW_RULES and "ONE short spoken sentence" in lessons.DRAW_RULES
    assert "2-3 short sentences" in prompts.LIVE_SYSTEM
    assert prompts.VOICE_VERSION >= 3  # saved long explanations are written again


def test_flicks_own_lines_are_short():
    for line in [presenter.CLOSING, presenter.STUDY_CLOSING, *presenter.CONTINUES, *presenter.DRAW_INTROS_DEFAULT]:
        assert len(line.split()) <= 14, line


def test_the_voice_speaks_at_a_teachers_pace(tmp_path):
    from flick.db import Database
    from flick.models import Settings

    assert Settings().voice_speed == 1.1
    old = Database(tmp_path / "old.db")
    old.update_settings({"voice_speed": 1.0})  # the old normal, saved with the other settings
    old.brisker_voice()
    assert old.get_settings().voice_speed == 1.1
    picked = Database(tmp_path / "picked.db")
    picked.update_settings({"voice_speed": 0.9})  # chosen on purpose: kept
    picked.brisker_voice()
    assert picked.get_settings().voice_speed == 0.9
    old.update_settings({"voice_speed": 1.0})  # chosen again after the move: kept too
    old.brisker_voice()
    assert old.get_settings().voice_speed == 1.0
