import { describe, expect, it } from 'vitest';
import { shortcutFrom } from './HotkeyInput';

const press = (key: string, mods: Partial<{ ctrlKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) =>
  shortcutFrom({ key, ctrlKey: false, altKey: false, shiftKey: false, ...mods });

describe('shortcutFrom', () => {
  it('builds Ctrl+Shift+Space', () => expect(press(' ', { ctrlKey: true, shiftKey: true })).toBe('Ctrl+Shift+Space'));
  it('upper-cases letters', () => expect(press('e', { ctrlKey: true, shiftKey: true })).toBe('Ctrl+Shift+E'));
  it('keeps function keys', () => expect(press('F9', { altKey: true })).toBe('Alt+F9'));
  it('needs a modifier', () => expect(press('e')).toBeNull());
  it('waits for a real key', () => expect(press('Shift', { shiftKey: true })).toBeNull());
});
