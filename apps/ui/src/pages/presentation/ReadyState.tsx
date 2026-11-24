// Issue #4 · Design screen: D2 Ready
//
// Deck name, stats, "Explain current slide", load another deck, "Prepare again".
// Backend: POST /explain, POST /decks/{id}/prepare
import { Box, Button, Card, Group, Progress, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconPresentation, IconRefresh, IconUpload } from '@tabler/icons-react';
import { useState } from 'react';
import { api } from '../../api/flick';
import type { Answer, Deck } from '../../api/types';
import { colors } from '../../theme';
import { pickFile } from './EmptyState';
import { DeckStats, SectionLabel } from './parts';
import { TryQuestionCard } from './TryQuestionCard';
import { errorText, useDeckLoader } from './useDeckLoader';

function askedToday(log: Answer[]): number {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const since = start.getTime() / 1000;
  return log.filter((a) => a.timestamp >= since && a.origin !== 'greeting' && a.origin !== 'error').length;
}

export function ReadyState({ deck, log, onChanged }: { deck: Deck; log: Answer[]; onChanged: () => void }) {
  const loader = useDeckLoader(onChanged);
  const [explaining, setExplaining] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const failed = deck.prep_status === 'error';

  async function explain() {
    setExplaining(true);
    try {
      const answer = await api.explain();
      if (answer.origin === 'error') {
        notifications.show({ color: 'red', message: answer.answer });
      } else {
        const slide = answer.current_slide ? `slide ${answer.current_slide}` : 'the current slide';
        notifications.show({ color: 'teal', message: `Explaining ${slide}.` });
      }
    } catch (err) {
      notifications.show({ color: 'red', message: errorText(err) });
    } finally {
      setExplaining(false);
    }
  }

  async function prepareAgain() {
    setPreparing(true);
    try {
      await api.prepareDeck(deck.id);
      notifications.show({ color: 'teal', message: 'Preparing again…' });
      onChanged();
    } catch (err) {
      notifications.show({ color: 'red', message: errorText(err) });
    } finally {
      setPreparing(false);
    }
  }

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
            { value: deck.predicted.length, label: 'prepared questions' },
            { value: askedToday(log), label: 'asked today' },
          ]}
        />
        <Progress value={failed ? 0 : 100} size={8} color="aqua.6" bg="#e3dff0" radius="xl" mt={18} />
        {failed ? (
          <Box mt={10} p="10px 14px" style={{ background: '#fbe0e0', borderRadius: 10 }}>
            <Text fz={13} c="#9b2c2c">
              {deck.prep_error || 'Preparing failed.'} Flick can still answer from your slides.
            </Text>
          </Box>
        ) : (
          <Text fz={13} c={colors.muted} mt={8}>
            All {deck.slides.length} slides read. Questions prepared.
          </Text>
        )}

        <Group gap={10} mt={20}>
          <Button size="md" leftSection={<IconPresentation size={18} />} loading={explaining} onClick={explain}>
            Explain current slide
          </Button>
          <Button
            size="md"
            variant="default"
            leftSection={<IconRefresh size={18} />}
            loading={preparing}
            onClick={prepareAgain}
          >
            Prepare again
          </Button>
        </Group>
        <Group gap={10} mt={10}>
          <Button
            size="sm"
            variant="default"
            leftSection={<IconUpload size={16} />}
            loading={loader.busy === 'file'}
            disabled={loader.busy !== null}
            onClick={() => pickFile(loader.uploadFile)}
          >
            Upload another .pptx
          </Button>
          <Button
            size="sm"
            variant="default"
            leftSection={<IconPresentation size={16} />}
            loading={loader.busy === 'powerpoint'}
            disabled={loader.busy !== null}
            onClick={loader.loadFromPowerPoint}
          >
            Use open PowerPoint
          </Button>
        </Group>
      </Card>
      <TryQuestionCard />
    </Stack>
  );
}
