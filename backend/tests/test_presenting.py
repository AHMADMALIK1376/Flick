"""Flick's natural voice, auto-present ("present this for me") and raising a hand mid-talk."""

import asyncio

import pytest
from fastapi.testclient import TestClient

from flick.api import create_app
from flick.presenter import CLOSING, CONTINUE, GREETING
from flick.text import parse_present_command
from flick.voice import can_voice, split_sentences

from flick.llm import SearchResult

from .conftest import FakeLLM, FakeVoice, make_pptx, make_service, make_speaker

EXPLANATIONS = {
    1: "Welcome to transformers. They changed how machines read text.",
    2: "Attention lets each word look at every other word. Think of a group chat where everyone can reply to anyone.",
    3: "The results beat older models. That is why everyone uses them now.",
}


async def load_deck(service):
    deck = await service.load_deck("/talks/AI.pptx", data=make_pptx(["Transformers", "Attention", "Results"]), prepare=False)
    service.db.save_explanations(deck.id, EXPLANATIONS)
    return deck


async def wait_for(predicate, timeout=5.0):
    """Waits until predicate() is true (the talk runs in the background)."""
    loop = asyncio.get_running_loop()
    end = loop.time() + timeout
    while not predicate():
        if loop.time() > end:
            raise AssertionError("timed out")
        await asyncio.sleep(0.01)


# ── Text helpers ────────────────────────────────────────────────────────────


def test_split_sentences():
    assert split_sentences("One. Two? Three! four") == ["One.", "Two?", "Three! four"]


def test_can_voice_english_not_urdu_script():
    assert can_voice("Row level security keeps data safe.")
    assert can_voice("Yeh slide RLS ke baare mein hai.")  # Roman Urdu
    assert not can_voice("یہ سلائیڈ کس بارے میں ہے؟")


@pytest.mark.parametrize(
    "text, presenting, expected",
    [
        ("Flick, present this for me", False, "start"),
        ("Flick, presentation shuru karo", False, "start"),
        ("stop presenting", True, "stop"),
        ("continue", True, "continue"),
        ("next slide", True, "next"),
        ("go back", True, "previous"),
        ("next slide", False, None),  # not presenting: not a command
        ("What is the presentation layer in the OSI model?", False, None),
        ("How do I give a good presentation?", False, None),
        ("explain this slide", False, None),
    ],
)
def test_present_commands(text, presenting, expected):
    assert parse_present_command(text, presenting) == expected


# ── Speaker ─────────────────────────────────────────────────────────────────


async def test_speaker_says_in_order_and_stop_cuts_off(tmp_path):
    speaker = make_speaker(tmp_path)
    first, second = speaker.say("One two three."), speaker.say("Four five six.")
    assert await first and await second
    assert len(speaker.player.played) == 2

    long = speaker.say(" ".join(["word"] * 200) + ".")  # ~4 s of audio
    queued = speaker.say("Never said.")
    await asyncio.sleep(0.1)
    speaker.stop()
    assert await long is False and await queued is False
    speaker.close()


async def test_speaker_caches_audio(tmp_path):
    voice = FakeVoice()
    speaker = make_speaker(tmp_path, voice)
    await speaker.say("Same sentence.")
    await speaker.say("Same sentence.")
    assert voice.spoken.count("Same sentence.") == 1  # made once, played twice
    speaker.close()


# ── Answers in Flick's voice ────────────────────────────────────────────────


async def test_answers_are_voiced_by_the_backend(db, tmp_path):
    speaker = make_speaker(tmp_path)
    service = make_service(db, FakeLLM(search=SearchResult("Attention links words. It is fast.", [], False)), speaker=speaker)
    await load_deck(service)
    events = []
    service.events.publish = lambda kind, data: events.append((kind, data))

    answer = await service.ask("Flick, what is attention?")
    assert answer.voiced
    deltas = [d for k, d in events if k == "answer_delta"]
    assert deltas and all(d["voiced"] for d in deltas)  # the screens stay quiet
    await speaker.idle()
    assert "Attention links words." in speaker.played_texts
    speaker.close()


