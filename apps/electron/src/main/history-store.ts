import Store from 'electron-store';
import type { TranscriptEntry } from '../shared/types';

const MAX_ENTRIES = 100;

interface HistoryData {
  entries: TranscriptEntry[];
}

export class HistoryStore {
  private store: Store<HistoryData>;

  constructor(store?: Store<HistoryData>) {
    this.store = store ?? new Store<HistoryData>({ name: 'history', defaults: { entries: [] } });
  }

  addEntry(entry: TranscriptEntry): void {
    const entries = this.store.get('entries');
    entries.unshift(entry);
    if (entries.length > MAX_ENTRIES) {
      entries.length = MAX_ENTRIES;
    }
    this.store.set('entries', entries);
  }

  getEntries(): TranscriptEntry[] {
    return this.store.get('entries');
  }

  /**
   * Removes a single entry by id. Returns true if an entry was removed.
   */
  deleteEntry(id: string): boolean {
    const entries = this.store.get('entries');
    const next = entries.filter((e) => e.id !== id);
    if (next.length === entries.length) {
      return false;
    }
    this.store.set('entries', next);
    return true;
  }

  /**
   * Replaces the text of a single entry by id. Returns the updated entry, or
   * null if no entry matched.
   */
  updateEntry(id: string, text: string): TranscriptEntry | null {
    const entries = this.store.get('entries');
    const idx = entries.findIndex((e) => e.id === id);
    if (idx === -1) {
      return null;
    }
    entries[idx] = { ...entries[idx], text };
    this.store.set('entries', entries);
    return entries[idx];
  }

  clearHistory(): void {
    this.store.set('entries', []);
  }
}
