// A big clickable radio card (e.g. "Speak to the room" / "Show only to me").
import { Radio, Stack, Text } from '@mantine/core';
import { colors } from '../../theme';

export function ChoiceCard({ value, title, text, checked }: { value: string; title: string; text: string; checked: boolean }) {
  return (
    <Radio.Card
      value={value}
      radius={12}
      p={16}
      style={{
        flex: '1 1 220px',
        border: `2px solid ${checked ? colors.aqua : colors.border}`,
        background: checked ? '#eef9f8' : colors.surface,
      }}
    >
      <Stack gap={4}>
        <Text fz={14} fw={700} c={colors.ink}>
          {title}
        </Text>
        <Text fz={13} c={colors.muted}>
          {text}
        </Text>
      </Stack>
    </Radio.Card>
  );
}
