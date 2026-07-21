# Flick Plan 1 — Urdu-Aware Input Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Flick understand spoken commands in English, Urdu script, and code-switched Roman Urdu, and run on Alibaba Cloud Qwen.

**Architecture:** A pure-function language layer (`normalize` → `detectLanguage` → `CommandDetector`) sits in front of the existing agent pipeline. English keeps its verb-initial patterns; Urdu gets verb-final stem matching, because Urdu puts the verb last. Whisper swaps to multilingual checkpoints with an explicit `language` hint. Qwen joins the existing provider registry as a near-copy of the OpenAI provider.

**Tech Stack:** TypeScript 5.3 (CommonJS, ES2022, strict), Electron 28, Vitest, `@xenova/transformers` Whisper, Alibaba Cloud DashScope (OpenAI-compatible endpoint).

**Source spec:** `documantation/2026-07-21-flick-mcp-agent-design.md`

## Global Constraints

- All new code is TypeScript, `strict: true`, CommonJS module output, ES2022 target.
- Work happens in `apps/electron/`. Run every command from that directory.
- API keys never live or execute in the renderer process. Main process only. (Spec §7.1)
- Nothing in this plan may generate submittable assignment answers. (Spec §8)
- The `DetectionResult` interface at `src/shared/types.ts:143` is consumed by
  `agent-service.ts:68`. Extending it is allowed; removing existing fields is not.
- Commit after every task. Never commit a failing test.

## Plan Sequence

| Plan | Scope | Status |
|---|---|---|
| **1 — Input pipeline** | Language layer, detector rewrite, multilingual ASR, Qwen provider | **this document** |
| 2 — MCP host | `MCPHost`, `ToolRegistry`, `PermissionGate`, agent tool loop | not yet written |
| 3 — Capability servers | desktop, browser, tutor, whatsapp, weather, gmail | not yet written |
| 4 — Polish | README/branding rewrite, demo script, packaging | not yet written |

Plan 1 delivers working software on its own: after Task 6, Flick responds to Urdu voice
commands and can run entirely on Qwen.

---

### Task 1: Test Infrastructure

There is currently no test runner in this repo. Everything downstream depends on this.

**Files:**
- Create: `apps/electron/vitest.config.mts`
- Modify: `apps/electron/package.json:7-11` (scripts), `:22-29` (devDependencies)
- Modify: `apps/electron/tsconfig.json:20` (exclude tests from the build)

**Interfaces:**
- Consumes: nothing
- Produces: `npm test` and `npm run test:watch` commands used by every later task

- [ ] **Step 1: Install Vitest**

```bash
cd apps/electron
npm install -D vitest@^2.1.0
```

- [ ] **Step 2: Create the Vitest config**

Uses `.mts` because `tsconfig.json` sets `"module": "commonjs"`, which conflicts with a
`.ts` config file using ESM `export default`.

Create `apps/electron/vitest.config.mts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
```

- [ ] **Step 3: Add test scripts**

In `apps/electron/package.json`, replace the `"scripts"` block:

```json
  "scripts": {
    "dev": "tsc && node scripts/copy-assets.js && electron build/main/main.js",
    "build": "tsc && node scripts/copy-assets.js",
    "package": "tsc && node scripts/copy-assets.js && electron-builder --win",
    "test": "vitest run",
    "test:watch": "vitest"
  },
```

- [ ] **Step 4: Keep test files out of the production build**

In `apps/electron/tsconfig.json`, replace the `"exclude"` line:

```json
  "exclude": ["node_modules", "build", "dist", "src/**/*.test.ts"]
```

- [ ] **Step 5: Add a smoke test proving the runner works**

Create `apps/electron/src/main/agent/lang/smoke.test.ts`:

```ts
import { describe, it, expect } from 'vitest';

describe('test infrastructure', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 6: Run the test**

Run: `npm test`
Expected: PASS — `1 passed (1)`

- [ ] **Step 7: Verify the production build still compiles**

Run: `npm run build`
Expected: exit 0, no TypeScript errors, no `smoke.test.js` inside `build/`.

- [ ] **Step 8: Commit**

```bash
git add apps/electron/package.json apps/electron/package-lock.json apps/electron/tsconfig.json apps/electron/vitest.config.mts apps/electron/src/main/agent/lang/smoke.test.ts
git commit -m "test: add Vitest infrastructure"
```

---

### Task 2: Text Normalizer

Roman Urdu spelling is wildly inconsistent — "karo / kro / kar do", "kholo / khollo".
Normalizing before matching is what keeps the stem list small.

**Files:**
- Create: `apps/electron/src/main/agent/lang/normalize.ts`
- Create: `apps/electron/src/main/agent/lang/normalize.test.ts`
- Delete: `apps/electron/src/main/agent/lang/smoke.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `normalize(text: string): string` — lowercase, strip diacritics and punctuation, collapse whitespace
  - `collapseRepeats(text: string): string` — squash runs of a repeated letter to one

