// Study: 1) choose a presentation, 2) choose a mode, 3) start.
import { Badge, Box, Button, Card, Group, NumberInput, Radio, SimpleGrid, Stack, Text } from '@mantine/core';
import { IconPlayerPlay, IconUpload } from '@tabler/icons-react';
import { useState } from 'react';
import type { DeckSummary, Status } from '../../api/types';
import type { Presenter } from '../../hooks/usePresenter';
import { colors } from '../../theme';
import { pickFile } from '../presentation/EmptyState';
import { useDeckLoader } from '../presentation/useDeckLoader';
import { STUDY_MODES } from './modes';

interface Props {
  decks: DeckSummary[];
  presenter: Presenter;
  voice: Status['voice'] | null;
  onDecksChanged: () => void;
}

function StepLabel({ n, children }: { n: number; children: string }) {
  return (
    <Group gap={10} mb={12}>
      <Box w={28} h={28} style={{ borderRadius: '50%', background: colors.aqua, display: 'grid', placeItems: 'center', fontWeight: 800, color: colors.ink }}>
        {n}
      </Box>
      <Text fz={16} fw={800} c={colors.ink}>
        {children}
      </Text>
    </Group>
  );
}

export function StudySetup({ decks, presenter, voice, onDecksChanged }: Props) {
  const active = decks.find((d) => d.active);
  const [deckId, setDeckId] = useState<string | null>(active?.id ?? decks[0]?.id ?? null);
  const [mode, setMode] = useState<string>('story');
  const [fromSlide, setFromSlide] = useState(1);
  const loader = useDeckLoader(onDecksChanged);
  const chosen = decks.find((d) => d.id === deckId) ?? null;
  const voiceReady = voice?.ready ?? false;

  return (
    <Stack gap={24}>
      <Card>
        <StepLabel n={1}>Choose your presentation</StepLabel>
        {decks.length === 0 ? (
          <Text c={colors.muted} fz={14} mb={12}>
            Upload the slides your teacher gave you (.pptx).
          </Text>
        ) : (
          <Radio.Group value={deckId ?? ''} onChange={setDeckId}>
            <SimpleGrid cols={{ base: 1, md: 2 }} spacing={12}>
              {decks.map((d) => {
                const checked = d.id === deckId;
                return (
                  <Radio.Card
                    key={d.id}
                    value={d.id}
                    radius={12}
                    p={14}
                    style={{ border: `2px solid ${checked ? colors.aqua : colors.border}`, background: checked ? '#eef9f8' : colors.surface }}
                  >
                    <Text fw={700} c={colors.ink} truncate>
                      {d.name}
                    </Text>
                    <Text fz={13} c={colors.muted}>
                      {d.slide_count} slides
                    </Text>
                  </Radio.Card>
                );
              })}
            </SimpleGrid>
          </Radio.Group>
        )}
        <Button
          mt={14}
          w="fit-content"
          variant="default"
          leftSection={<IconUpload size={17} />}
          loading={loader.busy === 'file'}
          onClick={() => pickFile(loader.uploadFile)}
        >
          Upload a .pptx
        </Button>
      </Card>

      <Card>
        <StepLabel n={2}>How should Flick explain it?</StepLabel>
        <Radio.Group value={mode} onChange={setMode}>
          <SimpleGrid cols={{ base: 1, md: 3 }} spacing={14}>
            {STUDY_MODES.map((m) => {
              const checked = m.id === mode;
              return (
                <Radio.Card
                  key={m.id}
                  value={m.id}
                  radius={14}
                  p={18}
                  style={{
                    border: `2px solid ${checked ? colors.aqua : colors.border}`,
                    background: checked ? '#eef9f8' : colors.surface,
                    height: '100%',
                  }}
                >
                  <Text fz={34} lh={1}>
                    {m.emoji}
                  </Text>
                  <Text fz={16} fw={800} c={colors.ink} mt={10}>
                    {m.name}
                  </Text>
                  <Badge mt={4} radius="sm" tt="none" color="plum" variant="light">
                    {m.tagline}
                  </Badge>
                  <Text fz={13} c={colors.muted} mt={8} lh={1.5}>
                    {m.text}
                  </Text>
                </Radio.Card>
              );
            })}
          </SimpleGrid>
        </Radio.Group>
        <Text fz={12.5} c={colors.muted} mt={12}>
          In every mode, Flick draws on its whiteboard when an idea is hard to picture, and you can stop it any time to
          ask a question.
        </Text>
      </Card>

      <Card>
        <StepLabel n={3}>Start</StepLabel>
        <Group gap={12} align="flex-end">
          <Button
            size="lg"
            leftSection={<IconPlayerPlay size={20} />}
            disabled={!chosen || !voiceReady}
            loading={presenter.busy}
            onClick={() => chosen && presenter.startStudy(mode, chosen.id, fromSlide)}
          >
            Start studying
          </Button>
          <NumberInput
            size="lg"
            w={112}
            min={1}
            max={chosen?.slide_count ?? 1}
            value={fromSlide}
            onChange={(v) => setFromSlide(typeof v === 'number' ? v : 1)}
            aria-label="Start from slide"
            leftSection={<Text fz={12} c={colors.muted}>from</Text>}
            leftSectionWidth={42}
          />
        </Group>
        {!voiceReady && (
          <Text fz={12.5} c={colors.muted} mt={10}>
            {voice?.error ?? (voice?.downloading ? 'Downloading Flick’s voice (first start only)…' : 'Flick’s voice is getting ready…')}
          </Text>
        )}
      </Card>
    </Stack>
  );
}
