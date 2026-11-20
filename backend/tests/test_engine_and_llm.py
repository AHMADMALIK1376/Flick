from flick import engine
from flick.llm import SearchResult, parse_search_response
from flick.models import Deck, PredictedQuestion, Slide, WebSource

from .conftest import FakeLLM

DECK = Deck(
    id="d", name="NN.pptx", file_path="/x/NN.pptx", loaded_at=0,
    slides=[Slide(number=1, title="Neural Networks", body="Layers"), Slide(number=2, title="Dropout", body="Disable neurons", notes="Prevents overfitting"),
            Slide(number=3, title="Summary")],
    predicted=[PredictedQuestion(id="p", slide=2, question="Why does dropout prevent overfitting?", answer="PREPARED")],
)


async def test_prepared_answer_needs_no_ai_call():
    llm = FakeLLM()
    r = await engine.answer_question(llm, "why does dropout prevent overfitting", DECK, 2, [])
    assert (r.answer, r.origin) == ("PREPARED", "prepared")
    assert not llm.search_calls


async def test_slides_vs_web_origin_and_context():
    llm = FakeLLM(search=SearchResult("From slides", [], searched=False))
    r = await engine.answer_question(llm, "What do the layers do?", DECK, 2, [("Earlier?", "Yes.")])
    assert r.origin == "slides"
    message = llm.search_calls[0][1]
    assert "Slide 2: Dropout" in message and "currently on slide 2" in message
    assert "<recent_questions>" in message and "Audience question: What do the layers do?" in message

    sources = [WebSource(title=f"T{i}", url=f"https://e.com/{i}") for i in range(5)]
    web = await engine.answer_question(FakeLLM(search=SearchResult("Web", sources, True)), "Who invented dropout?", DECK, None, [])
    assert web.origin == "web" and len(web.sources) == 3


async def test_explain_uses_slide_and_neighbours_without_search():
    llm = FakeLLM(complete_text="EXPLAINED")
    assert await engine.explain_slide(llm, DECK, 2, "explain this slide") == "EXPLAINED"
    system, message = llm.complete_calls[0]
    assert "examples" in system
    assert "<slide_to_explain>\nSlide 2: Dropout" in message
    assert "previous slide 1: Neural Networks" in message and "next slide 3: Summary" in message
    assert not llm.search_calls


async def test_predict_keeps_good_batches_and_drops_foreign_slides():
    slides = [Slide(number=i, title=f"S{i}") for i in range(1, 9)]
    calls = 0

    def reply(_system, _message):
        nonlocal calls
        calls += 1
        return 'Here:\n```json\n{"questions":[{"slide":1,"question":"Q1?","answer":"A1."},{"slide":99,"question":"Q?","answer":"A."},{"question":"","answer":"x"}]}\n```'

    progress = []

    async def on_progress(done, total):
        progress.append((done, total))

    out = await engine.predict_questions(FakeLLM(complete_text=reply), "Deck", slides, on_progress)
    assert calls == 2  # 8 slides → batches of 6 + 2
    assert [q.question for q in out.questions] == ["Q1?"]  # slide 1 only in the first batch's range
    assert progress[-1] == (2, 2) and out.error is None

    failed = await engine.predict_questions(FakeLLM(fail="missing_key"), "Deck", slides[:2])
    assert failed.questions == [] and failed.error.kind == "missing_key"


def test_parse_search_response_drops_narration_and_dedupes_citations():
    content = [
        {"type": "text", "text": "Let me look that up."},
        {"type": "server_tool_use", "id": "s", "name": "web_search", "input": {}},
        {"type": "web_search_tool_result", "content": [{"type": "web_search_result", "url": "https://a.com", "title": "A"}]},
        {"type": "text", "text": "Dropout was introduced in 2014.", "citations": [
            {"type": "web_search_result_location", "url": "https://b.com", "title": "B"},
            {"type": "web_search_result_location", "url": "https://b.com", "title": "B"}]},
    ]
    r = parse_search_response(content)
    assert r.text == "Dropout was introduced in 2014." and r.searched
    assert [s.url for s in r.sources] == ["https://b.com"]

    fallback = parse_search_response(content[2:3] + [{"type": "text", "text": "Answer."}])
    assert [s.url for s in fallback.sources] == ["https://a.com"]
    direct = parse_search_response([{"type": "text", "text": "From slides."}])
    assert not direct.searched and direct.sources == []
