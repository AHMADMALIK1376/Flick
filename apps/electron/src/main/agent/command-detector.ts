import { DetectionResult } from '../../shared/types';
import { normalize } from './lang/normalize';
import { detectLanguage } from './lang/detect-language';
import { matchesUrduVerb } from './lang/urdu-verbs';
import { stripWakeWord } from './lang/wake-word';

/** Number of trailing tokens checked for an Urdu verb. */
const VERB_FINAL_WINDOW = 2;

/**
 * How many leading tokens may precede an English command verb.
 *
 * Real speech rarely starts on the verb — "in chrome open youtube", "can you
 * open chrome". Anchoring strictly at position 0 silently dropped those to
 * dictation. The window is kept small so ordinary prose that merely contains a
 * verb ("we should probably open that later") stays dictation.
 */
const ENGLISH_VERB_WINDOW = 3;

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

    // Drop any address to the assistant first, so naming her does not push the
    // verb past the lookahead window.
    const tokens = stripWakeWord(normalized.split(' '));

    const matchedPattern =
      this.matchEnglish(tokens) ?? this.matchVerbFinal(tokens);

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

  /** English: verb at or near the start. */
  private matchEnglish(tokens: string[]): string | undefined {
    const limit = Math.min(ENGLISH_VERB_WINDOW, tokens.length);
    for (let i = 0; i < limit; i++) {
      const candidate = tokens.slice(i).join(' ');
      const hit = this.englishPatterns.find(({ regex }) => regex.test(candidate));
      if (hit) return hit.label;
    }
    return undefined;
  }

  /** Urdu (both scripts): verb at the end. */
  private matchVerbFinal(tokens: string[]): string | undefined {
    const tail = tokens.slice(-VERB_FINAL_WINDOW);
    return tail.find((token) => matchesUrduVerb(token));
  }
}
