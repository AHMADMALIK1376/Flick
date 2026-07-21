# Flick — Design Spec: Voice-First MCP Agent

**Date:** 2026-07-21
**Status:** Approved for planning
**Repo:** https://github.com/AHMADMALIK1376/Flick (private)

---

## 1. Context

Flick is a voice-first AI assistant for Pakistani students, submitted to the first
Alibaba Cloud AI Hackathon in Pakistan (hosted by Alkhidmat Foundation Pakistan).

**Submitted registration details — these are locked and constrain the work:**

| Field | Value |
|---|---|
| Focus Area | Education |
| Project Name | Flick |
| Persona | Female assistant — referred to as "she" in all user-facing copy |

The submitted description claims speech is transcribed **on-device**. Any design that
removes local transcription entirely would make that description false. This is a hard
constraint, not a preference.

Flick is built on the existing codebase in this repo (previously "EduPilot" /
"voice-to-text"), which already provides a working Electron desktop app, on-device
Whisper STT, a voice command pipeline, a Playwright browser agent with a vision ReAct
loop, and a provider-agnostic LLM layer.

---

## 2. Goals

1. Flick understands **code-switched Roman Urdu**, Urdu script, and English.
2. Flick controls the PC through an **extensible MCP tool layer**, not hardcoded branches.
3. The flagship demo is an **assignment tutor** flow that explains coursework and never
   writes it.
4. Flick also handles WhatsApp messaging, Gmail, weather, and general Q&A.
5. Alibaba Cloud (Qwen + ASR) is the default engine, with other providers selectable.

## 3. Non-Goals

- Production hardening. Three weeks buys demo quality: solid happy path, thin edges.
- Regional languages beyond Urdu (Punjabi, Sindhi, Pashto) — future work.
- Mobile or web clients. Desktop Electron only.
- Multi-user support, accounts, or sync.
- **Generating submittable assignment answers.** Explicitly out of scope. See §8.

---

## 4. Decisions Locked During Brainstorming

| Decision | Choice | Rationale |
|---|---|---|
| Focus area | Education | Repo already holds LMS integration, academic assistant, Urdu i18n specs — strongest evidence-to-claim ratio, aligns with Alkhidmat's mission |
| Narrative | Education spine, general engine | Demo stays student-focused; WhatsApp/email/weather framed as student life management |
| Voice input | Code-switched Roman Urdu | How Pakistani students actually speak to a computer |
| Flagship demo | Assignment tutor | Reuses the most existing code, lands the education story |
| ASR | Hybrid: local Whisper default, Alibaba ASR opt-in | Keeps the submitted "on-device" claim true, makes Urdu actually work, deepens platform integration |
| Brain | Qwen default, Claude power mode | Hackathon scoring favours Alibaba Cloud; Claude retained for hard reasoning |
| Architecture | MCP tool host | Capabilities become servers, not code branches |

---

## 5. Blockers Found in the Existing Code

These were confirmed by reading source, not documentation. Each must be fixed.

### 5.1 Whisper models are English-only — HARD BLOCKER

- `apps/electron/src/main/whisper-service.ts:10` — `DEFAULT_MODEL_ID = 'Xenova/whisper-medium.en'`
- `apps/electron/src/main/main.ts:553` — fallback `'Xenova/whisper-small.en'`
- `apps/electron/src/renderer/onboarding/onboarding.html:80` — advertises `whisper-medium.en`

The `.en` checkpoints have no multilingual decoder. They **cannot** transcribe Urdu.
Additionally `whisper-service.ts:114` never passes a `language` option, so the model
cannot be steered even after a swap.

Dropping `.en` is parameter-count neutral (`small.en` and `small` are both 244M), so the
swap itself is cheap. The risk is quality: Urdu is low-resource in Whisper's training
data. `small` will likely be rough; `medium` (~1.5GB) is the realistic floor. This is
precisely why ASR is hybrid.

