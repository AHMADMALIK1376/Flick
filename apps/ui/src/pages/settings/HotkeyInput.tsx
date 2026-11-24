// Records a keyboard shortcut in Electron's format, e.g. "Ctrl+Shift+Space".
import { TextInput } from '@mantine/core';
import { useState, type KeyboardEvent } from 'react';

const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta']);

/** Turns a key press into "Ctrl+Shift+E", or null when it isn't a full shortcut yet. */
export function shortcutFrom(e: { key: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }): string | null {
  if (MODIFIER_KEYS.has(e.key)) return null;
  const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift'].filter(Boolean) as string[];
  if (mods.length === 0) return null; // a global hotkey needs at least one modifier
  let key = e.key;
  if (key === ' ') key = 'Space';
  else if (key.length === 1) key = key.toUpperCase();
  else if (!/^F\d{1,2}$/.test(key) && !['Enter', 'Tab', 'Backspace', 'Delete', 'Home', 'End', 'PageUp', 'PageDown', 'Insert'].includes(key)) {
    key = key.replace(/^Arrow/, ''); // ArrowUp → Up
  }
  return [...mods, key].join('+');
}

interface Props {
  label: string;
  hint: string;
  value: string;
  error?: string | null;
  onChange: (value: string) => void;
}

export function HotkeyInput({ label, hint, value, error, onChange }: Props) {
  const [recording, setRecording] = useState(false);

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Tab') return; // keep keyboard navigation working
    e.preventDefault();
    if (e.key === 'Escape') {
      e.currentTarget.blur();
      return;
    }
    const shortcut = shortcutFrom(e);
    if (shortcut) {
      onChange(shortcut);
      e.currentTarget.blur();
    }
  }

  return (
    <TextInput
      size="md"
      label={label}
      description={hint}
      inputWrapperOrder={['label', 'input', 'description', 'error']}
      readOnly
      value={recording ? 'Press your shortcut…' : value}
      onFocus={() => setRecording(true)}
      onBlur={() => setRecording(false)}
      onKeyDown={onKeyDown}
      error={error}
      styles={{ input: { cursor: 'pointer', fontWeight: 600 } }}
    />
  );
}
