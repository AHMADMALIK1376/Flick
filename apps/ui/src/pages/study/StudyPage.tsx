// Study: students give Flick their slides; it explains them in Story, Professional or Exam mode,
// draws on its whiteboard when it helps, and answers questions in the middle.
import { Button, Center, Group, Loader, Stack } from '@mantine/core';
import { IconArrowLeft } from '@tabler/icons-react';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/flick';
import type { DeckSummary, Status } from '../../api/types';
import { PageHeader } from '../../components/PageHeader';
import { usePresenter } from '../../hooks/usePresenter';
import { StudySession } from './StudySession';
import { StudySetup } from './StudySetup';

export function StudyPage() {
  const presenter = usePresenter();
  const [decks, setDecks] = useState<DeckSummary[] | null>(null);
  const [voice, setVoice] = useState<Status['voice'] | null>(null);
  const [showSetup, setShowSetup] = useState(false);

  const loadDecks = useCallback(() => {
    api
      .listDecks()
      .then(setDecks)
      .catch(() => setDecks([]));
  }, []);

  useEffect(() => {
    loadDecks();
    let alive = true;
    let timer: number | undefined;
    const check = () =>
      api
        .status()
        .then((s) => {
          if (!alive) return;
          setVoice(s.voice);
          if (!s.voice.ready && !s.voice.error) timer = window.setTimeout(check, 4000);
        })
        .catch(() => alive && (timer = window.setTimeout(check, 4000)));
    check();
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [loadDecks]);

  const { status } = presenter;
  const inSession = status.study && (presenter.active || status.state === 'finished') && !showSetup;
  useEffect(() => {
    if (presenter.active && status.study) setShowSetup(false);
  }, [presenter.active, status.study]);

  if (!decks) {
    return (
      <Center h={300}>
        <Loader color="plum" />
      </Center>
    );
  }

  return (
    <Stack gap={24} maw={1200}>
      <PageHeader
        title="Study"
        subtitle="Give Flick your slides. It explains them your way, draws when it helps, and answers your questions."
        actions={
          inSession ? (
            <Group gap={8}>
              {status.state === 'finished' && (
                <Button variant="default" leftSection={<IconArrowLeft size={16} />} onClick={() => setShowSetup(true)}>
                  Study again
                </Button>
              )}
              {presenter.active && (
                <Button variant="default" c="#9b2c2c" style={{ borderColor: '#f0c9c9' }} onClick={presenter.stop}>
                  End session
                </Button>
              )}
            </Group>
          ) : undefined
        }
      />
      {inSession ? (
        <StudySession presenter={presenter} />
      ) : (
        <StudySetup decks={decks} presenter={presenter} voice={voice} onDecksChanged={loadDecks} />
      )}
    </Stack>
  );
}
