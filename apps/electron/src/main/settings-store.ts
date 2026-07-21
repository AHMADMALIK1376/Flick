import Store from 'electron-store';
import type { Settings } from '../shared/types';

const defaults: Settings = {
  hotkeyAccelerator: process.platform === 'darwin' ? 'Cmd+Shift+Space' : 'Ctrl+Shift+Space',
  hotkeyMode: 'toggle',
  modelName: 'base',
  language: 'en',
  autoCopyToClipboard: true,
  showFloatingWidget: true,
  launchAtStartup: false,
  silenceDurationMs: 1500,
  widgetPosition: null,
  onboardingComplete: false,
  aiAgentEnabled: false,
  openaiApiKey: '',
  geminiApiKey: '',
  deepseekApiKey: '',
  anthropicApiKey: '',
  qwenApiKey: '',
  llmProvider: '',
  llmModel: '',
  browserAgentHeadless: false,
};

/**
 * Settings keys whose values are stored base64-obfuscated at rest and decoded
 * on read, so the rest of the app always sees plaintext API keys.
 */
const OBFUSCATED_KEYS: ReadonlyArray<keyof Settings> = [
  'openaiApiKey',
  'geminiApiKey',
  'deepseekApiKey',
  'anthropicApiKey',
  'qwenApiKey',
];

/** Marker prefix identifying an already base64-obfuscated value. */
const B64_PREFIX = 'b64:';

/** Store key used to ensure the legacy plaintext-key migration runs only once. */
const LEGACY_MIGRATION_FLAG = 'legacyKeyMigrated';

function isObfuscatedKey(key: keyof Settings): boolean {
  return OBFUSCATED_KEYS.includes(key);
}

/**
 * Encodes a key value for storage. Empty values are stored as-is; values that
 * are already obfuscated are returned unchanged to avoid double-encoding.
 */
function encodeKeyValue(value: string): string {
  if (!value || value.startsWith(B64_PREFIX)) {
    return value;
  }
  return B64_PREFIX + Buffer.from(value, 'utf-8').toString('base64');
}

/**
 * Decodes a stored key value. Obfuscated values (prefixed with `b64:`) are
 * decoded; legacy plaintext values are returned unchanged.
 */
function decodeKeyValue(value: string): string {
  if (value.startsWith(B64_PREFIX)) {
    return Buffer.from(value.slice(B64_PREFIX.length), 'base64').toString('utf-8');
  }
  return value;
}

export class SettingsStore {
  private store: Store<Settings>;

  constructor(store?: Store<Settings>) {
    this.store = store ?? new Store<Settings>({ name: 'settings', defaults });
    this.migrateLegacyKeys();
  }

  get<K extends keyof Settings>(key: K): Settings[K] {
    const value = this.store.get(key);
    if (isObfuscatedKey(key) && typeof value === 'string') {
      return decodeKeyValue(value) as Settings[K];
    }
    return value;
  }

  set<K extends keyof Settings>(key: K, value: Settings[K]): void {
    if (isObfuscatedKey(key) && typeof value === 'string') {
      this.store.set(key, encodeKeyValue(value) as Settings[K]);
      return;
    }
    this.store.set(key, value);
  }

  getAll(): Settings {
    const all = { ...this.store.store } as Settings;
    const mutable = all as unknown as Record<string, unknown>;
    for (const key of OBFUSCATED_KEYS) {
      const value = all[key];
      if (typeof value === 'string') {
        mutable[key as string] = decodeKeyValue(value);
      }
    }
    return all;
  }

  reset(): void {
    this.store.clear();
  }

  /**
   * One-time migration of a legacy plaintext OpenAI key to the obfuscated
   * at-rest format. Only changes state when an unobfuscated, non-empty key is
   * present, and records a flag so it never runs again.
   */
  private migrateLegacyKeys(): void {
    const rawStore = this.store as unknown as {
      get(key: string): unknown;
      set(key: string, value: unknown): void;
    };

    if (rawStore.get(LEGACY_MIGRATION_FLAG) === true) {
      return;
    }

    const rawOpenAiKey = this.store.get('openaiApiKey');
    const hasLegacyPlaintext =
      typeof rawOpenAiKey === 'string' &&
      rawOpenAiKey.length > 0 &&
      !rawOpenAiKey.startsWith(B64_PREFIX);

    if (hasLegacyPlaintext) {
      this.store.set('openaiApiKey', encodeKeyValue(rawOpenAiKey) as Settings['openaiApiKey']);
      rawStore.set(LEGACY_MIGRATION_FLAG, true);
    }
  }
}
