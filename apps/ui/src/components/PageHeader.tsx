// Title + subtitle + optional buttons at the top of every page.
import { Group, Stack, Text, Title } from '@mantine/core';
import type { ReactNode } from 'react';
import { colors } from '../theme';

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <Group justify="space-between" align="flex-end" mb="xl">
      <Stack gap={4}>
        <Title order={2} c={colors.ink}>
          {title}
        </Title>
        {subtitle && <Text c={colors.muted}>{subtitle}</Text>}
      </Stack>
      {actions && <Group gap="sm">{actions}</Group>}
    </Group>
  );
}
