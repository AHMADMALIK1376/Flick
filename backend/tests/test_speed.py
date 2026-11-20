"""Phase 2: matching by meaning, ready-made explanations, streaming, speech, caching."""

import json

import numpy as np
import pytest
from fastapi.testclient import TestClient

from flick import engine, prompts
from flick.api import create_app
from flick.llm import SearchResult, SentenceStream
from flick.models import Deck, PredictedQuestion, Slide
from flick.semantic import best_semantic_match, to_blob
from flick.text import is_plain_explain_request

from .conftest import FakeEmbedder, FakeLLM, FakeTranscriber, make_pptx, make_service

QUESTIONS = [
    ("q1", 4, "What is Row-Level Security and how does it differ from adding a WHERE clause in the app?", "RLS ANSWER"),
    ("q2", 4, "What does the EXPLAIN cost check actually do?", "EXPLAIN ANSWER"),
    ("q3", 5, "Why use synthetic data instead of real university records?", "SYNTHETIC ANSWER"),
    ("q4", 8, "Does enforcing security in the database slow queries down?", "SPEED ANSWER"),
]


def scripted_llm(explanations=None):
    """Answers question-prediction prompts with QUESTIONS and explanation prompts with `explanations`."""

    def reply(system, message):
        if "explanations" in system:
            nums = [int(n) for n in __import__("re").findall(r"<slide_to_explain>\nSlide (\d+)", message)]
            items = [{"slide": n, "text": (explanations or {}).get(n, f"Ready explanation of slide {n}.")} for n in nums]
            return json.dumps({"explanations": items})
        if "predict the questions" in system:
            return json.dumps({"questions": [{"slide": s, "question": q, "answer": a} for _, s, q, a in QUESTIONS]})
        return "Live explanation. It has two sentences."

    return FakeLLM(complete_text=reply)


async def ready_deck(service):
    deck = await service.load_deck(
        "/talks/SafeQuery.pptx", data=make_pptx([f"Topic {i}" for i in range(1, 9)]), prepare=False
    )
    await service.prepare_deck(deck.id)
    return service.db.get_deck(deck.id)


# ── Matching by meaning ─────────────────────────────────────────────────────


def predicted():
    return [PredictedQuestion(id=i, slide=s, question=q, answer=a) for i, s, q, a in QUESTIONS]


def test_semantic_match_threshold_and_margin():
    emb = FakeEmbedder()
    items = predicted()
    vectors = {q.id: to_blob(v) for q, v in zip(items, emb.embed([q.question for q in items]))}
    hit = best_semantic_match(emb.embed(["Why use row level security?"])[0], items, vectors)
    assert hit and hit.item.id == "q1" and hit.score > 0.99

    assert best_semantic_match(emb.embed(["Who invented PostgreSQL?"])[0], items, vectors) is None

    # Two prepared questions equally close → ambiguous → no instant answer.
    tie = [PredictedQuestion(id="a", slide=1, question="rls one", answer="A"),
           PredictedQuestion(id="b", slide=2, question="rls two", answer="B")]
    tv = {q.id: to_blob(v) for q, v in zip(tie, emb.embed([q.question for q in tie]))}
    assert best_semantic_match(emb.embed(["rls?"])[0], tie, tv) is None


async def test_question_with_same_meaning_gets_instant_answer(db):
    llm = scripted_llm()
    service = make_service(db, llm, embedder=FakeEmbedder())
    deck = await ready_deck(service)
    assert len(db.get_embeddings(deck.id, "fake-embedder")) == 4  # indexed after preparation

    a = await service.ask("Flick, why do we need row level security at all?")
    assert (a.origin, a.answer) == ("prepared", "RLS ANSWER")
    assert not llm.search_calls


async def test_falls_back_to_claude_while_model_loads(db):
    llm = scripted_llm()
    service = make_service(db, llm, embedder=FakeEmbedder(ready=False))
    await ready_deck(service)
    a = await service.ask("Why do we need row level security at all?")
    assert a.origin == "slides" and len(llm.search_calls) == 1


# ── Ready-made slide explanations ───────────────────────────────────────────


async def test_explanations_written_before_the_talk_are_used_instantly(db):
    llm = scripted_llm({3: "Slide three, ready before the talk."})
    service = make_service(db, llm, slide_answer="3")
    deck = await ready_deck(service)
    assert db.explanation_count(deck.id) == 8
    assert db.list_decks()[0].explanation_count == 8

    calls_before = len(llm.complete_calls)
    events = service.events.subscribe()
    a = await service.ask("Flick, explain this slide")
    assert (a.origin, a.answer, a.speak, a.streamed) == ("explain", "Slide three, ready before the talk.", True, False)
    assert len(llm.complete_calls) == calls_before  # no AI call
    kinds = [events.get_nowait()["type"] for _ in range(events.qsize())]
    assert kinds == ["answer"]  # no "thinking": it's instant


