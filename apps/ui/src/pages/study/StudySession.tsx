// A study session: the slide, what Flick is saying, its whiteboard, and asking questions.
import { ActionIcon, Badge, Box, Button, Card, Group, Loader, Progress, SimpleGrid, Stack, Text, TextInput, Tooltip } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconMaximize, IconMicrophone, IconPlayerStop, IconSend } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { api } from '../../api/flick';
import type { Answer, Deck } from '../../api/types';
import { OriginBadge } from '../../components/OriginBadge';
import { PresentControls, presentLabel } from '../../components/PresentControls';
import { BoardOverlay } from '../../components/whiteboard/BoardOverlay';
import { Whiteboard } from '../../components/whiteboard/Whiteboard';
import { useCanvas } from '../../hooks/useCanvas';
import { useFlickEvent } from '../../hooks/useEvents';
import type { Presenter } from '../../hooks/usePresenter';
import { colors } from '../../theme';
import { AskPanel } from '../../windows/mic/AskPanel';
import { useAskFlow } from '../../windows/mic/useAskFlow';
import { QUICK_ASKS, STUDY_MODES } from './modes';

export function StudySession({ presenter }: { presenter: Presenter }) {
  const { status } = presenter;
  const [deck, setDeck] = useState<Deck | null>(null);
  const { canvas } = useCanvas('study');
  // A new drawing opens big; "Make smaller" keeps it in the page until the next one.
  const [smallBoard, setSmallBoard] = useState<string | null>(null);
  const boardBig = !!canvas && smallBoard !== canvas.id;
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const [last, setLast] = useState<Answer | null>(null);
  const mic = useAskFlow();
  const mode = STUDY_MODES.find((m) => m.id === status.style);

  useEffect(() => {
    if (!status.deck_id) return;
    api
      .getDeck(status.deck_id)
      .then(setDeck)
      .catch(() => undefined);
  }, [status.deck_id]);

  useFlickEvent('thinking', (d) => setWorking(d.question));
  useFlickEvent('answer', (a) => {
    if (a.origin === 'greeting') return;
    setLast(a);
    setWorking(null);
  });

  async function ask(text: string) {
    const value = text.trim();
    if (!value || asking) return;
    setAsking(true);
    try {
      await api.ask(value); // pauses the lesson; Flick answers, then continues by itself
      setQuestion('');
    } catch (err) {
      notifications.show({ color: 'red', message: err instanceof Error ? err.message : 'Something went wrong.' });
    } finally {
      setAsking(false);
    }
  }

  const slide = deck?.slides.find((s) => s.number === status.slide);
  const percent = status.slide && status.total ? (status.slide / status.total) * 100 : 0;
  const paused = status.state === 'paused';
  const finished = status.state === 'finished';

  return (
    <Stack gap={20}>
      <Card p="16px 20px">
        <Group justify="space-between" wrap="nowrap">
          <Group gap={12} wrap="nowrap" style={{ minWidth: 0 }}>
            <Text fz={30} lh={1}>
              {mode?.emoji ?? '📚'}
            </Text>
            <Stack gap={2} style={{ minWidth: 0 }}>
              <Group gap={8}>
                <Text fz={16} fw={800} c={colors.ink} truncate>
                  {status.deck ?? 'Study session'}
                </Text>
                {mode && (
                  <Badge radius="sm" tt="none" color="plum" variant="light">
                    {mode.name}
                  </Badge>
                )}
              </Group>
              <Text fz={13} c={colors.muted}>
                {finished ? 'Finished. Well done!' : presentLabel(status).replace('Presenting', 'Explaining')}
              </Text>
            </Stack>
          </Group>
          {!finished && <PresentControls presenter={presenter} />}
        </Group>
        <Progress value={finished ? 100 : percent} size={6} color="aqua.6" bg="#e3dff0" radius="xl" mt={14} />
      </Card>

      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing={20} style={{ alignItems: 'start' }}>
        <Stack gap={20}>
          <Card>
            <Text fz={12} fw={700} tt="uppercase" c={colors.muted} style={{ letterSpacing: 0.8 }}>
              Slide {status.slide ?? '—'}
            </Text>
            <Text fz={20} fw={800} c={colors.ink} mt={6}>
              {slide?.title || 'Untitled slide'}
            </Text>
            {slide?.body && (
              <Stack gap={4} mt={10}>
                {slide.body
                  .split('\n')
                  .filter((l) => l.trim())
                  .slice(0, 10)
                  .map((line, i) => (
                    <Text key={i} fz={14} c={colors.muted} lh={1.5}>
                      • {line.trim()}
                    </Text>
                  ))}
              </Stack>
            )}
          </Card>
          <Card style={{ borderColor: colors.aqua, borderWidth: 2, background: '#f4fbfa' }}>
            <Text fz={12} fw={700} tt="uppercase" c={colors.muted} style={{ letterSpacing: 0.8 }}>
              {paused && status.paused_for === 'question' ? 'Your question' : 'Flick is saying'}
            </Text>
            <Text fz={16.5} lh={1.6} c={colors.ink} mt={6} mih={52}>
              {status.state === 'starting'
                ? 'Getting your first slide ready…'
                : paused && status.paused_for === 'question'
                  ? 'Ask away. Flick answers, then carries on.'
                  : finished
                    ? 'That was the whole presentation. Ask anything you want to go over again.'
                    : (status.line ?? '…')}
            </Text>
          </Card>
        </Stack>

        <Card p={12}>
          {canvas ? (
            <>
              {boardBig && (
                <BoardOverlay
                  drawing={canvas.drawing}
                  step={canvas.step}
                  say={canvas.say}
                  slide={canvas.slide}
                  paused={status.state === 'paused'}
                  onMinimize={() => setSmallBoard(canvas.id)}
                  onPause={presenter.pause}
                  onResume={presenter.resume}
                  onStop={presenter.stop}
                />
              )}
              <Group justify="flex-end" mb={6}>
                <Button size="xs" variant="subtle" leftSection={<IconMaximize size={14} />} onClick={() => setSmallBoard(null)}>
                  Full screen
                </Button>
              </Group>
              <Whiteboard drawing={canvas.drawing} step={canvas.step} />
              {canvas.say && (
                <Text fz={14.5} c={colors.ink} ta="center" mt={10} px={8}>
                  {canvas.say}
                </Text>
              )}
            </>
          ) : (
            <Box p={30} style={{ background: '#fffdf8', borderRadius: 14, border: `1px dashed ${colors.border}`, textAlign: 'center' }}>
              <Text fz={40}>✏️</Text>
              <Text fz={15} fw={700} c={colors.ink} mt={6}>
                Flick’s whiteboard
              </Text>
              <Text fz={13} c={colors.muted} mt={4} maw={320} mx="auto">
                Flick draws here when an idea is hard to picture. You can also ask: “draw this”.
              </Text>
            </Box>
          )}
        </Card>
      </SimpleGrid>

      <Card>
        {mic.phase !== 'idle' && mic.phase !== 'done' && (
          <Box mb={12}>
            <AskPanel flow={mic} />
          </Box>
        )}
        <Group gap={10} wrap="nowrap">
          <TextInput
            size="md"
            style={{ flex: 1 }}
            placeholder="Ask Flick anything about this slide"
            aria-label="Ask Flick"
            value={question}
            onChange={(e) => setQuestion(e.currentTarget.value)}
            onKeyDown={(e) => e.key === 'Enter' && void ask(question)}
          />
          <Tooltip label={mic.phase === 'listening' ? 'Stop and ask' : 'Ask by voice'}>
            <ActionIcon
              size={42}
              radius="xl"
              variant={mic.phase === 'listening' ? 'filled' : 'default'}
              color={mic.phase === 'listening' ? 'red' : undefined}
              aria-label="Ask by voice"
              loading={mic.phase === 'answering' || mic.phase === 'writing'}
              onClick={mic.toggle}
            >
              {mic.phase === 'listening' ? <IconPlayerStop size={18} /> : <IconMicrophone size={18} />}
            </ActionIcon>
          </Tooltip>
          <Button size="md" leftSection={<IconSend size={17} />} loading={asking} disabled={!question.trim()} onClick={() => ask(question)}>
            Ask
          </Button>
        </Group>
        <Group gap={8} mt={12}>
          {QUICK_ASKS.map((q) => (
            <Button key={q.label} variant="default" size="xs" radius="xl" disabled={asking} onClick={() => ask(q.ask)}>
              {q.emoji} {q.label}
            </Button>
          ))}
        </Group>

        {(working || last) && (
          <Box mt={16} p={16} style={{ background: colors.soft, border: `1px solid ${colors.border}`, borderRadius: 12 }}>
            {working ? (
              <Group gap={10}>
                <Loader size={16} color="aqua.6" />
                <Text fz={14} c={colors.ink}>
                  {working}
                </Text>
              </Group>
            ) : (
              last && (
                <>
                  <Group justify="space-between" mb={6}>
                    <Text fz={14} fw={700} c={colors.ink}>
                      {last.question}
                    </Text>
                    <OriginBadge origin={last.origin} />
                  </Group>
                  <Text fz={14.5} lh={1.6} c={colors.ink} style={{ whiteSpace: 'pre-wrap' }}>
                    {last.answer}
                  </Text>
                </>
              )
            )}
          </Box>
        )}
      </Card>
    </Stack>
  );
}