async def test_windows_voice_setting_leaves_speech_to_the_screens(db, tmp_path):
    speaker = make_speaker(tmp_path)
    service = make_service(db, FakeLLM(search=SearchResult("Attention links words.", [], False)), speaker=speaker)
    service.db.update_settings({"voice": "windows"})
    await load_deck(service)
    answer = await service.ask("Flick, what is attention?")
    assert not answer.voiced and speaker.played_texts == []
    speaker.close()


async def test_errors_are_never_voiced(db, tmp_path):
    speaker = make_speaker(tmp_path)
    service = make_service(db, FakeLLM(fail="network"), speaker=speaker)
    await load_deck(service)
    answer = await service.ask("Flick, what is attention?")
    assert answer.origin == "error" and not answer.voiced and speaker.played_texts == []
    speaker.close()


# ── Presenting ──────────────────────────────────────────────────────────────


async def test_presents_the_whole_deck(db, tmp_path):
    speaker = make_speaker(tmp_path)
    service = make_service(db, speaker=speaker)
    await load_deck(service)
    states = []
    original = service.events.publish
    service.events.publish = lambda kind, data: (states.append(data["state"]) if kind == "present" else None, original(kind, data))

    service.start_presenting()
    await wait_for(lambda: service.presenter.state == "finished")

    assert service.shown_slides == [1, 2, 3]  # PowerPoint was moved slide by slide
    said = speaker.played_texts
    assert said[0] == "Welcome to transformers." and said[-1] == CLOSING
    assert GREETING not in said  # slide 1 already greets the room: no double hello
    for text in EXPLANATIONS.values():
        for sentence in split_sentences(text):
            assert sentence in said
    assert said.index("Welcome to transformers.") < said.index("Attention lets each word look at every other word.")
    assert "presenting" in states and states[-1] == "finished"
    speaker.close()


async def test_raise_hand_answers_then_continues(db, tmp_path):
    speaker = make_speaker(tmp_path)
    service = make_service(db, FakeLLM(search=SearchResult("It means focus. Each word picks what matters.", [], False)), speaker=speaker)
    await load_deck(service)

    service.start_presenting()
    await wait_for(lambda: service.presenter.slide == 2 and service.presenter.state == "presenting")

    service.question_starting()  # the Ask hotkey / mic: a raised hand
    assert service.presenter.state == "paused" and service.presenter.paused_for == "question"

    answer = await service.ask("Flick, what does attention mean?")
    assert answer.origin == "slides" and answer.voiced
    await wait_for(lambda: service.presenter.state == "finished")

    said = speaker.played_texts
    assert said.index("It means focus.") < said.index(CONTINUE) < said.index(CLOSING)
    speaker.close()


async def test_next_previous_and_stop(db, tmp_path):
    speaker = make_speaker(tmp_path)
    service = make_service(db, speaker=speaker)
    await load_deck(service)
    service.start_presenting()
    await wait_for(lambda: service.presenter.slide == 1 and service.presenter.state == "presenting")

    service.presenter.go(+1)
    await wait_for(lambda: service.presenter.slide == 2)
    service.presenter.stop()
    assert service.presenter.state == "idle"
    await asyncio.sleep(0.1)
    assert service.shown_slides[-1] == 2
    speaker.close()


async def test_voice_command_starts_presenting(db, tmp_path):
    speaker = make_speaker(tmp_path)
    service = make_service(db, speaker=speaker)
    await load_deck(service)
    reply = await service.ask("Flick, present this for me")
    assert reply.origin == "greeting"  # not an answer: nothing shown on the card
    assert service.presenter.active
    service.presenter.stop()
    speaker.close()


