"""Commands about slides ("go back to slide 6 and explain it again") vs questions."""

import asyncio
import json

import pytest

from flick.text import SlideTarget, needs_routing, parse_slide_request

from .conftest import FakeLLM, make_pptx, make_service, make_speaker
from .test_presenting import wait_for


@pytest.mark.parametrize(
    "text, slide, action, board",
    [
        ("Hey Flick, go to slide number 6 and explain me again slide number 6", 6, "explain", "auto"),
        ("Ma'am, can you please explain slide number 6?", 6, "explain", "auto"),
        ("Go back to slide 6 and explain it with an example", 6, "explain", "example"),
        ("go back to slide six and draw it", 6, "explain", "draw"),
        ("Go back to slide 6 and visualize it on the board", 6, "explain", "draw"),
        ("Take us back to slide 2 and repeat it", 2, "explain", "auto"),
        ("Slide 6 dobara samjhao", 6, "explain", "auto"),
        ("go to slide 6", 6, "goto", "auto"),
        ("open slide 3", 3, "goto", "auto"),
    ],
)
def test_requests(text, slide, action, board):
    r = parse_slide_request(text)
    assert r is not None and r.target == SlideTarget("number", number=slide)
    assert (r.action, r.board) == (action, board)


@pytest.mark.parametrize(
    "text",
    ["Why does slide 3 say the cost is high?", "What is on slide 6?", "Does slide 2 show the policy?",
     "What is row level security?", "next slide"],
)
def test_questions_are_not_commands(text):
    assert parse_slide_request(text) is None


def test_routing_only_for_request_like_text():
    assert needs_routing("Flick, go over the security part again")
    assert needs_routing("take us back to where you talked about policies")
    assert not needs_routing("How do I go back to the main menu in Supabase?")
    assert not needs_routing("What is a policy?")


def slide_texts(n):
    return {i: f"Slide {i} explained." for i in range(1, n + 1)}


async def deck_with(service, n=8):
    deck = await service.load_deck("/talks/Talk.pptx", data=make_pptx([f"Topic {i}" for i in range(1, n + 1)]), prepare=False)
    service.db.save_explanations(deck.id, slide_texts(n))
    return deck


async def test_during_a_talk_it_goes_back_explains_and_returns(db, tmp_path):
    speaker = make_speaker(tmp_path)
    service = make_service(db, speaker=speaker)
    await deck_with(service)
    service.start_presenting(from_slide=8)
    await wait_for(lambda: service.presenter.state == "presenting" and service.presenter.slide == 8)
    service.question_starting()  # the mic: raise hand
    answer = await service.ask("Flick, go to slide number 6 and explain me again slide number 6")
    assert answer.origin == "explain" and "back to slide 8" in answer.answer
    await wait_for(lambda: "Now, back to slide 8." in speaker.played_texts, timeout=10)
    said = speaker.played_texts
    assert said.index("Sure. Let's go back to slide 6.") < said.index("Slide 6 explained.") < said.index("Now, back to slide 8.")
    await wait_for(lambda: service.presenter.state == "finished", timeout=10)
    assert service.shown_slides[-2:] == [6, 8]  # PowerPoint went to 6 and came back to 8
    assert said[-2] == "Slide 8 explained."  # slide 8 again, then the closing
    speaker.close()


async def test_go_back_and_draw_an_example_draws_it(db, tmp_path):
    drawing = {"title": "Example", "elements": [{"id": "a", "type": "box", "x": 100, "y": 100, "w": 200, "h": 90, "label": "Bank", "step": 1},
                                                 {"id": "b", "type": "circle", "x": 600, "y": 300, "r": 60, "label": "Ali", "step": 1}],
               "steps": [{"say": "Here is a bank."}]}

    def reply(system, message):
        return json.dumps({"drawing": drawing})

    speaker = make_speaker(tmp_path)
    service = make_service(db, FakeLLM(complete_text=reply), speaker=speaker)
    await deck_with(service)
    service.start_presenting(from_slide=8)
    await wait_for(lambda: service.presenter.slide == 8)
    events = service.events.subscribe()
    await service.ask("Go back to slide 6 and explain it with an example")
    await wait_for(lambda: "Here is a bank." in speaker.played_texts, timeout=10)
    assert "Let me draw a real-life example." in speaker.played_texts
    seen = [events.get_nowait() for _ in range(events.qsize())]
    assert any(e["type"] == "canvas" and e["data"].get("action") == "open" and e["data"]["slide"] == 6 for e in seen)
    service.presenter.stop()
    speaker.close()


async def test_go_to_slide_carries_on_from_there(db, tmp_path):
    speaker = make_speaker(tmp_path)
    service = make_service(db, speaker=speaker)
    await deck_with(service, 4)
    service.start_presenting(from_slide=1)
    await wait_for(lambda: service.presenter.state == "presenting")
    await service.ask("Flick, go to slide 3")
    await wait_for(lambda: service.presenter.state == "finished", timeout=10)
    assert "Now, back to slide" not in " ".join(speaker.played_texts)
    assert speaker.played_texts.index("Slide 3 explained.") < speaker.played_texts.index("Slide 4 explained.")
    assert "Slide 2 explained." not in speaker.played_texts or speaker.played_texts.index("Slide 2 explained.") < speaker.played_texts.index("Slide 3 explained.")
    speaker.close()


async def test_not_presenting_it_moves_powerpoint_and_comes_back(db, tmp_path):
    speaker = make_speaker(tmp_path)
    service = make_service(db, slide_answer="8", speaker=speaker)
    await deck_with(service)
    answer = await service.ask("Flick, go back to slide 6 and explain it again")
    assert answer.origin == "explain" and answer.current_slide == 6
    await wait_for(lambda: service.shown_slides[-1:] == [8], timeout=10)
    assert service.shown_slides == [6, 8]
    speaker.close()


async def test_claude_picks_the_slide_when_none_is_named(db, tmp_path):
    def reply(system, message):
        if "route what someone said" in system:
            assert "4. Topic 4" in message
            return '{"type": "slide", "slide": 4, "action": "explain", "board": "draw"}'
        return "{}"

    speaker = make_speaker(tmp_path)
    service = make_service(db, FakeLLM(complete_text=reply), speaker=speaker)
    await deck_with(service)
    service.start_presenting(from_slide=7)
    await wait_for(lambda: service.presenter.slide == 7)
    answer = await service.ask("Flick, go over the topic four part again and draw it")
    assert "slide 4" in answer.answer and "back to slide 7" in answer.answer
    service.presenter.stop()
    speaker.close()


async def test_slide_that_does_not_exist(db):
    service = make_service(db)
    await deck_with(service, 3)
    answer = await service.ask("Go back to slide 9 and explain it")
    assert answer.origin == "error" and "3 slides" in answer.answer
