import { describe, it, expect } from 'vitest';
import {
  estimateImageTokens,
  estimateTextTokens,
  estimateCost,
  priceFor,
  formatUsage,
  UsageTracker,
} from './token-usage';
import { PROVIDER_REGISTRY } from './provider-registry';

describe('estimateImageTokens', () => {
  /**
   * page-analyzer.ts clips screenshots to exactly 1280x720, so this is the
   * real per-step cost of a browser task.
   */
  it('prices a 1280x720 browser screenshot', () => {
    expect(estimateImageTokens(1280, 720)).toBe(1229);
  });

  it('scales with area', () => {
    expect(estimateImageTokens(640, 360)).toBeLessThan(
      estimateImageTokens(1280, 720)
    );
  });

  it('returns zero for a zero dimension', () => {
    expect(estimateImageTokens(0, 720)).toBe(0);
    expect(estimateImageTokens(1280, 0)).toBe(0);
  });

  it('returns zero for negative input rather than a negative cost', () => {
    expect(estimateImageTokens(-1280, 720)).toBe(0);
  });
});

describe('estimateTextTokens', () => {
  it('approximates four characters per token', () => {
    expect(estimateTextTokens('12345678')).toBe(2);
  });

  it('returns zero for empty text', () => {
    expect(estimateTextTokens('')).toBe(0);
  });

  it('never returns a fraction', () => {
    expect(Number.isInteger(estimateTextTokens('abc'))).toBe(true);
  });
});

describe('priceFor', () => {
  it('uses the published Opus 4.8 rate', () => {
    const price = priceFor('anthropic', 'claude-opus-4-8');
    expect(price.inputPerMTok).toBe(5);
    expect(price.outputPerMTok).toBe(25);
    expect(price.exact).toBe(true);
  });

  it('falls back to a provider estimate for an unknown model', () => {
    const price = priceFor('anthropic', 'claude-something-new');
    expect(price.exact).toBe(false);
  });

  /**
   * Adding a provider without a price entry would silently report $0 spend.
   */
  it('has a price for every registered provider', () => {
    for (const { id } of PROVIDER_REGISTRY) {
      const price = priceFor(id, 'definitely-not-a-real-model');
      expect(price.inputPerMTok, `provider "${id}" has no price`).toBeGreaterThan(0);
      expect(price.outputPerMTok, `provider "${id}" has no price`).toBeGreaterThan(0);
    }
  });
});

describe('estimateCost', () => {
  it('prices input and output at their separate rates', () => {
    const cost = estimateCost(
      { inputTokens: 1_000_000, outputTokens: 1_000_000, imageTokens: 0 },
      'anthropic',
      'claude-opus-4-8'
    );
    expect(cost).toBeCloseTo(30, 5); // $5 in + $25 out
  });

  /**
   * The previous hardcoded table used $15/MTok output for every provider,
   * which understated Opus 4.8 by 40%.
   */
  it('does not understate Opus output the way the flat rate did', () => {
    const usage = { inputTokens: 0, outputTokens: 1_000_000, imageTokens: 0 };
    expect(estimateCost(usage, 'anthropic', 'claude-opus-4-8')).toBeGreaterThan(15);
  });

  it('is zero for an empty call', () => {
    expect(
      estimateCost({ inputTokens: 0, outputTokens: 0, imageTokens: 0 }, 'qwen', 'qwen-plus')
    ).toBe(0);
  });

  it('prices Qwen below Opus for identical usage', () => {
    const usage = { inputTokens: 100_000, outputTokens: 10_000, imageTokens: 0 };
    expect(estimateCost(usage, 'qwen', 'qwen-plus')).toBeLessThan(
      estimateCost(usage, 'anthropic', 'claude-opus-4-8')
    );
  });
});

describe('UsageTracker', () => {
  const usage = { inputTokens: 1000, outputTokens: 200, imageTokens: 0 };

  it('records a call and computes its cost', () => {
    const tracker = new UsageTracker();
    const record = tracker.record('anthropic', 'claude-opus-4-8', usage, 'tool-loop');

    expect(record.costUsd).toBeGreaterThan(0);
    expect(record.label).toBe('tool-loop');
  });

  it('accumulates totals across calls', () => {
    const tracker = new UsageTracker();
    tracker.record('anthropic', 'claude-opus-4-8', usage, 'a');
    tracker.record('anthropic', 'claude-opus-4-8', usage, 'b');

    const totals = tracker.totals();
    expect(totals.calls).toBe(2);
    expect(totals.inputTokens).toBe(2000);
  });

  it('tracks image tokens separately', () => {
    const tracker = new UsageTracker();
    tracker.record(
      'anthropic',
      'claude-opus-4-8',
      { inputTokens: 2000, outputTokens: 100, imageTokens: 1229 },
      'browser-step'
    );

    expect(tracker.totals().imageTokens).toBe(1229);
  });

  it('returns recent records newest first', () => {
    const tracker = new UsageTracker();
    tracker.record('anthropic', 'claude-opus-4-8', usage, 'first');
    tracker.record('anthropic', 'claude-opus-4-8', usage, 'second');

    expect(tracker.recent()[0].label).toBe('second');
  });

  it('caps retained records so a long session cannot grow unbounded', () => {
    const tracker = new UsageTracker(3);
    for (let i = 0; i < 10; i++) {
      tracker.record('anthropic', 'claude-opus-4-8', usage, `call-${i}`);
    }

    expect(tracker.recent(100)).toHaveLength(3);
    expect(tracker.last()?.label).toBe('call-9');
  });

  it('reports zero totals before any call', () => {
    expect(new UsageTracker().totals()).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      imageTokens: 0,
      costUsd: 0,
      calls: 0,
    });
  });

  it('clears on reset', () => {
    const tracker = new UsageTracker();
    tracker.record('anthropic', 'claude-opus-4-8', usage, 'a');
    tracker.reset();

    expect(tracker.totals().calls).toBe(0);
  });
});

describe('formatUsage', () => {
  it('mentions image tokens only when present', () => {
    const tracker = new UsageTracker();
    const text = tracker.record(
      'anthropic',
      'claude-opus-4-8',
      { inputTokens: 100, outputTokens: 50, imageTokens: 0 },
      'tool-loop'
    );
    expect(formatUsage(text)).not.toContain('image');

    const vision = tracker.record(
      'anthropic',
      'claude-opus-4-8',
      { inputTokens: 2000, outputTokens: 50, imageTokens: 1229 },
      'browser-step'
    );
    expect(formatUsage(vision)).toContain('1229 image');
  });

  it('flags an estimated price as approximate', () => {
    const tracker = new UsageTracker();
    const record = tracker.record(
      'qwen',
      'qwen-plus',
      { inputTokens: 100, outputTokens: 50, imageTokens: 0 },
      'tool-loop'
    );
    expect(formatUsage(record)).toContain('approx');
  });
});
