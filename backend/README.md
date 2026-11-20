# Flick backend (Python)

The AI brain of Flick: reads slides, prepares likely questions, answers live questions and explains slides. The desktop app talks to it on `127.0.0.1`.

## Run it

```bash
cd backend
pip install -r requirements-dev.txt
python -m flick --port 8765          # prints FLICK_READY 8765 when ready
python -m pytest                     # 41 tests
```

Set `FLICK_TOKEN` to the token the app will send; without it a random one is printed. Data lives in `%APPDATA%\Flick\flick.db` on Windows (override with `--data-dir` or `FLICK_DATA_DIR`).

## Parts

| File | Job |
|---|---|
| `pptx_reader.py` | .pptx → slides (title, text, tables, speaker notes), in presentation order |
| `text.py` | Cleans "Flick, …" from questions; spots "explain this slide / slide 5 / next slide" (English, Roman Urdu, Urdu) |
| `matcher.py` | Instant offline match against prepared questions |
| `prompts.py` | Every prompt sent to Claude |
| `llm.py` | Claude client: answers, built-in web search, sources, friendly errors |
| `engine.py` | Answer cascade (prepared → slides → web), slide explanations, question prediction |
| `powerpoint.py` | Current slide and open file from PowerPoint (pywin32, PowerShell fallback). Read-only |
| `db.py` | SQLite: settings, decks, slides, predicted questions, Q&A log |
| `service.py` | Ties it together; publishes live events |
| `api.py` | HTTP + WebSocket API, token-protected |

## API

All requests need the header `X-Flick-Token`.

| Method | Path | Does |
|---|---|---|
| GET | `/health` | Is it running (no token needed) |
| GET / PATCH | `/settings` | Read / change settings (API key comes back masked) |
| GET | `/models` | Claude models to choose from |
| GET | `/decks`, `/decks/active`, `/decks/{id}` | Presentations |
| POST | `/decks/from-path` `{path}` | Load a .pptx from disk |
| POST | `/decks/upload` (multipart `file`) | Load an uploaded .pptx |
| POST | `/decks/from-powerpoint` | Load the deck open in PowerPoint (Windows) |
| POST | `/decks/{id}/activate`, `/decks/{id}/prepare` | Switch deck / prepare questions again |
| DELETE | `/decks/{id}` | Remove a deck from Flick (the file is not touched) |
| POST | `/question-starting` | The presenter started speaking: read the slide early |
| POST | `/ask` `{text}` | Answer a question, or explain a slide if asked |
| POST | `/explain` `{slide?}` | Explain the slide on screen (or slide N), always spoken |
| GET / DELETE | `/log` | Q&A log / clear it |
| WS | `/events?token=…` | Live events: `thinking`, `answer`, `prep_progress` |

## Database

```
settings(key, value)
decks(id, name, file_path UNIQUE, loaded_at, prep_status, prep_error, active)   -- one active deck
slides(deck_id → decks, number, title, body, notes)                            -- PK (deck_id, number)
predicted_questions(id, deck_id → decks, slide, question, answer)
qa_log(id, deck_id → decks, question, answer, origin, sources, current_slide, duration_ms, timestamp, spoken)
```

Deleting a deck removes its slides and questions (cascade); its log entries are kept.
