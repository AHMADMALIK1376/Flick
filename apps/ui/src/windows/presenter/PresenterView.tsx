// Issue #9 · Design screen: L1 Presenter View
//
// Compact window for a second screen: current slide, last question and answer, Ask and Explain.
import { Anchor, Box, Button, Card, Group, Loader, ScrollArea, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconExternalLink, IconMicrophone, IconPlayerStop, IconPresentation } from '@tabler/icons-react';
import { useState } from 'react';
import { api } from '../../api/flick';
import type { Answer } from '../../api/types';
import { OriginBadge } from '../../components/OriginBadge';
import { useFlickEvent } from '../../hooks/useEvents';
import { LogoMark } from '../../layout/Logo';
import { colors } from '../../theme';
import { AskPanel } from '../mic/AskPanel';
import { useAskFlow } from '../mic/useAskFlow';

export function PresenterView() {
  const flow = useAskFlow();
  const { phase, note, toggle } = flow;
  const [last, setLast] = useState<Answer | null>(null);
  const [working, setWorking] = useState<{ id: string; question: string } | null>(null);
  const [explaining, setExplaining] = useState(false);

  useFlickEvent('thinking', (d) => setWorking(d));
  useFlickEvent('answer', (a) => {
    if (a.origin === 'greeting') return;
    setLast(a);
    setWorking((w) => (w && w.id === a.id ? null : w));
  });

  async function explain() {
    setExplaining(true);
    try {
      const answer = await api.explain();
      if (answer.origin === 'error') notifications.show({ color: 'red', message: answer.answer });
    } catch (err) {
      notifications.show({ color: 'red', message: err instanceof Error ? err.message : 'Something went wrong.' });
    } finally {
      setExplaining(false);
    }
  }

  const slide = last?.current_slide;

  return (
    <Stack gap={14} p={16} h="100vh" style={{ background: colors.background }}>
      <Group justify="space-between">
        <Group gap={8}>
          <LogoMark size={24} />
          <Text fw={800} c={colors.ink}>
            Flick
          </Text>
        </Group>
        <Stack gap={0} align="flex-end">
          <Text fz={11} fw={700} tt="uppercase" c={colors.muted} style={{ letterSpacing: 0.8 }}>
            Current slide
          </Text>
          <Text fz={26} fw={800} c={colors.ink} lh={1.1}>
            {slide ?? '—'}
          </Text>
        </Stack>
      </Group>

      <Card style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <Text fz={11} fw={700} tt="uppercase" c={colors.muted} style={{ letterSpacing: 0.8 }}>
          Last question
        </Text>
        {working ? (
          <Stack gap={10} mt={10}>
            <Text fw={700} c={colors.ink}>
              {working.question}
            </Text>
            <Group gap={10}>
              <Loader size={18} color="aqua.6" />
              <Text fz={14} c={colors.ink}>
                Finding the answer…
              </Text>
            </Group>
          </Stack>
        ) : last ? (
          <ScrollArea style={{ flex: 1 }} mt={10}>
            <Text fw={700} c={colors.ink}>
              {last.question}
            </Text>
            <Box my={8}>
              <OriginBadge origin={last.origin} />
            </Box>
            <Text fz={14.5} lh={1.55} c={colors.ink} style={{ whiteSpace: 'pre-wrap' }}>
              {last.answer}
            </Text>
            {last.sources.map((s) => (
              <Anchor key={s.url} href={s.url} target="_blank" rel="noreferrer" fz={12.5} fw={600} c={colors.plum} display="block" mt={6}>
                <Group gap={4} wrap="nowrap">
                  <IconExternalLink size={13} />
                  <span>{s.title || s.url}</span>
                </Group>
              </Anchor>
            ))}
          </ScrollArea>
        ) : (
          <Text fz={14} c={colors.muted} mt={10}>
            No questions yet. Press Ask and speak the question.
          </Text>
        )}
      </Card>

      {note && (
        <Text fz={12.5} c={colors.muted} ta="center">
          {note}
        </Text>
      )}

      <AskPanel flow={flow} />

      <Group grow gap={10}>
        <Button
          size="md"
          onClick={toggle}
          disabled={phase === 'review'}
          loading={phase === 'answering' || phase === 'writing'}
          leftSection={phase === 'listening' ? <IconPlayerStop size={18} /> : <IconMicrophone size={18} />}
          color={phase === 'listening' ? 'plum.7' : undefined}
          c={phase === 'listening' ? '#fff' : undefined}
        >
          {phase === 'listening' ? 'Stop and ask' : 'Ask'}
        </Button>
        <Button size="md" variant="default" leftSection={<IconPresentation size={18} />} loading={explaining} onClick={explain}>
          Explain slide
        </Button>
      </Group>
    </Stack>
  );
}
