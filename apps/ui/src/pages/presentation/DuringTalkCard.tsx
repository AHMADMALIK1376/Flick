// "During your talk": 3 steps + the explain-this-slide tip.
import { Box, Card, Group, Stack, Text } from '@mantine/core';
import { colors } from '../../theme';
import { CardTitle } from './parts';

export function DuringTalkCard({ askHotkey, explainHotkey }: { askHotkey: string; explainHotkey: string }) {
  const steps = [
    { title: 'Hear the question', text: 'Someone asks something you are not sure about.' },
    { title: 'Ask Flick', text: `Press ${askHotkey} and say “Flick, …” and the question.` },
    { title: 'Get the answer', text: 'Prepared answers first, then your slides, then the web.' },
  ];

  return (
    <Card>
      <CardTitle>During your talk</CardTitle>
      <Stack gap={16} mt={16}>
        {steps.map((step, i) => (
          <Group key={step.title} gap={14} wrap="nowrap" align="flex-start">
            <Box
              w={32}
              h={32}
              style={{
                borderRadius: '50%',
                background: colors.aqua,
                color: colors.ink,
                fontWeight: 800,
                display: 'grid',
                placeItems: 'center',
                flexShrink: 0,
              }}
            >
              {i + 1}
            </Box>
            <Stack gap={2}>
              <Text fz={14} fw={700} c={colors.ink}>
                {step.title}
              </Text>
              <Text fz={13} c={colors.muted}>
                {step.text}
              </Text>
            </Stack>
          </Group>
        ))}
      </Stack>
      <Box mt={18} p="14px 16px" style={{ background: colors.explainBg, borderRadius: 12 }}>
        <Text fz={13} c={colors.explainText}>
          <b>Want Flick to present a slide?</b> Say “Flick, explain this slide”, or press {explainHotkey}. Flick
          explains it to the audience, out loud, with examples. Need an earlier slide? “Flick, go back to slide 6 and
          explain it with an example”: it goes there, explains and draws, then comes back to where you were.
        </Text>
      </Box>
    </Card>
  );
}
