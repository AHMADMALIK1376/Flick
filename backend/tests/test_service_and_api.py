import asyncio

import pytest
from fastapi.testclient import TestClient

from flick.api import create_app
from flick.db import Database
from flick.text import SlideTarget

from .conftest import FakeLLM, make_pptx, make_service

PREP_JSON = '{"questions":[{"slide":1,"question":"What is attention?","answer":"PREPARED"}]}'


async def load(service, titles=("Transformers", "Attention", "Results", "Limits", "Summary")):
    return await service.load_deck("/talks/AI.pptx", data=make_pptx(list(titles)), prepare=False)


async def test_load_prepare_and_answer_prepared(db):
    service = make_service(db, FakeLLM(complete_text=PREP_JSON))
    deck = await load(service)
    await service.prepare_deck(deck.id)
    summary = db.list_decks()[0]
    assert (summary.slide_count, summary.question_count, summary.prep_status, summary.active) == (5, 1, "ready", True)

    a = await service.ask("Flick, what is attention?")
    assert (a.question, a.answer, a.origin, a.speak) == ("What is attention?", "PREPARED", "prepared", True)
    assert db.get_log()[0].id == a.id


async def test_reloading_same_file_keeps_one_deck(db):
    service = make_service(db)
    first = await load(service)
    second = await load(service)
    assert first.id == second.id and len(db.list_decks()) == 1


async def test_prep_failure_is_friendly(db):
    service = make_service(db, FakeLLM(fail="invalid_key"))
    deck = await load(service)
    await service.prepare_deck(deck.id)
    summary = db.list_decks()[0]
    assert summary.prep_status == "error" and "API key was rejected" in summary.prep_error


async def test_rejects_ppt(db):
    with pytest.raises(Exception, match=".pptx"):
        await make_service(db).load_deck("/old.ppt", data=b"x")


async def test_private_mode_and_followups(db):
    llm = FakeLLM()
    service = make_service(db, llm)
    db.update_settings({"answer_mode": "private"})
    a = await service.ask("What is a GPU?")
    assert (a.answer, a.speak) == ("LIVE.", False)
    await service.ask("Can you explain that more simply?")
    assert "Q: What is a GPU?" in llm.search_calls[1][1]


async def test_silence_greeting_and_errors(db):
    service = make_service(db, FakeLLM(fail="missing_key"))
    assert await service.ask("Thank you.") is None
    assert (await service.ask("Hey Flick")).origin == "greeting"
    err = await service.ask("What is a GPU?")
    assert err.origin == "error" and not err.speak and "API key" in err.answer


async def test_explain_this_slide_always_spoken_and_fresh(db):
    llm = FakeLLM(complete_text="EXPLAINED")
    service = make_service(db, llm, slide_answer="3")
    db.update_settings({"answer_mode": "private"})
    await load(service)
    a = await service.ask("Flick, explain this slide to the audience")
    assert (a.origin, a.answer, a.current_slide, a.speak) == ("explain", "EXPLAINED", 3, True)
    assert a.question == "Explain slide 3: Results"
    await service.explain_slide()
    assert service.query_calls.count("slide") == 2  # read fresh each time
    assert (await service.ask("explain the next slide")).current_slide == 4
    assert (await service.ask("explain slide 5")).current_slide == 5


async def test_explain_errors_are_not_spoken(db):
    service = make_service(db, slide_answer="")
    assert "Load your presentation" in (await service.explain_slide()).answer
    await load(service)
    no_slide = await service.ask("explain this slide")
    assert no_slide.origin == "error" and not no_slide.speak and "Enable Editing" in no_slide.answer
    assert "has 5 slides" in (await service.explain_slide(SlideTarget("number", number=9))).answer

    mac = make_service(Database(":memory:"), platform="darwin")
    await load(mac)
    assert "Windows" in (await mac.ask("explain this slide")).answer


async def test_explanations_are_not_followup_context(db):
    llm = FakeLLM(complete_text="EXPLAINED")
    service = make_service(db, llm, slide_answer="1")
    await load(service)
    await service.explain_slide()
    await service.ask("What is a GPU?")
    assert "<recent_questions>" not in llm.search_calls[0][1]


def test_interrupted_prep_marked_failed(tmp_path):
    path = tmp_path / "f.db"
    d = Database(path)
    d._conn.execute("INSERT INTO decks(id,name,file_path,loaded_at,prep_status) VALUES ('x','x','/x.pptx',0,'preparing')")
    d._conn.commit()
    d.close()
    assert Database(path).list_decks()[0].prep_status == "error"


# ── API ─────────────────────────────────────────────────────────────────────

TOKEN = "test-token"
H = {"X-Flick-Token": TOKEN}


