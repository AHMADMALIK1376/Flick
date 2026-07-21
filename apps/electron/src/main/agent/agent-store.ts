import Store from 'electron-store';
import type { ActionLogEntry } from '../../shared/types';

interface AgentLogData {
  entries: ActionLogEntry[];
}

export class AgentStore {
  private store: Store<AgentLogData>;

  constructor(store?: Store<AgentLogData>) {
    this.store = store ?? new Store<AgentLogData>({ name: 'agent-log', defaults: { entries: [] } });
  }

  addEntry(entry: ActionLogEntry): void {
    const entries = this.store.get('entries');
    entries.unshift(entry);
    this.store.set('entries', entries);
  }

  getEntries(): ActionLogEntry[] {
    return this.store.get('entries');
  }

  clearLog(): void {
    this.store.set('entries', []);
  }
}