async def test_special_requests_are_written_live_and_streamed(db):
    llm = scripted_llm()
    service = make_service(db, llm, slide_answer="2")
    await ready_deck(service)
    events = service.events.subscribe()
    a = await service.ask("explain this slide in simple words")
    assert a.answer == "Live explanation. It has two sentences." and a.streamed and a.speak
    seen = [events.get_nowait() for _ in range(events.qsize())]
    deltas = [e["data"]["text"] for e in seen if e["type"] == "answer_delta"]
    assert deltas == ["Live explanation.", "It has two sentences."]
    assert all(e["data"]["speak"] for e in seen if e["type"] == "answer_delta")
    assert [e["type"] for e in seen][0] == "thinking" and seen[-1]["type"] == "answer"


def test_plain_explain_requests():
    assert is_plain_explain_request("Flick, explain this slide to the audience")
    assert is_plain_explain_request("explain slide 5 please")
    assert not is_plain_explain_request("explain this slide in simple words")
    assert not is_plain_explain_request("is slide ko samjhao")  # Roman Urdu → written live in Urdu


async def test_explanations_parse_and_skip_failed_batches():
    assert engine.parse_explanations('x {"explanations":[{"slide":2,"text":" Hi  there "},{"slide":"x"}]}') == {2: "Hi there"}
    slides = [Slide(number=i, title=f"S{i}") for i in range(1, 9)]
    out = await engine.prepare_explanations(FakeLLM(fail="network"), "D", slides)
    assert out == {}


# ── Streaming ───────────────────────────────────────────────────────────────


async def test_sentence_stream_splits_as_text_arrives():
    got = []

    async def on(s):
        got.append(s)

    stream = SentenceStream(on)
    for chunk in ["Row-Level Sec", "urity filters rows. It runs in", "side PostgreSQL! Done?", " And Urdu۔ End"]:
        await stream.feed(chunk)
    assert got == ["Row-Level Security filters rows.", "It runs inside PostgreSQL!", "Done?", "And Urdu۔"]
    await stream.flush()
    assert got[-1] == "End"


async def test_live_answers_stream_and_announce_searching(db):
    llm = FakeLLM(search=SearchResult("Cauchy described it in 1847. Robbins and Monro followed in 1951.", [], True))
    service = make_service(db, llm)
    events = service.events.subscribe()
    a = await service.ask("Who invented gradient descent?")
    seen = [events.get_nowait() for _ in range(events.qsize())]
    kinds = [e["type"] for e in seen]
    assert kinds == ["thinking", "searching", "answer_delta", "answer_delta", "answer"]
    assert seen[1]["data"]["speak"] is True  # nothing spoken yet → say "one moment"
    assert a.streamed and a.origin == "web"
    ids = {e["data"]["id"] for e in seen}
    assert len(ids) == 1  # every event belongs to the same answer


async def test_private_mode_streams_without_speaking(db):
    service = make_service(db, FakeLLM())
    db.update_settings({"answer_mode": "private"})
    events = service.events.subscribe()
    await service.ask("What is a GPU?")
    deltas = [e for e in (events.get_nowait() for _ in range(events.qsize())) if e["type"] == "answer_delta"]
    assert deltas and not any(d["data"]["speak"] for d in deltas)


# ── Prompt caching ──────────────────────────────────────────────────────────


def test_deck_block_is_cached_and_identical_across_questions():
    deck = Deck(id="d", name="D", file_path="/d.pptx", loaded_at=0, slides=[Slide(number=1, title="A"), Slide(number=2, title="B")])
    m1 = prompts.live_message("Q1?", deck, 1, [])
    m2 = prompts.live_message("Q2?", deck, 2, [("x", "y")])
    assert m1[0] == m2[0] and m1[0]["cache_control"] == {"type": "ephemeral"}
    assert "currently on slide 2" in m2[1]["text"] and "cache_control" not in m2[1]


# ── Speech ──────────────────────────────────────────────────────────────────

TOKEN = "t"
H = {"X-Flick-Token": TOKEN}


def test_ask_audio_transcribes_with_slide_hints_and_answers(db):
    transcriber = FakeTranscriber("Flick, explain slide 2")
    service = make_service(db, scripted_llm(), transcriber=transcriber, embedder=FakeEmbedder())
    with TestClient(create_app(service, TOKEN)) as client:
        client.post("/decks/upload", headers=H, files={"file": ("D.pptx", make_pptx(["Intro", "Method"]))})
        r = client.post("/ask-audio", headers=H, files={"audio": ("q.wav", b"RIFF....WAVE")}).json()
        assert r["transcript"] == "Flick, explain slide 2" and r["transcribe_ms"] == 420
        assert r["answer"]["origin"] == "explain" and r["answer"]["current_slide"] == 2
        audio, size, language, hint = transcriber.calls[0]
        assert (size, language) == ("small", "en") and "Intro" in hint and "Method" in hint

        assert client.post("/transcribe", headers=H, files={"audio": ("q.wav", b"")}).status_code == 400
        status = client.get("/status", headers=H).json()
        assert status["speech_model"]["ready"] and status["meaning_model"]["ready"]


def test_no_transcriber_is_a_clear_503(db):
    with TestClient(create_app(make_service(db), TOKEN)) as client:
        r = client.post("/transcribe", headers=H, files={"audio": ("q.wav", b"x")})
        assert r.status_code == 503