`collapseRepeats` is deliberately separate. It is applied only on the Urdu stem-matching
path, because collapsing doubles would corrupt English words ("assignment" → "asignment")
and the English matcher must see the original spelling.

- [ ] **Step 1: Write the failing tests**

Create `apps/electron/src/main/agent/lang/normalize.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { normalize, collapseRepeats } from './normalize';

describe('normalize', () => {
  it('lowercases and collapses whitespace', () => {
    expect(normalize('  Chrome   OPEN   Karo  ')).toBe('chrome open karo');
  });

  it('strips punctuation', () => {
    expect(normalize('Chrome open karo!!!')).toBe('chrome open karo');
  });

  it('preserves Urdu script', () => {
    expect(normalize('کروم کھولو')).toBe('کروم کھولو');
  });

  it('strips Urdu diacritics', () => {
    expect(normalize('کَھولو')).toBe('کھولو');
  });

  it('returns empty string for whitespace-only input', () => {
    expect(normalize('   ')).toBe('');
  });
});

describe('collapseRepeats', () => {
  it('collapses doubled letters to one', () => {
    expect(collapseRepeats('khollo')).toBe('kholo');
  });

  it('leaves single letters untouched', () => {
    expect(collapseRepeats('kholo')).toBe('kholo');
  });

  it('collapses long runs', () => {
    expect(collapseRepeats('kaaaro')).toBe('karo');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "./normalize"`

- [ ] **Step 3: Write the implementation**

Create `apps/electron/src/main/agent/lang/normalize.ts`:

```ts
/** Urdu/Arabic combining marks (harakat) and the tatweel elongation character. */
const DIACRITICS = /[ً-ْٰـ]/g;

/**
 * Canonical form used by all language matching: lowercase, no diacritics,
 * no punctuation, single-spaced.
 *
 * Urdu script is preserved — \p{L} covers it.
 */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFC')
    .replace(DIACRITICS, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Squashes runs of a repeated character to a single occurrence.
 *
 * Applied ONLY on the Roman Urdu stem-matching path. English matching must see
 * original spelling, since this would turn "assignment" into "asignment".
 */
export function collapseRepeats(text: string): string {
  return text.replace(/(.)\1+/gu, '$1');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — 8 passed

- [ ] **Step 5: Remove the smoke test**

```bash
rm apps/electron/src/main/agent/lang/smoke.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add apps/electron/src/main/agent/lang/
git commit -m "feat(lang): add text normalizer for Urdu and English matching"
```

---

### Task 3: Language Detection

Tells the rest of the pipeline which language the student used, so Flick can reply in it.

**Files:**
- Create: `apps/electron/src/main/agent/lang/detect-language.ts`
- Create: `apps/electron/src/main/agent/lang/detect-language.test.ts`

**Interfaces:**
- Consumes: `normalize` from `./normalize`
- Produces:
  - `detectLanguage(text: string): LanguageHint`
  - `hasUrduScript(text: string): boolean`

`LanguageHint` is declared in `src/shared/types.ts`, not here. Task 4 adds it to the
shared `DetectionResult`, and `shared/` must never import from `main/` — that would
invert the dependency direction the codebase already follows.

Marker words are chosen to avoid English collisions. "do", "main", and "hai" are excluded
despite being common Urdu words, because they collide with English "do", "main", and the
surname "Hai". "aur", "kya", "mera", "mujhe" have no such collision.

- [ ] **Step 1: Write the failing tests**

Create `apps/electron/src/main/agent/lang/detect-language.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { detectLanguage, hasUrduScript } from './detect-language';

describe('hasUrduScript', () => {
  it('detects Urdu script', () => {
    expect(hasUrduScript('کھولو')).toBe(true);
  });

  it('returns false for pure Latin', () => {
    expect(hasUrduScript('open chrome')).toBe(false);
  });
});

