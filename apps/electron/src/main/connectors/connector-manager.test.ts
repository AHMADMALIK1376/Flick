import { describe, it, expect, beforeEach } from 'vitest';
import { ConnectorManager, type ConnectedStore } from './connector-manager';
import { connectorForUrl, getConnector } from './connector-registry';

function fakeStore(initial: string[] = []): ConnectedStore {
  let ids = [...initial];
  return {
    getConnectedIds: () => [...ids],
    setConnectedIds: (next) => {
      ids = [...next];
    },
  };
}

describe('connector-registry', () => {
  it('exposes the built-in connectors by id', () => {
    expect(getConnector('gmail')?.name).toBe('Gmail');
    expect(getConnector('youtube')?.homeUrl).toContain('youtube.com');
  });

  it('returns undefined for an unknown id', () => {
    expect(getConnector('nope')).toBeUndefined();
  });

  it('maps a known host URL to its built-in connector', () => {
    expect(connectorForUrl('https://mail.google.com/mail/u/0')?.id).toBe('gmail');
    expect(connectorForUrl('www.youtube.com')?.id).toBe('youtube');
  });

  it('builds a custom connector for an unknown site', () => {
    const c = connectorForUrl('https://console.anthropic.com/dashboard');
    expect(c).not.toBeNull();
    expect(c?.id).toBe('console.anthropic.com');
    expect(c?.homeUrl).toBe('https://console.anthropic.com');
  });

  it('adds a scheme when the user omits it', () => {
    expect(connectorForUrl('example.com')?.homeUrl).toBe('https://example.com');
  });

  it('rejects non-URLs', () => {
    expect(connectorForUrl('')).toBeNull();
    expect(connectorForUrl('not a url with spaces')).toBeNull();
  });
});

describe('ConnectorManager', () => {
  let manager: ConnectorManager;

  beforeEach(() => {
    manager = new ConnectorManager(fakeStore());
  });

  it('lists built-in connectors, all disconnected initially', () => {
    const list = manager.list();
    expect(list.map((c) => c.id)).toContain('gmail');
    expect(list.every((c) => c.connected === false)).toBe(true);
  });

  it('marks a connector connected and persists it', () => {
    manager.markConnected('gmail');

    expect(manager.isConnected('gmail')).toBe(true);
    expect(manager.list().find((c) => c.id === 'gmail')?.connected).toBe(true);
  });

  it('does not duplicate on a repeated connect', () => {
    manager.markConnected('gmail');
    manager.markConnected('gmail');

    expect(
      manager.list().filter((c) => c.id === 'gmail'),
    ).toHaveLength(1);
  });

  it('disconnects a connector', () => {
    manager.markConnected('gmail');
    manager.disconnect('gmail');

    expect(manager.isConnected('gmail')).toBe(false);
  });

  it('shows a connected custom site in the list', () => {
    manager.markConnected('console.anthropic.com');

    const custom = manager.list().find((c) => c.id === 'console.anthropic.com');
    expect(custom?.connected).toBe(true);
  });

  it('resolves an id to a built-in connector', () => {
    expect(manager.resolve('spotify')?.name).toBe('Spotify');
  });

  it('resolves a URL to a custom connector', () => {
    expect(manager.resolve('https://console.anthropic.com')?.id).toBe(
      'console.anthropic.com',
    );
  });

  it('reflects state from an existing store', () => {
    const m = new ConnectorManager(fakeStore(['netflix']));
    expect(m.isConnected('netflix')).toBe(true);
  });
});