### 5.2 CommandDetector is structurally English-only — HARD BLOCKER

`apps/electron/src/main/agent/command-detector.ts:8-32` anchors every pattern to a verb
at the **start** of the string (`^open`, `^go to`, `^type`).

**Urdu is verb-final.** "Open Chrome" is "کروم کھولو" — verb last. Adding Urdu vocabulary
to a `^`-anchored list cannot work; the anchoring itself is wrong for the language. Today
every Urdu utterance falls through to `isCommand: false` and is silently treated as
dictation.

### 5.3 Academic assistant generates answers — ETHICAL / SCORING BLOCKER

- `apps/electron/src/main/agent/academic-assistant.ts:46` — `ACADEMIC_SYSTEM_PROMPT`
  begins "You are an academic writing assistant. Generate well-structured, scholarly
  answers for university assignments."
- `academic-assistant.ts:225` — "Generate a comprehensive academic answer for this
  assignment."

To a panel run by an education-focused NGO this reads as cheating automation and could
disqualify an otherwise strong entry. See §8.

### 5.4 IntentClassifier is single-shot and English-only

`apps/electron/src/main/agent/intent-classifier.ts:16-20` defines 7 action types and an
English-only prompt. Single-shot classification cannot express multi-step tool chains.
This component is replaced by the agent loop in §6.2.

---

## 6. Architecture

```
Electron main process
├── SpeechService          [NEW]        local Whisper ⇄ Alibaba ASR
├── AgentService       [REWRITTEN]      single-shot classify → tool-use loop
│   ├── LLMService      [EXTENDED]      + Qwen (default), Claude = power mode
│   └── MCPHost            [NEW]
│       ├── ToolRegistry                aggregates tools across servers
│       ├── PermissionGate              confirm before side effects
│       └── servers:
│           ├── flick-desktop    ← wraps existing ActionExecutor
│           ├── flick-browser    ← wraps existing BrowserAgent + ReactLoop
│           ├── flick-tutor      ← wraps LMS nav + assignment extraction
│           ├── flick-whatsapp   [NEW]  Playwright persistent session
│           ├── flick-weather    [NEW]
│           └── flick-gmail      [NEW]
```

**Nothing is deleted.** `ActionExecutor`, `BrowserAgent`, `ReactLoop` and the LMS code all
survive, wrapped as tools rather than called directly. `IntentClassifier` is the sole
component genuinely replaced, because a tool-use loop subsumes single-shot classification.

### 6.1 SpeechService

Mirrors the existing `LLMService` pattern — the codebase already hides four LLM vendors
behind one interface, so ASR uses the same shape.

```ts
interface ASRProvider {
  readonly id: 'local-whisper' | 'alibaba';
  transcribe(audio: Buffer, language: LanguageHint): Promise<TranscriptionResult>;
}
```

- `LocalWhisperProvider` — wraps the existing `WhisperService`; model IDs swapped to
  multilingual variants; `language` passed through to the transcriber.
- `AlibabaASRProvider` — DashScope ASR.
- `SpeechService` selects by user setting, and **falls back to local on any network
  failure**. Offline always works.

### 6.2 AgentService — the tool-use loop

Replaces single-shot classification with the loop that makes agents work:

```
transcript
  → CommandDetector (§6.4)
      ├── dictation → clipboard + history, no LLM call, loop ends
      └── command   ↓
  → LLM (with tool schemas from ToolRegistry)
  → tool call(s)
  → PermissionGate (if side-effecting)
  → execute via MCPHost
  → results back to LLM
  → repeat until done
  → final spoken response
```

This is the same loop that lets an agent create a GitHub repo and push to it from one
instruction — the user's own reference point for the desired behaviour.

### 6.3 The language boundary

The single most important design rule:

> **Understand in any language. Act in English. Reply in the student's language.**

