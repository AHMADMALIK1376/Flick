// Placeholder shown on pages that are not built yet.
// Delete it from a page once that page is done.
import { Card, List, Text } from '@mantine/core';
import { colors } from '../theme';

export function TodoPanel({ issue, items }: { issue: number; items: string[] }) {
  return (
    <Card style={{ borderStyle: 'dashed', background: colors.soft }}>
      <Text fw={700} mb="xs" c={colors.plum}>
        To build (issue #{issue})
      </Text>
      <List size="sm" c={colors.muted} spacing={4}>
        {items.map((item) => (
          <List.Item key={item}>{item}</List.Item>
        ))}
      </List>
    </Card>
  );
}
