import { describe, it, expect, vi } from 'vitest';
import { resolveKeyword, createPorcupineListener } from './porcupine-adapter';

const builtins = { JARVIS: 'jarvis-enum', COMPUTER: 'computer-enum' };

describe('resolveKeyword', () => {
  it('maps a built-in name to its enum', () => {
    expect(resolveKeyword('JARVIS', builtins)).toEqual({
      keyword: 'jarvis-enum',
      label: 'JARVIS',
    });
  });

  it('is case- and space-insensitive for built-ins', () => {
    expect(resolveKeyword('computer', builtins).keyword).toBe('computer-enum');
  });

  it('defaults to Jarvis for an unknown word', () => {
    expect(resolveKeyword('banana', builtins).keyword).toBe('jarvis-enum');
  });

  it('defaults to Jarvis when unset', () => {
    expect(resolveKeyword(undefined, builtins).keyword).toBe('jarvis-enum');
    expect(resolveKeyword('', builtins).keyword).toBe('jarvis-enum');
  });

  it('falls back to Jarvis when a custom .ppn does not exist', () => {
    const r = resolveKeyword('C:\\nope\\flick.ppn', builtins);
    expect(r.keyword).toBe('jarvis-enum');
    expect(r.label).toMatch(/fallback/i);
  });
});

describe('createPorcupineListener', () => {
  it('returns null with no access key, without touching native modules', () => {
    const listener = createPorcupineListener({
      accessKey: '',
      wakeWord: 'JARVIS',
      onWake: vi.fn(),
    });

    expect(listener).toBeNull();
  });

  it('returns null for a whitespace-only key', () => {
    expect(
      createPorcupineListener({
        accessKey: '   ',
        wakeWord: 'JARVIS',
        onWake: vi.fn(),
      }),
    ).toBeNull();
  });
});