The LLM accepts English, Urdu script, or Roman Urdu, but **always** emits English tool
names and arguments. `open_application("chrome")` is identical whether the student said
"Open Chrome" or "Chrome open karo". The entire execution layer stays language-agnostic
and untouched. A `responseLanguage` field carries the student's language back out for the
spoken reply.

Language handling therefore exists only at two edges: ASR in, response out.

### 6.4 CommandDetector rewrite

**Why this survives the move to a tool-use loop:** the detector is not a classifier, it is
a *gate*. It decides whether a transcript is worth an LLM call at all. Flick is also a
dictation tool — if the student is dictating notes, every utterance must go to the
clipboard for free, not to a paid agent loop. `IntentClassifier` is replaced; the detector
is kept and rewritten.

Two tiers.

**Tier 1 — local, free, sub-millisecond.** Normalize first (lowercase, collapse repeated
characters, strip diacritics), then match:

- English: existing `^verb` patterns, kept as-is
- Roman Urdu: verb **stems at the end** — `khol`, `kar`, `chala`, `dikha`, `samjha`,
  `bana`, `band`
- Urdu script: `U+0600–U+06FF` detection plus the same verb-final stems

Stem matching rather than whole words is what makes this tractable. Roman Urdu spelling is
wildly inconsistent — "karo / kro / kar do", "kholo / khol do" — but the stem is stable.

**Tier 2 — LLM fallback.** If Tier 1 misses *and* the text carries any Urdu signal,
classify anyway rather than silently dropping to dictation. This prevents the failure mode
where Flick simply sits there during the demo.

Confidence scoring keeps the existing scheme (0.8 base for a pattern match, +0.1 for
utterances under 6 words) for consistency with current behaviour.

### 6.5 PermissionGate

Any side-effecting tool call — sending a WhatsApp message, sending email, deleting
anything — requires explicit confirmation before execution.

This is a correctness feature, not bureaucracy. Voice transcription **will** mishear a
contact name eventually, and a message sent to the wrong person is unrecoverable. It also
demonstrates safety thinking to judges.

Read-only calls (weather, reading email, reading an assignment) execute without prompting.

### 6.6 TutorService

Keeps everything that works — LMS navigation, login wait, assignment extraction. Replaces
only the generation prompt. Output is:

1. What the assignment is actually asking, restated simply
2. The concepts the student needs to understand
3. A step-by-step approach — the method, not the content
4. Self-check questions

The existing `pdfkit` code is **repurposed rather than deleted**: it now exports the study
guide as a PDF instead of an answer.

### 6.7 QwenProvider

- Add `'qwen'` to the `ProviderId` union at
  `apps/electron/src/main/agent/llm/providers/llm-provider.ts:1`
- DashScope exposes an **OpenAI-compatible endpoint**, so `QwenProvider` is close to a
  copy of the existing `openai-provider.ts` with a different base URL
- Vision-capable Qwen models can also serve the browser agent's ReAct loop
- Register in the provider registry, add to settings UI, wire key validation

---

## 7. Security

### 7.1 API key handling

The user enters their key in the settings UI (renderer). It must **never live or execute
in the renderer process** — the browser agent loads arbitrary web pages, and a key held in
the renderer is reachable from that context.

Required flow:

```
renderer (collect) → IPC → main process → encrypted storage → API calls fire from main
```

The existing code already follows this pattern via `electron-store` + `LLMService` in
main. **Upgrade to Electron `safeStorage`** for OS-level encryption at rest. Do not move
key handling into the renderer while building new UI.

### 7.2 WhatsApp account risk

Driving WhatsApp Web with Playwright violates WhatsApp's Terms of Service. Ban risk is
lower for occasional personal messages than for bulk sending, but it is **not zero**.

**Development and demos must use a spare SIM / secondary number.** Never the primary
number.

---

## 8. The Tutoring Constraint

Flick must never produce submittable assignment prose. This is both an ethical position
and a scoring necessity given the judging panel.

Enforcement:

