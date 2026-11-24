// Small pieces shared by the Presentation page states.
import { Group, Stack, Text } from '@mantine/core';
import type { ReactNode } from 'react';
import { colors } from '../../theme';

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <Text fz={12} fw={700} c={colors.muted} tt="uppercase" style={{ letterSpacing: 0.8 }}>
      {children}
    </Text>
  );
}

export function CardTitle({ children }: { children: ReactNode }) {
  return (
    <Text fz={16} fw={700} c={colors.ink}>
      {children}
    </Text>
  );
}

export function DeckStats({ items }: { items: { value: number; label: string }[] }) {
  return (
    <Group gap={36} mt={16}>
      {items.map((item) => (
        <Stack key={item.label} gap={0}>
          <Text fz={28} fw={800} c={colors.ink} lh={1.1}>
            {item.value}
          </Text>
          <Text fz={13} c={colors.muted}>
            {item.label}
          </Text>
        </Stack>
      ))}
    </Group>
  );
}
