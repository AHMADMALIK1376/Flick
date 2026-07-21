import { DetectionResult } from '../../shared/types';

/**
 * Local regex/keyword-based command detection.
 * No API call needed — runs entirely in-process with sub-millisecond latency.
 */
export class CommandDetector {
  private readonly patterns: { regex: RegExp; label: string }[] = [
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
    const trimmed = text.trim();

    if (!trimmed) {
      return { isCommand: false, confidence: 0 };
    }

    // Check for pattern match at the start of text
    for (const { regex, label } of this.patterns) {
      if (regex.test(trimmed)) {
        let confidence = 0.8; // Base confidence for pattern match

        // Short utterance bonus: < 6 words with action verb gets +0.1
        const wordCount = trimmed.split(/\s+/).length;
        if (wordCount < 6) {
          confidence += 0.1;
        }

        return {
          isCommand: true,
          confidence: Math.min(confidence, 1.0),
          matchedPattern: label,
        };
      }
    }

    // No pattern match — classify as dictation
    return { isCommand: false, confidence: 0 };
  }
}
