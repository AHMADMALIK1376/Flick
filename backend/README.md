# Flick backend (Python)

The AI brain of Flick: reads slides, prepares likely questions, answers live questions and explains slides. The desktop app talks to it on `127.0.0.1`.

## Run it

```bash
cd backend
pip install -r requirements-dev.txt
python -m flick --port 8765          # prints FLICK_READY 8765 when ready
python -m pytest                     # 54 tests
python -m flick.try_match "Why use row level security?"   # how a question scores against prepared ones
```

Set `FLICK_TOKEN` to the token the app will send; without it a random one is printed. On the first start, Flick downloads two models into the data folder (speech ~480 MB, meaning ~220 MB); `GET /status` shows when they are ready. Data lives in `%APPDATA%\Flick\flick.db` on Windows (override with `--data-dir` or `FLICK_DATA_DIR`).

## Parts

| File | Job |
|---|---|
| `pptx_reader.py` | .pptx → slides (title, text, tables, speaker notes), in presentation order |
| `text.py` | Cleans "Flick, …" from questions; spots "explain this slide / slide 5 / next slide" (English, Roman Urdu, Urdu) |
| `matcher.py` | Instant offline match against prepared questions (same words) |
| `semantic.py` | Matching by meaning: a small multilingual model on the CPU (~20 ms per question) |
| `transcribe.py` | Speech to text with faster-whisper (8-bit, CPU), hinted with slide titles |
| `prompts.py` | Every prompt sent to Claude |
| `llm.py` | Claude client: answers, built-in web search, sources, friendly errors |
| `engine.py` | Answer cascade (prepared by words → by meaning → slides → web), slide explanations written ahead, question prediction |
| `powerpoint.py` | Current slide and open file from PowerPoint (pywin32, PowerShell fallback). Read-only |
| `db.py` | SQLite: settings, decks, slides, predicted questions, Q&A log |
| `service.py` | Ties it together; publishes live events |
| `api.py` | HTTP + WebSocket API, token-protected |

## API

All requests need the header `X-Flick-Token`.

| Method | Path | Does |
|---|---|---|
| GET | `/health` | Is it running (no token needed) |
| GET | `/status` | Are the speech and meaning models ready; is PowerPoint available |
| GET / PATCH | `/settings` | Read / change settings (API key comes back masked) |
| GET | `/models` | Claude models to choose from |
| GET | `/decks`, `/decks/active`, `/decks/{id}` | Presentations |
| POST | `/decks/from-path` `{path}` | Load a .pptx from disk |
| POST | `/decks/upload` (multipart `file`) | Load an uploaded .pptx |
| POST | `/decks/from-powerpoint` | Load the deck open in PowerPoint (Windows) |
| POST | `/decks/{id}/activate`, `/decks/{id}/prepare` | Switch deck / prepare questions again |
| DELETE | `/decks/{id}` | Remove a deck from Flick (the file is not touched) |
| POST | `/decks/{id}/questions` `{slide, question, answer}` | Add a prepared question (201) |
| PATCH | `/questions/{id}` `{slide?, question?, answer?}` | Edit a prepared question (a new question text is re-indexed for meaning matching) |
| DELETE | `/questions/{id}` | Delete a prepared question (204) |
| POST | `/question-starting` | The presenter started speaking: read the slide early |
| POST | `/ask` `{text}` | Answer a question, or explain a slide if asked |
| POST | `/ask-audio` (multipart `audio`) | Speech → text → answer in one request |
| POST | `/transcribe` (multipart `audio`) | Speech → text only |
| POST | `/explain` `{slide?}` | Explain the slide on screen (or slide N), always spoken |
| GET / DELETE | `/log` | Q&A log / clear it |
| WS | `/events?token=…` | Live events (below) |

### Live events

| Event | Data | The app should |
|---|---|---|
| `thinking` | `{id, question}` | Show the question and a spinner |
| `searching` | `{id, speak}` | Show "checking the web"; if `speak`, say "One moment, let me check" |
| `answer_delta` | `{id, text, speak}` | Show the sentence; if `speak`, say it now (answers start talking after one sentence) |
| `answer` | the full answer, incl. `streamed` | Show it; speak it only if `speak` and not `streamed` |
| `prep_progress` | `{deck_id, status, done, total, message}` | Update the progress bar |

## How it is fast

| Path | Time to start | How |
|---|---|---|
| Prepared, same words | ~0.02 s | Offline word match |
| Prepared, same meaning | ~0.05 s | Meaning vectors stored in SQLite, compared on the CPU |
| Explain this slide | ~0.02 s | Explanations written during preparation |
| Answer from slides | first sentence ~1 s | Streamed; the deck is prompt-cached by Claude |
| Answer from the web | "One moment" at once, answer ~4–6 s | `searching` event, then streamed |
| Speech to text | ~0.3–1 s after you stop | faster-whisper, loaded at startup |

## Database

```
settings(key, value)
decks(id, name, file_path UNIQUE, loaded_at, prep_status, prep_error, active)   -- one active deck
slides(deck_id → decks, number, title, body, notes)                            -- PK (deck_id, number)
predicted_questions(id, deck_id → decks, slide, question, answer)
qa_log(id, deck_id → decks, question, answer, origin, sources, current_slide, duration_ms, timestamp, spoken)
slide_explanations(deck_id, number → slides, text)                              -- written before the talk
question_embeddings(question_id → predicted_questions, model, vector BLOB)      -- meaning vectors
```

Deleting a deck removes its slides and questions (cascade); its log entries are kept.