async def test_presenting_needs_a_deck_and_the_voice(db, tmp_path):
    from flick.service import UserError

    service = make_service(db, speaker=make_speaker(tmp_path, FakeVoice(ready=False)))
    with pytest.raises(UserError, match="Load your presentation"):
        service.start_presenting()
    await load_deck(service)
    with pytest.raises(UserError, match="getting ready"):
        service.start_presenting()


def test_present_api(db, tmp_path):
    speaker = make_speaker(tmp_path)
    service = make_service(db, speaker=speaker)
    token = {"X-Flick-Token": "t"}
    with TestClient(create_app(service, "t")) as c:
        assert c.post("/present/start", headers=token, json={}).status_code == 400  # no deck yet
        c.post("/decks/upload", headers=token, files={"file": ("Talk.pptx", make_pptx(["A", "B"]))})
        r = c.post("/present/start", headers=token, json={"from_slide": 2})
        assert r.status_code == 200 and r.json()["slide"] == 2
        assert c.post("/present/pause", headers=token).json()["state"] in ("paused", "starting")
        assert c.post("/present/stop", headers=token).json()["state"] == "idle"
        assert c.get("/present", headers=token).json()["state"] == "idle"
        assert {v["id"] for v in c.get("/voices", headers=token).json()} >= {"af_heart", "bm_george"}
        assert c.get("/status", headers=token).json()["voice"]["ready"] is True
        assert c.post("/present/start").status_code == 401


def test_raise_hand_through_the_api(db, tmp_path):
    """The mic/hotkey calls /question-starting: it must pause the talk (not error)."""
    import time

    speaker = make_speaker(tmp_path)
    service = make_service(db, speaker=speaker)
    token = {"X-Flick-Token": "t"}
    with TestClient(create_app(service, "t")) as c:
        c.post("/decks/upload", headers=token, files={"file": ("Talk.pptx", make_pptx(["A", "B", "C"]))})
        c.post("/present/start", headers=token, json={})
        for _ in range(100):
            if c.get("/present", headers=token).json()["state"] == "presenting":
                break
            time.sleep(0.02)
        assert c.post("/question-starting", headers=token).status_code == 204
        status = c.get("/present", headers=token).json()
        assert status["state"] == "paused" and status["paused_for"] == "question"
        c.post("/present/stop", headers=token)


# ── Stop really stops ───────────────────────────────────────────────────────


class StreamThenStop(FakeLLM):
    """Streams an answer; Stop is pressed after the first sentence."""

    def __init__(self, service_ref, **kw):
        super().__init__(**kw)
        self.service_ref = service_ref

    async def stream_search(self, system, message, max_tokens, max_searches, on_text, on_search):
        await on_text("First sentence.")
        self.service_ref[0].stop_talking()  # the Stop button on the card
        await on_text("Second sentence.")
        await on_text("Third sentence.")
        return SearchResult("First sentence. Second sentence. Third sentence.", [], False)

    async def stream_complete(self, system, message, max_tokens, on_text):
        await on_text("First sentence.")
        self.service_ref[0].stop_talking()
        await on_text("Second sentence.")
        return "First sentence. Second sentence."


async def test_stop_silences_an_answer_that_is_still_streaming(db, tmp_path):
    speaker = make_speaker(tmp_path)
    ref = []
    service = make_service(db, StreamThenStop(ref), speaker=speaker)
    ref.append(service)
    await load_deck(service)
    await service.ask("Flick, what is attention?")
    assert speaker.played_texts == ["First sentence."]  # nothing after Stop
    speaker.close()


async def test_stop_silences_a_live_explanation(db, tmp_path):
    speaker = make_speaker(tmp_path)
    ref = []
    service = make_service(db, StreamThenStop(ref), speaker=speaker)
    ref.append(service)
    deck = await service.load_deck("/talks/X.pptx", data=make_pptx(["A", "B"]), prepare=False)  # no ready explanations
    from flick.text import SlideTarget

    await service.explain_slide(SlideTarget("number", 2, 0), "explain slide 2")
    assert speaker.played_texts == ["First sentence."]
    speaker.close()


