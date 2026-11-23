import { describe, it, expect } from 'vitest';
import { validateApiKey } from './key-validation';
import { PROVIDER_REGISTRY } from './provider-registry';

describe('validateApiKey', () => {
  it('accepts a valid Qwen key', () => {
    expect(validateApiKey('qwen', 'sk-abcdefghijklmnopqrstuvwxyz')).toBe(true);
  });

  it('rejects a Qwen key without the sk- prefix', () => {
    expect(validateApiKey('qwen', 'abcdefghijklmnopqrstuvwxyz')).toBe(false);
  });

  it('accepts a valid Anthropic key', () => {
    expect(validateApiKey('anthropic', 'sk-ant-abcdefghijklmnopqrst')).toBe(true);
  });

  it('rejects an empty key for every provider', () => {
    for (const { id } of PROVIDER_REGISTRY) {
      expect(validateApiKey(id, '')).toBe(false);
    }
  });

  /**
   * validateApiKey falls through to `default: return false`, so a provider
   * added to the registry without a matching case silently rejects every key
   * it is given. That failure looks like "my key doesn't work" rather than a
   * missing branch, so it is worth asserting explicitly.
   */
  it('has a validation branch for every registered provider', () => {
    for (const { id } of PROVIDER_REGISTRY) {
      const plausible = id === 'anthropic' ? 'sk-ant-' : 'sk-';
      expect(
        validateApiKey(id, `${plausible}${'x'.repeat(40)}`),
        `provider "${id}" is in PROVIDER_REGISTRY but has no case in validateApiKey`
      ).toBe(true);
    }
  });
});
