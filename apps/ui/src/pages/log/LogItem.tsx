// Issue #6 · Design screen: D5 (one log entry)
//
// Badge, time · duration · slide, question, answer (with Show more), web sources.
import { Anchor, Card, Group, Spoiler, Stack, Text } from '@mantine/core';
import { IconExternalLink } from '@tabler/icons-react';
import type { Answer } from '../../api/types';
import { OriginBadge } from '../../components/OriginBadge';
import { colors } from '../../theme';
import { formatDuration, formatTime } from '../../utils/format';

export function LogItem({ answer }: { answer: Answer }) {
  const when = formatTime(answer.timestamp);
  const meta =
    answer.origin === 'error'
      ? `${when} · not spoken`
      : [when, formatDuration(answer.duration_ms), answer.current_slide ? `slide ${answer.current_slide}` : null]
          .filter(Boolean)
          .join(' · ');

  return (
    <Card p="20px 22px">
      <Group justify="space-between" wrap="wrap" gap={8}>
        <OriginBadge origin={answer.origin} />
        <Text fz={12.5} c={colors.muted}>
          {meta}
        </Text>
      </Group>
      <Text fz={15.5} fw={700} c={colors.ink} mt={12}>
        {answer.question}
      </Text>
      <Spoiler maxHeight={96} showLabel="Show more" hideLabel="Show less" mt={6} styles={{ control: { fontSize: 13, fontWeight: 600, color: colors.plum } }}>
        <Text fz={14} lh={1.6} c={colors.muted} style={{ whiteSpace: 'pre-wrap' }}>
          {answer.answer}
        </Text>
      </Spoiler>
      {answer.sources.length > 0 && (
        <Stack gap={4} mt={10}>
          {answer.sources.map((s) => (
            <Anchor key={s.url} href={s.url} target="_blank" rel="noreferrer" fz={13} fw={600} c={colors.plum}>
              <Group gap={4} wrap="nowrap">
                <IconExternalLink size={14} />
                <span>{s.title || s.url}</span>
              </Group>
            </Anchor>
          ))}
        </Stack>
      )}
    </Card>
  );
}
