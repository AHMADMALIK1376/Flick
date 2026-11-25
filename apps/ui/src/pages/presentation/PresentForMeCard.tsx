// "Present for me": Flick gives the whole talk, slide by slide, in its own voice.
// Idle: a big start button. While presenting: live slide, caption and controls.
import { Badge, Box, Button, Card, Group, NumberInput, Progress, SegmentedControl, Stack, Text } from '@mantine/core';
import { IconPlayerPlay, IconSpeakerphone } from '@tabler/icons-react';
import { useState } from 'react';
import type { Board, Deck, Status } from '../../api/types';
import { BoardPicker } from '../../components/BoardPicker';
import { PresentControls, presentLabel } from '../../components/PresentControls';
import type { Presenter } from '../../hooks/usePresenter';
import { colors } from '../../theme';

interface Props {
  deck: Deck;
  presenter: Presenter;
  voice: Status['voice'] | null;
  askHotkey: string;
}

export function PresentForMeCard({ deck, presenter, voice, askHotkey }: Props) {
  const [fromSlide, setFromSlide] = useState<number>(1);
  const [style, setStyle] = useState('class');
  const [board, setBoard] = useState<Board>('auto');
  const { status, active } = presenter;

  if (active) {
    const percent = status.slide && status.total ? (status.slide / status.total) * 100 : 0;
    const paused = status.state === 'paused';
    return (
      <Card style={{ borderColor: colors.aqua, borderWidth: 2, background: '#f4fbfa' }}>
        <Group justify="space-between" wrap="nowrap">
          <Group gap={10}>
            <span className={paused ? undefined : 'flick-pulse'} style={paused ? { width: 10, height: 10, borderRadius: '50%', background: '#e0a03c' } : undefined} />
            <Text fz={16} fw={800} c={colors.ink}>
              {presentLabel(status)}
            </Text>
          </Group>
          <PresentControls presenter={presenter} />
        </Group>
        <Progress value={percent} size={8} color="aqua.6" bg="#e3dff0" radius="xl" mt={16} />
        <Box mt={16} p="14px 16px" style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 12, minHeight: 64 }}>
          <Text fz={12} fw={700} tt="uppercase" c={colors.muted} style={{ letterSpacing: 0.8 }}>
            {paused && status.paused_for === 'question' ? 'Waiting for the question' : 'Flick is saying'}
          </Text>
          <Text fz={15.5} lh={1.55} c={colors.ink} mt={6} fs={paused ? 'italic' : undefined}>
            {paused && status.paused_for === 'question'
              ? 'Ask your question now. Flick answers it, then continues the talk by itself.'
              : status.line ?? '…'}
          </Text>
        </Box>
        <Text fz={12.5} c={colors.muted} mt={12}>
          Someone has a question? Press <b>{askHotkey}</b> (or the mic), ask it, press again. Flick pauses, answers,
          then says “let’s continue”.
        </Text>
      </Card>
    );
  }

  const voiceReady = voice?.ready ?? false;
  const voiceNote = voiceReady
    ? null
    : voice?.error
      ? voice.error
      : voice?.downloading
        ? 'Downloading Flick’s voice (first start only, about 330 MB)…'
        : 'Flick’s voice is getting ready…';

  return (
    <Card style={{ background: `linear-gradient(135deg, ${colors.plum} 0%, #6a5a9e 100%)`, border: 'none' }}>
      <Group gap={10}>
        <IconSpeakerphone size={22} color={colors.aquaButton} />
        <Text fz={18} fw={800} c="#fff">
          Let Flick present
        </Text>
        <Badge color="aqua.3" c={colors.ink} radius="sm" tt="none">
          New
        </Badge>
      </Group>
      <Text fz={14} c="#e6e2f0" mt={8} lh={1.55}>
        Flick runs the slide show and explains every slide to the class in its own voice, drawing on a whiteboard when
        an idea is hard to picture. Questions in the middle? It pauses, answers, and carries on.
      </Text>
      {status.state === 'finished' && (
        <Text fz={13} c={colors.aquaButton} fw={600} mt={10}>
          Finished presenting {deck.name}.
        </Text>
      )}
      {status.powerpoint && !status.study && status.state !== 'idle' && status.state !== 'finished' && (
        <Text fz={13} c="#ffe7a8" fw={600} mt={10} role="status">
          ⚠️ {status.powerpoint}
        </Text>
      )}
      {status.state === 'error' && status.message && (
        <Text fz={13} c="#ffd5cf" fw={600} mt={10}>
          {status.message}
        </Text>
      )}
      <SegmentedControl
        mt={16}
        value={style}
        onChange={setStyle}
        radius="md"
        data={[
          { value: 'class', label: 'Standard' },
          { value: 'story', label: '📖 Story' },
          { value: 'professional', label: '💼 Professional' },
          { value: 'exam', label: '🎯 Exam' },
          { value: 'visual', label: '✏️ Visual' },
        ]}
        styles={{ root: { background: 'rgba(255,255,255,0.14)' }, label: { color: '#fff' }, indicator: { background: 'rgba(255,255,255,0.28)' } }}
        aria-label="How Flick explains"
      />
      <BoardPicker value={board} onChange={setBoard} style={style} dark />
      <Group gap={10} mt={14} align="flex-end">
        <Button
          size="lg"
          leftSection={<IconPlayerPlay size={20} />}
          loading={presenter.busy}
          disabled={!voiceReady}
          onClick={() => presenter.start(fromSlide, style, board)}
        >
          Present for me
        </Button>
        <NumberInput
          size="lg"
          w={112}
          min={1}
          max={deck.slides.length}
          value={fromSlide}
          onChange={(v) => setFromSlide(typeof v === 'number' ? v : 1)}
          aria-label="Start from slide"
          leftSection={<Text fz={12} c={colors.muted}>from</Text>}
          leftSectionWidth={42}
        />
      </Group>
      {voiceNote && (
        <Stack gap={0} mt={10}>
          <Text fz={12.5} c="#e6e2f0">
            {voiceNote}
          </Text>
        </Stack>
      )}
    </Card>
  );
}
