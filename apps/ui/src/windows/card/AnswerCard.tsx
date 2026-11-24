// Issue #8 · Design screens: L2 Answer Card States + L4 Explain
//
// Small always-on-top window (Electron opens #/card). Shows live answers.
// States: waiting → thinking → (searching) → streaming → answer, or error.
// Speaking aloud automatically is done by Electron; the Speak button here is a manual replay.
import { ActionIcon, Anchor, Box, Button, Group, Loader, ScrollArea, Stack, Text } from '@mantine/core';
import { IconExternalLink, IconPlayerStop, IconVolume, IconX } from '@tabler/icons-react';
import { useEffect, useReducer, useRef, useState } from 'react';
import { api } from '../../api/flick';
import { OriginBadge } from '../../components/OriginBadge';
import { useFlickEvent } from '../../hooks/useEvents';
import { LogoMark } from '../../layout/Logo';
import { colors } from '../../theme';
import { formatDuration } from '../../utils/format';
import { answerReducer, initialCardState, type CardState } from './answerState';
import { useTransparentWindow } from '../useTransparentWindow';

const AUTO_HIDE_MS = 20_000;

export function AnswerCard() {
  useTransparentWindow();
  const [state, dispatch] = useReducer(answerReducer, initialCardState);
  const [hotkey, setHotkey] = useState('Ctrl+Shift+Space');
  const [hovered, setHovered] = useState(false);
  const hideTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    api
      .getSettings()
      .then((s) => setHotkey(s.ask_hotkey))
      .catch(() => undefined);
  }, []);

  useFlickEvent('thinking', (d) => dispatch({ type: 'thinking', id: d.id, question: d.question }));
  useFlickEvent('searching', (d) => dispatch({ type: 'searching', id: d.id }));
  useFlickEvent('answer_delta', (d) => dispatch({ type: 'delta', id: d.id, text: d.text }));
  useFlickEvent('answer', (a) => {
    if (a.origin !== 'greeting') dispatch({ type: 'answer', answer: a });
  });

  // Go back to "waiting" 20 s after a normal answer, unless the mouse is on the card.
  const autoHide = state.phase === 'answer' && state.answer.origin !== 'explain' && !hovered;
  useEffect(() => {
    window.clearTimeout(hideTimer.current);
    if (autoHide) hideTimer.current = window.setTimeout(() => dispatch({ type: 'hide' }), AUTO_HIDE_MS);
    return () => window.clearTimeout(hideTimer.current);
  }, [autoHide, state]);

  return (
    <Box
      h="100vh"
      p={8}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <Stack
        gap={0}
        h="100%"
        style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 16,
          boxShadow: '0 14px 40px rgba(42,36,64,0.18)',
          overflow: 'hidden',
        }}
      >
        <Header state={state} onClose={() => dispatch({ type: 'hide' })} />
        <ScrollArea style={{ flex: 1 }} px={16} pt={14} pb={6}>
          <Body state={state} hotkey={hotkey} />
        </ScrollArea>
        <Footer state={state} />
      </Stack>
    </Box>
  );
}

function Header({ state, onClose }: { state: CardState; onClose: () => void }) {
  let badge = null;
  if (state.phase === 'answer') badge = <OriginBadge origin={state.answer.origin} />;
  if (state.phase === 'error') badge = <OriginBadge origin="error" />;

  return (
    <Group
      gap={10}
      px={14}
      py={12}
      wrap="nowrap"
      style={{ background: colors.soft, borderBottom: `1px solid ${colors.border}` }}
    >
      <LogoMark size={22} />
      <Text fz={14} fw={800} c={colors.ink}>
        Flick
      </Text>
      {badge}
      <Box style={{ flex: 1 }} />
      <ActionIcon variant="subtle" color="gray" aria-label="Hide answer card" onClick={onClose}>
        <IconX size={16} />
      </ActionIcon>
    </Group>
  );
}

