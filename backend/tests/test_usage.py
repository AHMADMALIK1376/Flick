"""Token Analyzer: every Claude call is counted under the right card, part and slide."""

import asyncio

from fastapi.testclient import TestClient

from flick import usage
from flick.api import create_app
from flick.llm import SearchResult
from flick.text import SlideTarget

from .conftest import FakeLLM, make_pptx, make_service, make_speaker
from .test_presenting import load_deck, wait_for


def test_prices():
    # Haiku 5.5: $0.10 in, $0.50 out per million; cache read $0.01; search $0.01.
    assert abs(usage.cost_usd("claude-haiku-5-5", 100_000, 0, 0, 0, 0) - 0.01) < 1e-9
    assert abs(usage.cost_usd("claude-haiku-5-5", 10_000, 1_000_000, 0, 0, 0) - 0.501) < 1e-9
    assert abs(usage.cost_usd("claude-haiku-5-5", 0, 0, 0, 100_000, 0) - 0.001) < 1e-9
    assert abs(usage.cost_usd("claude-haiku-5-5", 0, 0, 0, 0, 3) - 0.03) < 1e-9
    # Over 100K prompt tokens every Haiku 5.5 rate is 5x.
    assert abs(usage.cost_usd("claude-haiku-5-5", 200_000, 0, 0, 0, 0) - 0.10) < 1e-9
    assert abs(usage.cost_usd("claude-sonnet-5-5", 1_000_000, 1_000_000, 0, 0, 0) - 12.0) < 1e-9


def test_record_reads_sdk_usage_objects(db):
    class U:
        input_tokens = 500
        output_tokens = 50
        cache_creation_input_tokens = 0
        cache_read_input_tokens = 2000

        class server_tool_use:
            web_search_requests = 2

    meter = usage.UsageMeter(db)
    card = meter.open_card("questions", "Q")
    with usage.tagged(kind="question", card=card, slide=3):
        row = meter.record("claude-haiku-5-5", U())
    assert row["searches"] == 2 and row["cache_read"] == 2000
    c = meter.card(card)
    assert c["totals"]["tokens"] == 2550 and c["by_slide"][0]["slide"] == 3
    assert c["by_kind"][0]["name"] == "Questions from the audience"


async def test_questions_outside_a_talk_share_one_card_per_day(db):
    service = make_service(db, FakeLLM(search=SearchResult("Live answer.", [], True)))
    await service.load_deck("/talks/Talk.pptx", data=make_pptx(["Intro", "Body"]), prepare=False)
    await service.ask("Flick, what is the capital of France?")
    await service.ask("Flick, and of Spain?")
    cards = service.usage.cards()
    assert len(cards) == 1 and cards[0]["type"] == "questions"
    assert cards[0]["totals"]["calls"] == 2 and cards[0]["totals"]["searches"] == 2


async def test_explaining_one_slide_makes_a_slide_card(db):
    service = make_service(db, FakeLLM(complete_text="It shows the body."))
    await service.load_deck("/talks/Talk.pptx", data=make_pptx(["Intro", "Body"]), prepare=False)
    await service.explain_slide(SlideTarget("number", 2, 0), "explain slide 2")
    (card,) = service.usage.cards()
    assert card["type"] == "slide" and card["slide"] == 2 and card["title"] == "Slide 2 explained"
    assert card["by_kind"][0]["kind"] == "explain"


async def test_a_talk_is_one_card_with_parts_per_slide(db, tmp_path):
    speaker = make_speaker(tmp_path)
    service = make_service(db, speaker=speaker)
    await load_deck(service)
    service.start_presenting()
    await wait_for(lambda: service.presenter.state == "presenting")
    await service.ask("Flick, what is attention?")  # a question during the talk
    await asyncio.sleep(0.2)
    service.presenter.stop()
    cards = service.usage.cards()
    talk = next(c for c in cards if c["type"] == "presentation")
    kinds = {k["kind"] for k in talk["by_kind"]}
    assert "question" in kinds
    assert talk["ended_at"] is not None
    assert not any(c["type"] == "questions" for c in cards)  # not a separate card
    speaker.close()


async def test_lesson_reply_is_split_into_talk_and_drawing(db):
    meter = usage.UsageMeter(db)
    card = meter.open_card("study", "S")
    with usage.tagged(kind="talk", card=card, sink=[]) as tag:
        meter.record("claude-haiku-5-5", {"input_tokens": 1000, "output_tokens": 1000})
    meter.split(tag.sink, "drawing", 0.75)
    parts = {k["kind"]: k for k in meter.card(card)["by_kind"]}
    assert parts["drawing"]["output"] == 750 and parts["talk"]["output"] == 250


def test_usage_api(db):
    service = make_service(db)
    meter = service.usage
    card = meter.open_card("slide", "Slide 1 explained", slide=1)
    with usage.tagged(kind="explain", card=card):
        meter.record("claude-haiku-5-5", {"input_tokens": 10, "output_tokens": 5})
    h = {"X-Flick-Token": "t"}
    with TestClient(create_app(service, "t")) as c:
        data = c.get("/usage", headers=h).json()
        assert data["total"]["calls"] == 1 and data["cards"][0]["id"] == card
        assert data["prices"]["claude-haiku-5-5"]["input"] == 0.10
        assert c.get(f"/usage/cards/{card}", headers=h).json()["totals"]["tokens"] == 15
        assert c.delete("/usage", headers=h).status_code == 204
        assert c.get("/usage", headers=h).json()["cards"] == []
