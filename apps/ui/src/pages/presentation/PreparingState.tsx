// Issue #4 · Design screen: D3 Preparing
//
// Progress while Flick predicts questions and writes slide explanations.
// Live events: prep_progress (passed in by PresentationPage)
import { Card, Progress, Stack, Text } from '@mantine/core';
import type { Deck, PrepProgress } from '../../api/types';
import { colors } from '../../theme';
import { DeckStats, SectionLabel } from './parts';
import { TryQuestionCard } from './TryQuestionCard';

export function PreparingState({ deck, progress }: { deck: Deck; progress: PrepProgress | null }) {
  const percent = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <Stack gap={24}>
      <Card>
        <SectionLabel>Active presentation</SectionLabel>
        <Text fz={21} fw={700} c={colors.ink} mt={6}>
          {deck.name}
        </Text>
        <DeckStats
          items={[
            { value: deck.slides.length, label: 'slides' },
            { value: deck.predicted.length, label: 'questions so far' },
          ]}
        />
        <Progress value={percent} size={8} color="aqua.6" bg="#e3dff0" radius="xl" mt={18} animated={percent < 100} />
        <Text fz={13} c={colors.muted} mt={8}>
          {progress?.message ?? 'Reading your slides…'}
        </Text>
        <Text fz={13} c={colors.muted} mt={10}>
          You can keep working. Flick already answers from your slides while it prepares.
        </Text>
      </Card>
      <TryQuestionCard />
    </Stack>
  );
}
