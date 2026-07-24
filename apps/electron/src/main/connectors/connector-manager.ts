import {
  BUILTIN_CONNECTORS,
  connectorForUrl,
  getConnector,
  type Connector,
} from './connector-registry';

/** Persists which connectors the user has logged into. */
export interface ConnectedStore {
  getConnectedIds(): string[];
  setConnectedIds(ids: string[]): void;
}

export interface ConnectorStatus extends Connector {
  connected: boolean;
}

/**
 * Tracks which services the user has connected, and resolves ids and URLs to
 * connectors. Deliberately free of browser side effects — opening the login
 * window is the caller's job — so the state logic is unit-testable.
 */
export class ConnectorManager {
  constructor(private readonly store: ConnectedStore) {}

  /** Built-in connectors plus any custom sites the user has connected. */
  list(): ConnectorStatus[] {
    const connected = new Set(this.store.getConnectedIds());

    const builtin = BUILTIN_CONNECTORS.map((c) => ({
      ...c,
      connected: connected.has(c.id),
    }));

    // Custom (non-builtin) connected sites, so a connected URL still shows up.
    const builtinIds = new Set(BUILTIN_CONNECTORS.map((c) => c.id));
    const custom: ConnectorStatus[] = [...connected]
      .filter((id) => !builtinIds.has(id))
      .map((id) => ({
        id,
        name: id,
        homeUrl: `https://${id}`,
        icon: '🌐',
        connected: true,
      }));

    return [...builtin, ...custom];
  }

  isConnected(id: string): boolean {
    return this.store.getConnectedIds().includes(id);
  }

  markConnected(id: string): void {
    const ids = new Set(this.store.getConnectedIds());
    ids.add(id);
    this.store.setConnectedIds([...ids]);
  }

  disconnect(id: string): void {
    const ids = this.store.getConnectedIds().filter((x) => x !== id);
    this.store.setConnectedIds(ids);
  }

  /** Resolves a built-in id or an arbitrary URL to a connector to sign into. */
  resolve(idOrUrl: string): Connector | null {
    return getConnector(idOrUrl) ?? connectorForUrl(idOrUrl);
  }
}
