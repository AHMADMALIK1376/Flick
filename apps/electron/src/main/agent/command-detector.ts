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