function Question({ text }: { text: string }) {
  return (
    <Text fz={13} c={colors.muted} mb={8}>
      Q: <b style={{ color: colors.ink }}>{text}</b>
    </Text>
  );
}

function Body({ state, hotkey }: { state: CardState; hotkey: string }) {
  switch (state.phase) {
    case 'hidden':
      return (
        <Text fz={14} c={colors.muted} mt={4}>
          Press <b style={{ color: colors.ink }}>{hotkey}</b> and ask a question.
        </Text>
      );
    case 'listening':
      return (
        <Group gap={10} mt={4}>
          <span className="flick-pulse" />
          <Text fz={14.5} c={colors.ink}>
            Listening…
          </Text>
        </Group>
      );
    case 'thinking':
    case 'searching':
      return (
        <>
          <Question text={state.question} />
          <Group gap={10}>
            <Loader size={18} color="aqua.6" />
            <Text fz={14.5} c={colors.ink}>
              {state.phase === 'searching' ? 'Searching the web…' : 'Finding the answer…'}
            </Text>
          </Group>
        </>
      );
    case 'streaming':
      return (
        <>
          <Question text={state.question} />
          <Text fz={15.5} lh={1.55} c={colors.ink}>
            {state.text}
          </Text>
        </>
      );
    case 'answer': {
      const a = state.answer;
      const explain = a.origin === 'explain';
      return (
        <>
          <Question text={explain ? `Explain slide ${a.current_slide ?? ''}`.trim() : a.question} />
          <Text fz={explain ? 15 : 15.5} lh={1.55} c={colors.ink} style={{ whiteSpace: 'pre-wrap' }}>
            {a.answer}
          </Text>
          {a.sources.length > 0 && (
            <Stack gap={3} mt={10}>
              {a.sources.map((s) => (
                <Anchor key={s.url} href={s.url} target="_blank" rel="noreferrer" fz={12.5} c={colors.plum} fw={600}>
                  <Group gap={4} wrap="nowrap">
                    <IconExternalLink size={13} />
                    <span>{s.title || s.url}</span>
                  </Group>
                </Anchor>
              ))}
            </Stack>
          )}
        </>
      );
    }
    case 'error':
      return (
        <>
          <Question text={state.question} />
          <Text fz={15} lh={1.55} c={colors.ink}>
            {state.message}
          </Text>
        </>
      );
  }
}

function speak(text: string) {
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
}

function stop() {
  window.speechSynthesis.cancel();
}

function Footer({ state }: { state: CardState }) {
  if (state.phase === 'error') {
    return (
      <Text fz={12} c={colors.muted} px={16} pt={10} pb={14}>
        Not spoken aloud
      </Text>
    );
  }
  if (state.phase !== 'answer') return null;
  const a = state.answer;

  if (a.origin === 'explain') {
    return (
      <Group px={16} pt={10} pb={14} gap={8}>
        <IconVolume size={15} color={colors.explainText} />
        <Text fz={12} c={colors.explainText} fw={600}>
          Speaking to the audience
        </Text>
        <Box style={{ flex: 1 }} />
        <Button size="xs" variant="default" leftSection={<IconPlayerStop size={14} />} onClick={stop}>
          Stop
        </Button>
      </Group>
    );
  }

  return (
    <Group px={16} pt={10} pb={14} gap={8} wrap="nowrap">
      <Text fz={12} c={colors.muted}>
        {formatDuration(a.duration_ms)}
        {a.current_slide ? ` · slide ${a.current_slide}` : ''}
      </Text>
      <Box style={{ flex: 1 }} />
      <Button size="xs" leftSection={<IconVolume size={14} />} onClick={() => speak(a.answer)}>
        Speak
      </Button>
      <Button size="xs" variant="default" leftSection={<IconPlayerStop size={14} />} onClick={stop}>
        Stop
      </Button>
    </Group>
  );
}