@pytest.fixture
def client(db):
    service = make_service(db, FakeLLM(complete_text=PREP_JSON), slide_answer="2")
    with TestClient(create_app(service, TOKEN)) as c:
        yield c


def test_token_required(client):
    assert client.get("/health").headers["content-type"] == "application/json; charset=utf-8"
    assert client.get("/settings").status_code == 401
    assert client.get("/settings", headers={"X-Flick-Token": "wrong"}).status_code == 401


def test_settings_mask_key(client):
    r = client.patch("/settings", headers=H, json={"anthropic_api_key": "sk-ant-secret-1234", "answer_mode": "private"})
    body = r.json()
    assert body["has_api_key"] and body["anthropic_api_key"].endswith("1234") and "secret" not in body["anthropic_api_key"]
    # Sending the mask back keeps the real key.
    client.patch("/settings", headers=H, json={"anthropic_api_key": body["anthropic_api_key"]})
    assert client.get("/settings", headers=H).json()["has_api_key"]
    assert client.patch("/settings", headers=H, json={"model": "gpt-9"}).status_code == 400
    assert client.patch("/settings", headers=H, json={"answer_mode": "loud"}).status_code == 422


def test_upload_ask_explain_log_and_events(client):
    with client.websocket_connect(f"/events?token={TOKEN}") as ws:
        r = client.post("/decks/upload", headers=H, files={"file": ("Lecture.pptx", make_pptx(["Intro", "Method"]))})
        assert r.status_code == 200 and r.json()["slide_count"] == 2

        events = [ws.receive_json() for _ in range(2)]
        assert {e["type"] for e in events} == {"prep_progress"}

        a = client.post("/ask", headers=H, json={"text": "Flick, explain this slide"}).json()
        assert a["origin"] == "explain" and a["current_slide"] == 2 and a["speak"]

        kinds = []
        while "answer" not in kinds:
            kinds.append(ws.receive_json()["type"])
        assert "thinking" in kinds

    assert client.post("/explain", headers=H, json={"slide": 1}).json()["current_slide"] == 1
    assert len(client.get("/log", headers=H).json()) == 2
    assert client.delete("/log", headers=H).status_code == 204
    assert client.get("/log", headers=H).json() == []


def test_upload_rejects_bad_file(client):
    r = client.post("/decks/upload", headers=H, files={"file": ("x.pptx", b"nope")})
    assert r.status_code == 400 and "not a valid" in r.json()["detail"]


def test_events_need_token(client):
    from starlette.websockets import WebSocketDisconnect

    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/events?token=wrong") as ws:
            ws.receive_json()


# ── Prepared questions: add / edit / delete ─────────────────────────────────


def _deck_id(client) -> str:
    r = client.post("/decks/upload", headers=H, files={"file": ("Talk.pptx", make_pptx(["Intro", "Method"]))})
    return r.json()["id"]


def test_add_edit_delete_question(client, db):
    deck_id = _deck_id(client)
    r = client.post(f"/decks/{deck_id}/questions", headers=H, json={"slide": 1, "question": " What is X? ", "answer": "X is Y."})
    assert r.status_code == 201
    q = r.json()
    assert q["question"] == "What is X?" and q["slide"] == 1
    assert any(p["id"] == q["id"] for p in client.get(f"/decks/{deck_id}", headers=H).json()["predicted"])

    # Changing the text drops the old meaning vector; changing only the answer keeps it.
    db.save_embeddings("m", {q["id"]: b"vec"})
    client.patch(f"/questions/{q['id']}", headers=H, json={"answer": "X is Z."})
    assert q["id"] in db.get_embeddings(deck_id, "m")
    r = client.patch(f"/questions/{q['id']}", headers=H, json={"question": "What is X really?"})
    assert r.status_code == 200 and r.json()["question"] == "What is X really?" and r.json()["answer"] == "X is Z."
    assert q["id"] not in db.get_embeddings(deck_id, "m")

    assert client.delete(f"/questions/{q['id']}", headers=H).status_code == 204
    assert client.delete(f"/questions/{q['id']}", headers=H).status_code == 404
    assert all(p["id"] != q["id"] for p in client.get(f"/decks/{deck_id}", headers=H).json()["predicted"])


def test_question_checks(client):
    deck_id = _deck_id(client)
    add = lambda body, d=deck_id: client.post(f"/decks/{d}/questions", headers=H, json=body)
    assert add({"question": "  ", "answer": "a"}).status_code == 400
    assert add({"slide": 9, "question": "q", "answer": "a"}).status_code == 400
    assert add({"question": "q", "answer": "a"}, d="nope").status_code == 404
    assert client.patch("/questions/nope", headers=H, json={"answer": "a"}).status_code == 404
    assert client.post(f"/decks/{deck_id}/questions", json={"question": "q", "answer": "a"}).status_code == 401
