import pytest

from flick.matcher import find_best_match, similarity
from flick.models import PredictedQuestion
from flick.pptx_reader import PptxError, read_pptx
from flick.text import SlideTarget, clean_question, is_bare_address, is_nothing_heard, parse_slide_command

from .conftest import make_pptx


def test_reads_slides_in_presentation_order_with_notes_and_tables():
    slides = read_pptx(make_pptx(["Intro", "Results", "Method"], reorder_last_to=1))
    assert [s.title for s in slides] == ["Intro", "Method", "Results"]
    assert [s.number for s in slides] == [1, 2, 3]
    results = slides[2]
    assert "Point B & more" in results.body
    assert "Model | Accuracy" in results.body and "CNN | 94%" in results.body
    assert results.notes == "Notes for Results"


def test_rejects_non_presentations():
    with pytest.raises(PptxError):
        read_pptx(b"not a pptx")


def test_clean_question_and_address():
    assert clean_question("Flick, what is backpropagation?") == "What is backpropagation?"
    assert clean_question("hey flix what is a GPU") == "What is a GPU"
    assert clean_question("Flick, can neural networks overfit?") == "Can neural networks overfit?"
    assert is_bare_address("Hey Flick.") and not is_bare_address("Flick, what is AI?")
    assert is_nothing_heard(" Thank you. ") and is_nothing_heard("[BLANK_AUDIO]")
    assert not is_nothing_heard("Thank you, what is RNN?")


@pytest.mark.parametrize(
    "text,expected",
    [
        ("Explain this slide", SlideTarget("current")),
        ("Can you explain the current slide to the audience please?", SlideTarget("current")),
        ("walk us through this slide", SlideTarget("current")),
        ("explain slide 5", SlideTarget("number", number=5)),
        ("explain the 3rd slide", SlideTarget("number", number=3)),
        ("explain slide five", SlideTarget("number", number=5)),
        ("explain the next slide", SlideTarget("relative", offset=1)),
        ("walk them through the previous slide", SlideTarget("relative", offset=-1)),
        ("is slide ko samjhao", SlideTarget("current")),
        ("slide 3 ko samjhao", SlideTarget("number", number=3)),
        ("agli slide samjhao", SlideTarget("relative", offset=1)),
        ("اس سلائیڈ کو سمجھاؤ", SlideTarget("current")),
    ],
)
def test_slide_commands(text, expected):
    assert parse_slide_command(text) == expected


@pytest.mark.parametrize(
    "text",
    [
        "What is gradient descent?",
        "Why does slide 3 say the loss is convex?",
        "Can you explain why the learning rate matters?",
        "how many slides are there",
        "Can you explain what happens on slide 4 when the learning rate is too large and the loss starts to bounce around?",
    ],
)
def test_questions_are_not_slide_commands(text):
    assert parse_slide_command(text) is None


def q(text, answer="A"):
    return PredictedQuestion(id=text, slide=1, question=text, answer=answer)


def test_matching():
    assert similarity("What are the main limitations of neural networks?", "what are limitations of neural networks") >= 0.72
    assert similarity("What is dropout?", "Why do we use dropout?") < 0.72
    assert similarity("How does gradient descent find the minimum?", "What is the minimum dataset size needed?") == 0
    items = [q("What is overfitting?", "over"), q("How do CNNs process images?", "cnn")]
    assert find_best_match("how do CNNs process an image", items).item.answer == "cnn"
    assert find_best_match("who invented the transistor", items) is None
