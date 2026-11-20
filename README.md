# Flick: your live Q&A assistant for presentations

When someone in the audience asks a question you can't answer, ask Flick. She answers in a few seconds, from your slides when they cover it and from the web when they don't. The answer appears on a card on your screen and can also be read aloud to the room.

Flick is built for university classrooms: students presenting projects, and teachers giving lectures who would otherwise say "I'll find out and tell you next class."

## How it works

**Before the talk:** load your PowerPoint (.pptx). Flick reads every slide and its speaker notes, then predicts the questions your audience is most likely to ask and prepares an answer for each. You can review them on the **Prepared Questions** page, which doubles as rehearsal.

**During the talk:** press `Ctrl+Shift+Space` (or click the floating mic), say *"Flick, …"* and repeat the question. Flick works down a cascade, fastest first:

| Step | Source | Speed |
| --- | --- | --- |
| 1 | **Prepared answer**: the question matches one predicted before the talk | Instant, no AI call |
| 2 | **Your slides**: the deck and its speaker notes cover it | ~2–4 s |
| 3 | **The web**: the slides don't cover it, so Flick searches and answers with sources | ~5–10 s |
| 4 | **General knowledge**: only when web search isn't available | ~2–4 s |

The answer card always shows which source it came from (*Prepared answer*, *From your slides*, *From the web*), so you know how far to trust it before you repeat it.

**After the talk:** the **Q&A Log** keeps every question and answer, with web sources, so you can follow up. Use Export to get them as a text file.

### Features

- **Speak or keep it private.** In *Speak to the room* mode Flick reads each answer aloud. In *Show only to me* mode the answer appears only on your screen, so you can answer in your own words, and a **Speak** button is there if you want Flick to say it.
- **Knows where you are in the deck.** On Windows, Flick asks PowerPoint which slide is on screen and gives that slide's content priority.
- **One-click deck loading.** Use open PowerPoint loads whatever presentation is open in PowerPoint (Windows).
- **Follow-ups work.** "Can you explain that more simply?" is answered in the context of the last few questions.
- **Stays on top of the slideshow.** The answer card and mic float above a full-screen PowerPoint show, and appear without stealing focus, so your clicker keeps working.
- **English, Urdu and Roman Urdu.** Flick answers in the language of the question.
- **On-device speech recognition.** Whisper runs locally. Only the question text goes to the AI provider.

## Setup

```bash
cd apps/electron
npm install
npm run dev
```

On first launch Flick downloads the Whisper speech model (one time). Then:

1. Open **Settings** and paste an **Anthropic (Claude) API key** from [console.anthropic.com](https://console.anthropic.com). Claude has built-in web search, so no other key is needed.
2. On **Presentation**, click **Upload .pptx** (or **Use open PowerPoint**). Question prediction starts automatically.
3. Test it in **Try a question**, then give your talk.

### Other AI providers

OpenAI, Gemini, Qwen and DeepSeek also work (choose them in Settings). They have no built-in web search, so add a free [Tavily](https://tavily.com) key to let Flick search the web with them. Without one, Flick falls back to the model's general knowledge for questions the slides don't cover.

| Setting | Default | Why |
| --- | --- | --- |
| Model | Claude Haiku 5.5 | Fastest, and live answers are latency-bound. Sonnet/Opus give deeper answers but take longer. |
| Speech model | Whisper `small` | Balances speed and accuracy. Use `medium` for Urdu. |
| Answers | Speak to the room | Switch to *Show only to me* for a private prompt. |

## Project layout

```
apps/electron/src/
  main/
    main.ts                      windows, hotkey, IPC wiring
    presentation/
      pptx-parser.ts             .pptx → slides (title, body, speaker notes)
      qa-predictor.ts            predicts audience questions before the talk
      question-matcher.ts        instant offline match against prepared questions
      answer-engine.ts           the answer cascade (prepared → slides → web → general)
      prompts.ts                 every prompt Flick sends
      web-search.ts              Tavily search for providers without built-in search
      powerpoint-bridge.ts       current slide / open file from PowerPoint (Windows)
      presentation-service.ts    decks, live questions, Q&A log
    llm/                         provider-agnostic LLM layer (Claude, OpenAI, Gemini, Qwen, DeepSeek)
    whisper-service.ts           local speech-to-text
  renderer/
    dashboard/                   decks, prepared questions, log, settings
    answer/                      the floating answer card
    widget/                      the floating mic; speaks answers
    onboarding/                  first-run setup and model download
```

Run the tests with `npm test` in `apps/electron`. (Four `model-paths` tests assume Windows paths and fail on macOS/Linux. That's a known issue unrelated to Flick's features.)

## Limitations and next steps

- **.pptx only.** Save older .ppt files as .pptx. PDF and Google Slides decks are a natural next step.
- **Text only.** Flick reads slide text and notes, not images or charts. Sending slide images to a vision model would let it answer questions about diagrams.
- **Live slide tracking is Windows-only.** It uses PowerPoint's COM interface. On macOS, Flick still answers from the whole deck.
- **Voice quality** uses the operating system's built-in voice. A neural TTS service would sound more natural.
- The earlier PC-control agent design is archived in `docs/archive/pc-agent/`.

## License

MIT
