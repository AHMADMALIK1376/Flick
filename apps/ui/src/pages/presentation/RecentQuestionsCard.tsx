// Last 3 questions, with a link to the full Q&A Log.
import { Anchor, Card, Group, Stack, Text } from '@mantine/core';
import { Link } from 'react-router-dom';
import type { Answer } from '../../api/types';
import { OriginBadge } from '../../components/OriginBadge';
import { colors } from '../../theme';
import { formatTime } from '../../utils/format';
import { CardTitle } from './parts';

export function RecentQuestionsCard({ log }: { log: Answer[] }) {
  const recent = log.filter((a) => a.origin !== 'greeting').slice(0, 3);

  return (
    <Card>
      <Group justify="space-between">
        <CardTitle>Recent questions</CardTitle>
        <Anchor component={Link} to="/log" fz={13} fw={600} c={colors.plum}>
          View log
        </Anchor>
      </Group>
      {recent.length === 0 ? (
        <Text fz={13} c={colors.muted} mt={12}>
          No questions yet.
        </Text>
      ) : (
        <Stack gap={14} mt={14}>
          {recent.map((a) => (
            <Stack key={a.id} gap={6}>
              <Text fz={14} fw={600} c={colors.ink} lineClamp={2}>
                {a.question}
              </Text>
              <Group gap={10}>
                <OriginBadge origin={a.origin} />
                <Text fz={12} c={colors.muted}>
                  {formatTime(a.timestamp)}
                </Text>
              </Group>
            </Stack>
          ))}
        </Stack>
      )}
    </Card>
  );
}