- `ACADEMIC_SYSTEM_PROMPT` (`academic-assistant.ts:46`) is rewritten to a tutoring prompt
- A test asserts the tutor prompt never requests answer text
- No demo, slide, README line, or form field describes answer generation

Everything the assignment-answering path did — LMS navigation, extraction, PDF output —
is retained and redirected toward explanation.

---

## 9. Testing Strategy

| Surface | Approach | Why |
|---|---|---|
| `CommandDetector` | Table-driven unit tests | Pure function, no I/O — highest value per test. Cases across English, Urdu script, Roman Urdu, code-switched, and dictation negatives |
| Agent tool loop | Mocked LLM + fake MCP servers | Assert tool chaining, permission gating, and error recovery without network |
| `TutorService` | Prompt assertion | Guarantees §8 holds |
| Providers | Mocked HTTP | Response parsing and error mapping |
| `PermissionGate` | Unit tests | Assert side-effecting tools always prompt; read-only never do |

---

## 10. Risks and Spikes

### Spike 1 — ASR reality check (day 1, ~1 hour)

Record ~10 real code-switched utterances. Run through multilingual Whisper **and** Alibaba
ASR. Compare transcripts side by side.

Everything downstream assumes at least one produces usable text for input like "Mera
assignment kholo aur samjhao". Building a detector against an unverified transcript format
is the largest avoidable risk in this plan.

### Spike 2 — Qwen tool-calling reliability (day 1)

Can Qwen chain multiple MCP tool calls without falling apart? **This is the biggest unknown
in the entire design.**

If it cannot, flip the agent loop default to Claude and keep Qwen for Urdu intent
classification — still a genuine Alibaba integration. This must be discovered in week one,
not week three.

### Other risks

| Risk | Mitigation |
|---|---|
| Whisper Urdu quality | Hybrid ASR; Alibaba path as the quality escape hatch |
| Demo-day network failure | Local ASR fallback + **pre-recorded fallback video** |
| LMS page flakiness in ReAct loop | Demo against a stable page; recorded fallback |
| 1.5GB model download | Pre-download and verify before demo day |
| WhatsApp ban | Spare SIM only |

---

## 11. Sequencing

**Week 1 — foundation.** Spikes 1 and 2 on day one. Then the MCP host (client, registry,
routing, permission gate). Then the Urdu-aware `CommandDetector` rewrite with its test
table.

**Week 2 — capabilities as servers.** Weather and general Q&A land in roughly a day.
WhatsApp plus the confirm-gate, ~2 days. Tutor server wrapping existing LMS and browser
code, ~2–3 days.

**Week 3 — Gmail, polish, rehearsal.** Gmail OAuth is the slowest of the small tasks.
Then the README and branding rewrite, the demo script, and the pre-recorded fallback.
Remaining time is buffer, which will be used.

MCP host goes first because it is a multiplier, not a peer task:

| Capability | Without MCP host | As an MCP server |
|---|---|---|
| Weather | new intent + executor branch + prompt changes | ~50 lines |
| General Q&A | prompt plumbing | free — no tools needed |
| WhatsApp | bespoke executor branch | one server |
| Gmail | bespoke executor branch | one server (OAuth is the real cost) |
| Tutor | as originally scoped | one server wrapping existing code |

Built last, the integration cost is paid twice.

---

## 12. Prerequisites — Start Immediately

These have lead times that can block week one:

- **Alibaba Cloud account + Model Studio API key.** Account verification can take days
  from Pakistan. Blocks both spikes.
- **Spare SIM for WhatsApp development.** Never the primary number.
- **Google Cloud project** for Gmail OAuth. Consent screen setup is slow.
- **Whisper multilingual model** pre-downloaded (~1.5GB for medium).

---

## 13. Known Cosmetic Debt

`README.md` still describes the project as "Voice to Text" and contains `YOUR_USERNAME`
placeholders in its clone URLs. It is the first file a judge opens. Rewritten in week 3.
