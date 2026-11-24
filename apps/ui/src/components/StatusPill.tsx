// Rounded pill with a small dot, e.g. "Ready for your talk". Used in page headers.
import { Group, Text } from '@mantine/core';

export type PillTone = 'neutral' | 'working' | 'good' | 'bad';

const TONES: Record<PillTone, { bg: string; fg: string }> = {
  neutral: { bg: '#ece9f2', fg: '#4a4560' },
  working: { bg: '#e4e0f3', fg: '#4b3f72' },
  good: { bg: '#dcefe2', fg: '#24583a' },
  bad: { bg: '#fbe0e0', fg: '#9b2c2c' },
};

export function StatusPill({ tone, children }: { tone: PillTone; children: string }) {
  const { bg, fg } = TONES[tone];
  return (
    <Group gap={8} wrap="nowrap" px={14} py={7} style={{ background: bg, borderRadius: 999 }} role="status">
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: fg, flexShrink: 0 }} />
      <Text fz={13} fw={600} c={fg}>
        {children}
      </Text>
    </Group>
  );
}