describe('detectLanguage', () => {
  it('detects plain English', () => {
    expect(detectLanguage('open chrome')).toBe('en');
  });

  it('detects pure Urdu script', () => {
    expect(detectLanguage('کروم کھولو')).toBe('ur');
  });

  it('detects Urdu script mixed with Latin', () => {
    expect(detectLanguage('chrome کھولو')).toBe('mixed');
  });

  it('detects Roman Urdu by marker word', () => {
    expect(detectLanguage('chrome open karo')).toBe('roman-ur');
  });

  it('detects Roman Urdu from possessives', () => {
    expect(detectLanguage('mera assignment kholo')).toBe('roman-ur');
  });

  it('does not misread English containing "do" as Roman Urdu', () => {
    expect(detectLanguage('do the search')).toBe('en');
  });

  it('does not misread English containing "main" as Roman Urdu', () => {
    expect(detectLanguage('open the main folder')).toBe('en');
  });

  it('treats empty input as English', () => {
    expect(detectLanguage('')).toBe('en');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "./detect-language"`

- [ ] **Step 3: Declare the shared LanguageHint type**

In `apps/electron/src/shared/types.ts`, add near the other type declarations:

```ts
export type LanguageHint = 'en' | 'ur' | 'roman-ur' | 'mixed';
```

- [ ] **Step 4: Write the implementation**

Create `apps/electron/src/main/agent/lang/detect-language.ts`:

```ts
import { normalize } from './normalize';
import type { LanguageHint } from '../../../shared/types';

export type { LanguageHint };

/** Arabic block, which covers the Urdu alphabet. */
const URDU_SCRIPT = /[؀-ۿ]/;

const LATIN = /[a-z]/;

/**
 * High-frequency Roman Urdu words with no common English collision.
 *
 * Deliberately excludes "do", "main", "hai", "to", "be" — all frequent in Urdu
 * but indistinguishable from ordinary English words in a code-switched sentence.
 */
const ROMAN_URDU_MARKERS = new Set([
  'karo', 'kro', 'kar', 'kre', 'karna',
  'kholo', 'khol', 'kholna',
  'mera', 'meri', 'mere', 'mujhe', 'mujhko',
  'aap', 'aapka', 'tum', 'tumhara',
  'kya', 'kyun', 'kaise', 'kahan', 'kab',
  'aur', 'phir', 'abhi', 'jaldi',
  'nahi', 'nahin', 'haan',
  'batao', 'bata', 'dikhao', 'dikha',
  'samjhao', 'samjha', 'banao', 'bana',
  'chalao', 'chala', 'bhejo', 'bhej',
  'wala', 'wali', 'sath', 'liye',
]);

export function hasUrduScript(text: string): boolean {
  return URDU_SCRIPT.test(text);
}

export function detectLanguage(text: string): LanguageHint {
  const normalized = normalize(text);

  if (!normalized) {
    return 'en';
  }

  const urdu = hasUrduScript(normalized);
  const latin = LATIN.test(normalized);

  if (urdu && latin) {
    return 'mixed';
  }
  if (urdu) {
    return 'ur';
  }

  const tokens = normalized.split(' ');
  if (tokens.some((token) => ROMAN_URDU_MARKERS.has(token))) {
    return 'roman-ur';
  }

  return 'en';
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — 18 passed

- [ ] **Step 6: Commit**

```bash
git add apps/electron/src/main/agent/lang/ apps/electron/src/shared/types.ts
git commit -m "feat(lang): add language detection for Urdu, Roman Urdu, and English"
```

---

### Task 4: CommandDetector Rewrite

This fixes spec blocker §5.2. The current detector anchors every pattern to a verb at the
*start* of the string (`command-detector.ts:8-32`), but Urdu is verb-final, so no Urdu
utterance can ever match. Today they all silently fall through to dictation.

**Files:**
- Create: `apps/electron/src/main/agent/lang/urdu-verbs.ts`
- Modify: `apps/electron/src/main/agent/command-detector.ts` (full rewrite)
- Create: `apps/electron/src/main/agent/command-detector.test.ts`
- Modify: `apps/electron/src/shared/types.ts:143-147`

**Interfaces:**
- Consumes: `normalize`, `collapseRepeats`, `detectLanguage`, `LanguageHint`
- Produces:
  - `matchesUrduVerb(token: string): boolean`
  - `CommandDetector.detect(text: string): DetectionResult`
  - `DetectionResult` gains `language: LanguageHint`

- [ ] **Step 1: Extend the DetectionResult type**

In `apps/electron/src/shared/types.ts`, replace lines 143-147:

```ts
export interface DetectionResult {
  isCommand: boolean;
  confidence: number;
  matchedPattern?: string;
  language: LanguageHint;
}
```

No import is needed — `LanguageHint` was declared in this same file in Task 3.

- [ ] **Step 2: Write the failing tests**

Create `apps/electron/src/main/agent/command-detector.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { CommandDetector } from './command-detector';

const detector = new CommandDetector();

describe('CommandDetector — English (verb-initial)', () => {
  it('detects "open chrome"', () => {
    const result = detector.detect('open chrome');
    expect(result.isCommand).toBe(true);
    expect(result.language).toBe('en');
  });

  it('detects "take a screenshot"', () => {
    expect(detector.detect('take a screenshot').isCommand).toBe(true);
  });

  it('treats plain prose as dictation', () => {
    expect(detector.detect('the meeting went well today').isCommand).toBe(false);
  });
});

describe('CommandDetector — Roman Urdu (verb-final)', () => {
  it('detects "chrome open karo"', () => {
    const result = detector.detect('chrome open karo');
    expect(result.isCommand).toBe(true);
    expect(result.language).toBe('roman-ur');
  });

  it('detects "mera assignment kholo"', () => {
    expect(detector.detect('mera assignment kholo').isCommand).toBe(true);
  });

  it('detects the flagship demo phrase', () => {
    expect(detector.detect('mera assignment kholo aur samjhao').isCommand).toBe(true);
  });

  it('detects vowel-dropped spelling "chrome kro"', () => {
    expect(detector.detect('chrome kro').isCommand).toBe(true);
  });

  it('detects doubled-letter spelling "chrome khollo"', () => {
    expect(detector.detect('chrome khollo').isCommand).toBe(true);
  });

  it('detects a two-token verb "chrome khol do"', () => {
    expect(detector.detect('chrome khol do').isCommand).toBe(true);
  });

  it('does not match "sunday" as the verb stem "sun"', () => {
    expect(detector.detect('meeting sunday').isCommand).toBe(false);
  });
});

describe('CommandDetector — Urdu script (verb-final)', () => {
  it('detects "کروم کھولو"', () => {
    const result = detector.detect('کروم کھولو');
    expect(result.isCommand).toBe(true);
    expect(result.language).toBe('ur');
  });

  it('detects "مجھے موسم بتاؤ"', () => {
    expect(detector.detect('مجھے موسم بتاؤ').isCommand).toBe(true);
  });
});

describe('CommandDetector — edge cases', () => {
  it('returns isCommand false for empty input', () => {
    const result = detector.detect('');
    expect(result.isCommand).toBe(false);
    expect(result.confidence).toBe(0);
  });

  it('returns isCommand false for whitespace only', () => {
    expect(detector.detect('    ').isCommand).toBe(false);
  });

  it('gives short commands higher confidence than long ones', () => {
    const short = detector.detect('chrome kholo');
    const long = detector.detect('please can you now go ahead and open chrome for me');
    expect(short.confidence).toBeGreaterThan(long.confidence);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — Urdu cases return `isCommand: false`, and `language` is undefined.

- [ ] **Step 4: Create the Urdu verb matcher**

Create `apps/electron/src/main/agent/lang/urdu-verbs.ts`:

```ts
import { collapseRepeats } from './normalize';

/**
 * Roman Urdu imperative verb stems, including common vowel-dropped spellings
 * ("kar" / "kr"). Stems rather than whole words, because Roman Urdu spelling
 * varies far too much to enumerate.
 */
const ROMAN_STEMS = [
  'khol', 'khl',      // open
  'kar', 'kr',        // do
  'chala', 'chla',    // run / play
  'dikha', 'dkha',    // show
  'samjha', 'smjha',  // explain
  'bana', 'bna',      // make
  'band', 'bnd',      // close
  'bhej', 'bhj',      // send
  'likh', 'lkh',      // write
  'dekh', 'dkh',      // look
  'bata', 'bta',      // tell
  'sun',              // listen
];

/**
 * Imperative endings that may follow a stem.
 *
 * The empty string is included so a bare stem ("khol", "kar") matches. Matching
 * is stem + suffix rather than prefix-only, which is what stops "sunday" from
 * matching the stem "sun".
 */
const SUFFIXES = ['', 'o', 'do', 'na', 'ao', 'aao', 'ein', 'en', 'ay', 'e', 'iye', 'ye'];

/** Urdu-script imperative verbs, matched whole. */
const SCRIPT_VERBS = new Set([
  'کھولو', 'کھول', 'کرو', 'کر', 'چلاؤ', 'چلا',
  'دکھاؤ', 'دکھا', 'سمجھاؤ', 'سمجھا', 'بناؤ', 'بنا',
  'بند', 'بھیجو', 'بھیج', 'لکھو', 'لکھ', 'بتاؤ', 'بتا',
  'دیکھو', 'دیکھ', 'سنو', 'سن',
]);

/**
 * True if the token is an Urdu imperative verb, in either script.
 */
export function matchesUrduVerb(token: string): boolean {
  if (SCRIPT_VERBS.has(token)) {
    return true;
  }

  const collapsed = collapseRepeats(token);

  return ROMAN_STEMS.some((stem) =>
    SUFFIXES.some((suffix) => collapsed === stem + suffix)
  );
}
```

- [ ] **Step 5: Rewrite CommandDetector**

Replace the entire contents of `apps/electron/src/main/agent/command-detector.ts`:

```ts
import { DetectionResult } from '../../shared/types';
import { normalize } from './lang/normalize';
import { detectLanguage } from './lang/detect-language';
import { matchesUrduVerb } from './lang/urdu-verbs';

/** Number of trailing tokens checked for an Urdu verb. */
const VERB_FINAL_WINDOW = 2;

/** Base confidence for a pattern match, matching prior behaviour. */
const BASE_CONFIDENCE = 0.8;

/** Bonus for terse utterances, matching prior behaviour. */
const SHORT_UTTERANCE_BONUS = 0.1;
const SHORT_UTTERANCE_MAX_WORDS = 6;

/**
 * Local command detection. No API call — runs in-process in well under a
 * millisecond.
 *
 * This is a GATE, not a classifier. It decides only whether a transcript is
 * worth an LLM call at all, so that plain dictation still reaches the clipboard
 * for free. Intent is determined later by the agent tool loop.
 *
 * Two matching strategies, because word order differs by language:
 *   - English is verb-initial  → anchored patterns at the start
 *   - Urdu is verb-final       → stem matching on the last tokens
 */
export class CommandDetector {
  private readonly englishPatterns: { regex: RegExp; label: string }[] = [
    { regex: /^take\s+a\s+screenshot/i, label: 'take a screenshot' },
    { regex: /^take\s+screenshot/i, label: 'take screenshot' },
    { regex: /^go\s+to/i, label: 'go to' },
    { regex: /^volume\s+up/i, label: 'volume up' },
    { regex: /^volume\s+down/i, label: 'volume down' },
    { regex: /^open/i, label: 'open' },
    { regex: /^type/i, label: 'type' },
    { regex: /^search/i, label: 'search' },
    { regex: /^mute/i, label: 'mute' },
    { regex: /^unmute/i, label: 'unmute' },
    { regex: /^launch/i, label: 'launch' },
    { regex: /^close/i, label: 'close' },
    { regex: /^find/i, label: 'find' },
    { regex: /^navigate/i, label: 'navigate' },
    { regex: /^play/i, label: 'play' },
    { regex: /^pause/i, label: 'pause' },
    { regex: /^stop/i, label: 'stop' },
    { regex: /^resume/i, label: 'resume' },
    { regex: /^next/i, label: 'next' },
    { regex: /^previous/i, label: 'previous' },
    { regex: /^skip/i, label: 'skip' },
    { regex: /^lock/i, label: 'lock' },
    { regex: /^brightness/i, label: 'brightness' },
  ];

  detect(text: string): DetectionResult {
    const normalized = normalize(text);
    const language = detectLanguage(text);

    if (!normalized) {
      return { isCommand: false, confidence: 0, language };
    }

    const tokens = normalized.split(' ');

    const matchedPattern =
      this.matchEnglish(normalized) ?? this.matchVerbFinal(tokens);

    if (!matchedPattern) {
      return { isCommand: false, confidence: 0, language };
    }

    let confidence = BASE_CONFIDENCE;
    if (tokens.length < SHORT_UTTERANCE_MAX_WORDS) {
      confidence += SHORT_UTTERANCE_BONUS;
    }

    return {
      isCommand: true,
      confidence: Math.min(confidence, 1.0),
      matchedPattern,
      language,
    };
  }

  /** English: verb at the start. */
  private matchEnglish(normalized: string): string | undefined {
    return this.englishPatterns.find(({ regex }) => regex.test(normalized))?.label;
  }

  /** Urdu (both scripts): verb at the end. */
  private matchVerbFinal(tokens: string[]): string | undefined {
    const tail = tokens.slice(-VERB_FINAL_WINDOW);
    return tail.find((token) => matchesUrduVerb(token));
  }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — 33 passed

- [ ] **Step 7: Verify the build still compiles**

Run: `npm run build`
Expected: exit 0. If `agent-service.ts` errors on the new required `language` field,
that is expected only if it constructs a `DetectionResult` itself — it does not; it only
reads `detection.isCommand` at line 68. No change needed there.

- [ ] **Step 8: Commit**

```bash
git add apps/electron/src/main/agent/ apps/electron/src/shared/types.ts
git commit -m "feat(agent): rewrite CommandDetector for verb-final Urdu

English keeps verb-initial patterns. Urdu is verb-final, so anchored
^verb patterns could never match it — every Urdu utterance previously
fell through to dictation silently."
```

---

### Task 5: Multilingual Whisper

This fixes spec blocker §5.1. Every current checkpoint is an `.en` build with no
multilingual decoder, so Urdu transcription is impossible regardless of the detector work
in Task 4.

**Files:**
- Modify: `apps/electron/src/main/whisper-service.ts:10`, `:56`, `:114-118`
- Modify: `apps/electron/src/main/main.ts:553`
- Modify: `apps/electron/src/renderer/onboarding/onboarding.html:80`

**Interfaces:**
- Consumes: `LanguageHint` from `./agent/lang/detect-language`
- Produces: `WhisperService.transcribe(wavFilePath: string, language?: 'en' | 'ur' | 'auto')`

- [ ] **Step 1: Swap the default model to multilingual**

In `apps/electron/src/main/whisper-service.ts` line 10:

```ts
const DEFAULT_MODEL_ID = 'Xenova/whisper-medium';
```

Dropping `.en` is parameter-count neutral — `medium.en` and `medium` are both 769M.

- [ ] **Step 2: Fix the stale log line**

In `apps/electron/src/main/whisper-service.ts` line 56, replace the hardcoded model name:

```ts
      console.log(`[Whisper] Loading model ${DEFAULT_MODEL_ID}...`);
```

- [ ] **Step 3: Pass a language hint to the transcriber**

In `apps/electron/src/main/whisper-service.ts`, change the `transcribe` signature and the
transcriber options (currently lines 101 and 114-118):

```ts
  async transcribe(
    wavFilePath: string,
    language: 'en' | 'ur' | 'auto' = 'auto'
  ): Promise<TranscriptionResult> {
```

and:

```ts
      const result = await transcriber(audioData, {
        chunk_length_s: 30,
        stride_length_s: 5,
        return_timestamps: false,
        sampling_rate: 16000,
        ...(language !== 'auto' ? { language, task: 'transcribe' } : {}),
      });
```

`'auto'` omits the option entirely, letting Whisper detect the language — which is the
correct default for code-switched speech, where forcing `ur` pushes output into Urdu
script and forcing `en` mangles Urdu words.

- [ ] **Step 4: Update the fallback model id**

In `apps/electron/src/main/main.ts` line 553:

```ts
    let modelId = modelName || 'Xenova/whisper-small';
```

- [ ] **Step 5: Update the user-facing model label**

In `apps/electron/src/renderer/onboarding/onboarding.html` line 80:

```html
    <p class="model-info">Model: Xenova/whisper-medium (multilingual, ONNX quantized)</p>
```

- [ ] **Step 6: Verify the build compiles**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 7: Manually verify transcription still works in English**

Run: `npm run dev`
Press the global hotkey, say "open chrome", confirm the transcript appears.

The multilingual model downloads on first run and is ~1.5GB. Expect a wait.

- [ ] **Step 8: Commit**

```bash
git add apps/electron/src/main/whisper-service.ts apps/electron/src/main/main.ts apps/electron/src/renderer/onboarding/onboarding.html
git commit -m "feat(whisper): swap to multilingual checkpoints and add language hint

.en checkpoints have no multilingual decoder and cannot transcribe Urdu
at all. Parameter count is unchanged."
```

---

### Task 6: Qwen Provider

Alibaba Cloud DashScope exposes an OpenAI-compatible endpoint, so this is close to a copy
of the existing OpenAI provider with a different base URL.

**Files:**
- Modify: `apps/electron/src/main/agent/llm/providers/llm-provider.ts:1`
- Create: `apps/electron/src/main/agent/llm/providers/qwen-provider.ts`
- Create: `apps/electron/src/main/agent/llm/providers/qwen-provider.test.ts`
- Modify: `apps/electron/src/main/agent/llm/provider-registry.ts`

**Interfaces:**
- Consumes: `LLMProvider`, `TextCompleteParams`, `VisionCompleteParams`, `LLMResult` from `./llm-provider`
- Produces: `class QwenProvider implements LLMProvider` with `id = 'qwen'`

**Prerequisite:** an Alibaba Cloud Model Studio API key. Account verification can take
days from Pakistan — start this before beginning the task. The unit tests below mock HTTP
and pass without a key; only the manual step needs one.

- [ ] **Step 1: Add 'qwen' to the ProviderId union**

In `apps/electron/src/main/agent/llm/providers/llm-provider.ts` line 1:

```ts
export type ProviderId = 'openai' | 'gemini' | 'deepseek' | 'anthropic' | 'qwen';
```

- [ ] **Step 2: Read the existing OpenAI provider**

Read `apps/electron/src/main/agent/llm/providers/openai-provider.ts` in full before
writing Task 6's implementation. The Qwen provider must mirror its error mapping and
response parsing exactly, so behaviour stays uniform across providers.

- [ ] **Step 3: Write the failing tests**

Create `apps/electron/src/main/agent/llm/providers/qwen-provider.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QwenProvider } from './qwen-provider';

describe('QwenProvider', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('reports its id', () => {
    expect(new QwenProvider().id).toBe('qwen');
  });

  it('returns an error when the key is missing', async () => {
    const result = await new QwenProvider().textComplete({
      apiKey: '',
      modelId: 'qwen-plus',
      systemPrompt: 'sys',
      userMessage: 'hi',
      jsonMode: false,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('missing_key');
    }
  });

  it('returns text on a successful completion', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: 'hello' } }] }),
      })
    );

    const result = await new QwenProvider().textComplete({
      apiKey: 'test-key',
      modelId: 'qwen-plus',
      systemPrompt: 'sys',
      userMessage: 'hi',
      jsonMode: false,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toBe('hello');
    }
  });

  it('maps HTTP 401 to invalid_key', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'unauthorized',
      })
    );

    const result = await new QwenProvider().textComplete({
      apiKey: 'bad-key',
      modelId: 'qwen-plus',
      systemPrompt: 'sys',
      userMessage: 'hi',
      jsonMode: false,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('invalid_key');
    }
  });

  it('maps an empty choices array to empty_response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ choices: [] }),
      })
    );

    const result = await new QwenProvider().textComplete({
      apiKey: 'test-key',
      modelId: 'qwen-plus',
      systemPrompt: 'sys',
      userMessage: 'hi',
      jsonMode: false,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('empty_response');
    }
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "./qwen-provider"`

- [ ] **Step 5: Write the implementation**

Create `apps/electron/src/main/agent/llm/providers/qwen-provider.ts`:

```ts
import {
  LLMProvider,
  LLMResult,
  ProviderId,
  TextCompleteParams,
  VisionCompleteParams,
} from './llm-provider';

/**
 * Alibaba Cloud Model Studio (DashScope), international endpoint.
 * OpenAI-compatible, so the request and response shapes match openai-provider.
 */
const BASE_URL = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';

export class QwenProvider implements LLMProvider {
  readonly id: ProviderId = 'qwen';

  async textComplete(params: TextCompleteParams): Promise<LLMResult> {
    return this.complete(params.apiKey, {
      model: params.modelId,
      messages: [
        { role: 'system', content: params.systemPrompt },
        { role: 'user', content: params.userMessage },
      ],
      ...(params.jsonMode ? { response_format: { type: 'json_object' } } : {}),
      ...(params.maxTokens ? { max_tokens: params.maxTokens } : {}),
    });
  }

  async visionComplete(params: VisionCompleteParams): Promise<LLMResult> {
    return this.complete(params.apiKey, {
      model: params.modelId,
      messages: [
        { role: 'system', content: params.systemPrompt },
        {
          role: 'user',
          content: [
            { type: 'text', text: params.userMessage },
            {
              type: 'image_url',
              image_url: { url: `data:image/png;base64,${params.imageBase64}` },
            },
          ],
        },
      ],
      ...(params.jsonMode ? { response_format: { type: 'json_object' } } : {}),
      ...(params.maxTokens ? { max_tokens: params.maxTokens } : {}),
    });
  }

  private async complete(apiKey: string, body: unknown): Promise<LLMResult> {
    if (!apiKey) {
      return {
        ok: false,
        error: {
          kind: 'missing_key',
          message: 'No Alibaba Cloud Model Studio API key configured.',
          providerId: this.id,
        },
      };
    }

    let response: Response;
    try {
      response = await fetch(`${BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      return {
        ok: false,
        error: {
          kind: 'network',
          message: err instanceof Error ? err.message : 'Network request failed.',
          providerId: this.id,
        },
      };
    }

    if (!response.ok) {
      return {
        ok: false,
        error: {
          kind: response.status === 401 || response.status === 403
            ? 'invalid_key'
            : 'http_error',
          message: `Qwen request failed with HTTP ${response.status}.`,
          providerId: this.id,
          httpStatus: response.status,
        },
      };
    }

    let payload: { choices?: { message?: { content?: string } }[] };
    try {
      payload = await response.json();
    } catch (err) {
      return {
        ok: false,
        error: {
          kind: 'parse_error',
          message: 'Qwen returned a response that was not valid JSON.',
          providerId: this.id,
        },
      };
    }

    const text = payload.choices?.[0]?.message?.content;
    if (!text) {
      return {
        ok: false,
        error: {
          kind: 'empty_response',
          message: 'Qwen returned no completion content.',
          providerId: this.id,
        },
      };
    }

    return { ok: true, text };
  }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — 38 passed

- [ ] **Step 7: Add Qwen to the provider registry**

In `apps/electron/src/main/agent/llm/provider-registry.ts`, append to `PROVIDER_REGISTRY`
after the `anthropic` entry:

```ts
  {
    id: 'qwen',
    displayName: 'Alibaba Cloud (Qwen)',
    models: [
      { id: 'qwen-plus', displayName: 'Qwen Plus', vision: false },
      { id: 'qwen-max', displayName: 'Qwen Max', vision: false },
      { id: 'qwen-vl-max', displayName: 'Qwen VL Max', vision: true },
    ],
  },
```

- [ ] **Step 8: Instantiate the provider in LLMService**

In `apps/electron/src/main/agent/llm/llm-service.ts`, add the import alongside the other
provider imports:

```ts
import { QwenProvider } from './providers/qwen-provider';
```

Add `qwen` to the api-key record (currently ending at line 132-133):

```ts
    anthropic: '',
    qwen: '',
  };
```

Add the instance to the constructor's provider map (currently lines 147-152):

```ts
    this.providers = {
      openai: providers?.openai ?? new OpenAIProvider(),
      gemini: providers?.gemini ?? new GeminiProvider(),
      deepseek: providers?.deepseek ?? new DeepSeekProvider(),
      anthropic: providers?.anthropic ?? new AnthropicProvider(),
      qwen: providers?.qwen ?? new QwenProvider(),
    };
```

Both are typed `Record<ProviderId, ...>`, so omitting either is a compile error rather
than a silent runtime gap.

- [ ] **Step 9: Verify the build compiles**

Run: `npm run build`
Expected: exit 0. Any `switch` on `ProviderId` that is now non-exhaustive will surface
here — fix each one by adding a `qwen` branch.

- [ ] **Step 10: Manual check with a real key**

Requires an Alibaba Cloud Model Studio key. Launch with `npm run dev`, enter the key in
Settings, select Qwen, and issue one command. Confirm a response returns.

- [ ] **Step 11: Commit**

```bash
git add apps/electron/src/main/agent/llm/
git commit -m "feat(llm): add Alibaba Cloud Qwen provider"
```

---

## Definition of Done for Plan 1

- [ ] `npm test` passes with 38 tests
- [ ] `npm run build` exits 0
- [ ] `detector.detect('mera assignment kholo aur samjhao').isCommand === true`
- [ ] Whisper loads a multilingual checkpoint and transcribes English speech
- [ ] Qwen answers a real prompt with a real key

## What Plan 1 Does Not Cover

- The ASR spike comparing Whisper against Alibaba ASR (spec §10, Spike 1) — needs
  recorded audio and an Alibaba key
- Qwen tool-calling reliability (spec §10, Spike 2) — belongs with Plan 2's tool loop
- `AlibabaASRProvider` and `SpeechService` routing (spec §6.1) — Plan 2
- Everything MCP (spec §6.2, §6.5) — Plan 2
- TutorService rewrite (spec §6.6, §8) — Plan 3
