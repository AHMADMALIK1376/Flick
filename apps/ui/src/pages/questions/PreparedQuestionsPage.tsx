// Issue #5 · Design screen: D4 Prepared Questions
//
// Questions of the active deck grouped by slide (slide 0 = whole talk), with search,
// Speak, and Add / Edit / Delete.
// Backend: GET /decks/active, POST /decks/{id}/prepare, POST/PATCH/DELETE questions
import { Button, Card, Center, Group, Loader, Modal, SimpleGrid, Stack, Text, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconPlus, IconRefresh, IconSearch } from '@tabler/icons-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/flick';
import type { Deck, PredictedQuestion } from '../../api/types';
import { PageHeader } from '../../components/PageHeader';
import { useFlickEvent } from '../../hooks/useEvents';
import { colors } from '../../theme';
import { QuestionEditor, type QuestionDraft } from './QuestionEditor';
import { QuestionItem } from './QuestionItem';

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong.';
}

export function PreparedQuestionsPage() {
  const navigate = useNavigate();
  const [deck, setDeck] = useState<Deck | null | undefined>(undefined); // undefined = loading
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<PredictedQuestion | 'new' | null>(null);
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState<PredictedQuestion | null>(null);
  const [preparing, setPreparing] = useState(false);

  const reload = useCallback(async () => {
    try {
      setDeck(await api.activeDeck());
    } catch (err) {
      setDeck(null);
      notifications.show({ color: 'red', message: errorText(err) });
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useFlickEvent('prep_progress', (p) => {
    if (p.status !== 'preparing') {
      setPreparing(false);
      void reload();
    } else setPreparing(true);
  });

  const groups = useMemo(() => {
    if (!deck) return [];
    const needle = search.trim().toLowerCase();
    const matches = deck.predicted.filter(
      (q) => !needle || q.question.toLowerCase().includes(needle) || q.answer.toLowerCase().includes(needle),
    );
    const bySlide = new Map<number, PredictedQuestion[]>();
    for (const q of matches) bySlide.set(q.slide, [...(bySlide.get(q.slide) ?? []), q]);
    return [...bySlide.entries()]
      .sort(([a], [b]) => a - b)
      .map(([slide, items]) => {
        const title = deck.slides.find((s) => s.number === slide)?.title;
        const heading = slide === 0 ? 'Whole talk' : title ? `Slide ${slide} · ${title}` : `Slide ${slide}`;
        return { slide, heading, items };
      });
  }, [deck, search]);

  if (deck === undefined) {
    return (
      <Center h={300}>
        <Loader color="plum" />
      </Center>
    );
  }

  if (deck === null) {
    return (
      <Stack gap={24} maw={860}>
        <PageHeader title="Prepared Questions" subtitle="Questions Flick expects, with ready answers." />
        <Card>
          <Text c={colors.muted}>No presentation loaded. Load one on the Presentation page.</Text>
          <Button mt={14} w="fit-content" onClick={() => navigate('/presentation')}>
            Go to Presentation
          </Button>
        </Card>
      </Stack>
    );
  }

  const activeDeck = deck;

  async function prepareAgain() {
    setPreparing(true);
    try {
      await api.prepareDeck(activeDeck.id);
      notifications.show({ color: 'teal', message: 'Preparing again… new questions appear when it is done.' });
    } catch (err) {
      setPreparing(false);
      notifications.show({ color: 'red', message: errorText(err) });
    }
  }

  async function save(draft: QuestionDraft) {
    setSaving(true);
    const body = { slide: draft.slide, question: draft.question.trim(), answer: draft.answer.trim() };
    try {
      if (editing === 'new') await api.addQuestion(activeDeck.id, body);
      else if (editing) await api.editQuestion(editing.id, body);
      setEditing(null);
      await reload();
    } catch (err) {
      notifications.show({ color: 'red', message: errorText(err) });
    } finally {
      setSaving(false);
    }
  }

  async function remove(item: PredictedQuestion) {
    setToDelete(null);
    try {
      await api.deleteQuestion(item.id);
      await reload();
    } catch (err) {
      notifications.show({ color: 'red', message: errorText(err) });
    }
  }

  const total = activeDeck.predicted.length;

  return (
    <Stack gap={22} maw={1100}>
      <PageHeader
        title="Prepared Questions"
        subtitle={`${total} questions Flick predicted for ${activeDeck.name}. Review them to rehearse.`}
        actions={
          <>
            <Button variant="default" leftSection={<IconRefresh size={17} />} loading={preparing} onClick={prepareAgain}>
              Prepare again
            </Button>
            <Button leftSection={<IconPlus size={17} />} onClick={() => setEditing('new')}>
              Add question
            </Button>
          </>
        }
      />

      <TextInput
        size="md"
        maw={520}
        leftSection={<IconSearch size={17} />}
        placeholder="Search prepared questions"
        aria-label="Search prepared questions"
        value={search}
        onChange={(e) => setSearch(e.currentTarget.value)}
        styles={{ input: { background: colors.surface } }}
      />

      {total === 0 ? (
        <Card>
          <Text c={colors.muted}>
            {preparing || activeDeck.prep_status === 'preparing'
              ? 'Flick is still preparing questions…'
              : 'No prepared questions yet. Press "Prepare again", or add your own.'}
          </Text>
        </Card>
      ) : groups.length === 0 ? (
        <Text c={colors.muted}>No questions match “{search}”.</Text>
      ) : (
        groups.map((group) => (
          <Stack key={group.slide} gap={12}>
            <Text fz={13} fw={700} tt="uppercase" c={colors.plum} style={{ letterSpacing: 0.6 }}>
              {group.heading}
            </Text>
            <SimpleGrid cols={{ base: 1, md: 2 }} spacing={14}>
              {group.items.map((item) => (
                <QuestionItem key={item.id} item={item} onEdit={setEditing} onDelete={setToDelete} />
              ))}
            </SimpleGrid>
          </Stack>
        ))
      )}

      <QuestionEditor deck={activeDeck} editing={editing} saving={saving} onClose={() => setEditing(null)} onSave={save} />

      <Modal opened={toDelete !== null} onClose={() => setToDelete(null)} title="Delete this question?" centered>
        <Text fz={14} c={colors.muted}>
          “{toDelete?.question}”
        </Text>
        <Group justify="flex-end" mt={20}>
          <Button variant="default" onClick={() => setToDelete(null)}>
            Cancel
          </Button>
          <Button
            variant="default"
            c="#9b2c2c"
            style={{ borderColor: '#f0c9c9' }}
            onClick={() => toDelete && void remove(toDelete)}
          >
            Delete
          </Button>
        </Group>
      </Modal>
    </Stack>
  );
}