async def test_stop_then_start_runs_only_one_talk(db, tmp_path):
    speaker = make_speaker(tmp_path)
    service = make_service(db, speaker=speaker)
    await load_deck(service)
    service.start_presenting()
    await wait_for(lambda: service.presenter.state == "presenting")
    first = service.presenter._task
    service.presenter.stop()
    service.start_presenting()
    await asyncio.sleep(0.05)
    assert first.cancelled() or first.done()
    service.presenter.stop()
    speaker.close()


def test_voice_stop_and_say_api(db, tmp_path):
    speaker = make_speaker(tmp_path)
    service = make_service(db, speaker=speaker)
    h = {"X-Flick-Token": "t"}
    with TestClient(create_app(service, "t")) as c:
        assert c.post("/voice/say", headers=h, json={"text": "Hello there. How are you?"}).status_code == 204
        assert c.post("/voice/stop", headers=h).status_code == 204
    assert speaker.played_texts[:2] == ["Hello there.", "How are you?"]


# ── PowerPoint follows the talk ─────────────────────────────────────────────


def test_same_file_matches_path_or_name():
    from flick.powerpoint import _same_file

    assert _same_file(r"C:\Users\Ahmad\Talk.pptx", "C:/Users/Ahmad/Talk.pptx", "Talk.pptx")
    assert _same_file(r"D:\Downloads\Talk.pptx", "upload/Talk.pptx", "Talk.pptx")
    assert not _same_file(r"D:\Other.pptx", "upload/Talk.pptx", "Talk.pptx")


async def test_show_slide_explains_what_to_do():
    from flick.powerpoint import PowerPointBridge

    bridge = PowerPointBridge(query=lambda k: None, platform="win32", show=lambda n, p, name: "protected")
    problem = await bridge.show_slide(2, "upload/Talk.pptx", "Talk.pptx")
    assert "Enable Editing" in problem and "Talk.pptx" in problem
    ok = PowerPointBridge(query=lambda k: None, platform="win32", show=lambda n, p, name: "ok")
    assert await ok.show_slide(2, None, None) is None


async def test_presenter_reports_when_powerpoint_does_not_follow(db, tmp_path):
    speaker = make_speaker(tmp_path)
    service = make_service(db, speaker=speaker)
    service.bridge._show = lambda n, p, name: "not_open"
    await load_deck(service)
    service.start_presenting()
    await wait_for(lambda: service.presenter.status()["powerpoint"] is not None)
    assert "isn't open in PowerPoint" in service.presenter.status()["powerpoint"]
    service.presenter.stop()
    speaker.close()


async def test_shutting_down_while_a_sentence_is_being_made_does_not_hang(tmp_path):
    import threading

    from .conftest import FakeVoice

    release = threading.Event()

    class SlowVoice(FakeVoice):
        def synthesize(self, text, voice, speed):
            release.wait(2)  # still making the audio when the app shuts down
            return super().synthesize(text, voice, speed)

    speaker = make_speaker(tmp_path, voice=SlowVoice())
    speaker.say("A long sentence that takes a while to make.")
    await asyncio.sleep(0.05)
    worker = speaker._worker
    worker.cancel()  # what the app's event loop does on shutdown
    try:
        await asyncio.wait_for(asyncio.gather(worker, return_exceptions=True), 1)
    finally:
        release.set()
        speaker.close()
    assert worker.done()


async def test_stop_while_a_sentence_is_being_made_keeps_the_speaker_working(tmp_path):
    speaker = make_speaker(tmp_path)
    first = speaker.say("First sentence here.")
    speaker.stop()  # Stop: skip it, but stay ready
    assert await first is False
    assert await asyncio.wait_for(speaker.say("Next one."), 3) is True
    speaker.close()
