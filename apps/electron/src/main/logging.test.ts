import { describe, it, expect, vi, afterEach } from 'vitest';
import { safeLog, safeError, ProgressThrottle } from './logging';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('safeLog', () => {
  it('writes normally', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    safeLog('hello', 42);
    expect(spy).toHaveBeenCalledWith('hello', 42);
  });

  /**
   * The real crash: console.log threw EPIPE inside a download progress
   * callback, which became an uncaught exception and killed the app mid
   * download.
   */
  it('does not throw when stdout is a broken pipe', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {
      throw Object.assign(new Error('write EPIPE'), { code: 'EPIPE' });
    });

    expect(() => safeLog('anything')).not.toThrow();
  });

  it('swallows any console failure, not only EPIPE', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {
      throw new Error('some other console failure');
    });

    expect(() => safeLog('anything')).not.toThrow();
  });
});

describe('safeError', () => {
  it('writes normally', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    safeError('boom');
    expect(spy).toHaveBeenCalledWith('boom');
  });

  it('does not throw on a broken pipe', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {
      throw Object.assign(new Error('write EPIPE'), { code: 'EPIPE' });
    });

    expect(() => safeError('boom')).not.toThrow();
  });
});

describe('ProgressThrottle', () => {
  it('logs the first value', () => {
    expect(new ProgressThrottle().shouldLog(0)).toBe(true);
  });

  it('suppresses repeats of the same whole percent', () => {
    const t = new ProgressThrottle();
    t.shouldLog(0);

    expect(t.shouldLog(0)).toBe(false);
    expect(t.shouldLog(0.4)).toBe(false);
    expect(t.shouldLog(0.9)).toBe(false);
  });

  it('logs once the whole percent advances', () => {
    const t = new ProgressThrottle();
    t.shouldLog(0);

    expect(t.shouldLog(1)).toBe(true);
    expect(t.shouldLog(1.8)).toBe(false);
    expect(t.shouldLog(2)).toBe(true);
  });

  /**
   * A 299MB file emitted dozens of identical "0%" lines per second before
   * this; one line per percent is 101 lines for a whole download.
   */
  it('emits at most one line per percent across a full download', () => {
    const t = new ProgressThrottle();
    let logged = 0;

    for (let i = 0; i <= 10_000; i++) {
      if (t.shouldLog((i / 10_000) * 100)) logged++;
    }

    expect(logged).toBe(101);
  });

  it('logs again after reset, for the next file', () => {
    const t = new ProgressThrottle();
    t.shouldLog(100);
    t.reset();

    expect(t.shouldLog(0)).toBe(true);
  });

  it('ignores a non-finite percentage', () => {
    const t = new ProgressThrottle();

    expect(t.shouldLog(Number.NaN)).toBe(false);
    expect(t.shouldLog(Number.POSITIVE_INFINITY)).toBe(false);
  });
});
