// The whiteboard option inside every mode: draw only when it helps, draw every slide, or a
// real-life example on every slide. (Visual mode always draws examples, so it has no choice.)
import { Box, Group, SegmentedControl, Text } from '@mantine/core';
import type { Board } from '../api/types';

export const BOARD_OPTIONS: { value: Board; label: string; hint: string }[] = [
  { value: 'auto', label: 'Only when needed', hint: 'Flick draws when an idea is hard to picture.' },
  { value: 'draw', label: 'Draw every slide', hint: 'Every slide gets a picture of its idea on the board.' },
  { value: 'example', label: 'Example every slide', hint: 'Every slide gets a real-life example, drawn on the board.' },
];

/** "story+example" → "Story mode · Example every slide" */
export function styleLabel(style: string | null | undefined, names: Record<string, string>): string {
  if (!style) return '';
  const [main, language] = style.split('#');
  const [base, board] = main.split('@')[0].split('+');
  const option = BOARD_OPTIONS.find((o) => o.value === board);
  const lang = language === 'ur' ? ' · Urdu' : language === 'mix' ? ' · Urdu + English' : '';
  return `${names[base] ?? base}${option ? ` · ${option.label}` : ''}${lang}`;
}

export function BoardPicker({
  value,
  onChange,
  style,
  dark = false,
}: {
  value: Board;
  onChange: (board: Board) => void;
  /** The chosen mode: visual mode always draws, so there is nothing to choose. */
  style: string;
  /** On the purple "Let Flick present" card. */
  dark?: boolean;
}) {
  const ink = dark ? '#fff' : undefined;
  const muted = dark ? 'rgba(255,255,255,0.78)' : 'dimmed';
  if (style === 'visual') {
    return (
      <Text fz={13} c={muted} mt={10}>
        Visual mode draws a real-life example on every slide.
      </Text>
    );
  }
  const hint = BOARD_OPTIONS.find((o) => o.value === value)?.hint;
  return (
    <Box mt={12}>
      <Group gap={10} wrap="wrap" align="center">
        <Text fz={13} fw={700} c={ink}>
          Whiteboard
        </Text>
        <SegmentedControl
          size="xs"
          radius="md"
          value={value}
          onChange={(v) => onChange(v as Board)}
          data={BOARD_OPTIONS.map(({ value, label }) => ({ value, label }))}
          aria-label="Whiteboard"
          styles={
            dark
              ? { root: { background: 'rgba(255,255,255,0.14)' }, label: { color: '#fff' }, indicator: { background: 'rgba(255,255,255,0.28)' } }
              : undefined
          }
        />
      </Group>
      {hint && (
        <Text fz={12.5} c={muted} mt={6}>
          {hint}
        </Text>
      )}
    </Box>
  );
}
