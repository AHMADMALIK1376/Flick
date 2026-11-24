// Modal to add or edit a prepared question.
import { Button, Group, Modal, Select, Stack, Textarea, TextInput } from '@mantine/core';
import { useEffect, useState } from 'react';
import type { Deck, PredictedQuestion } from '../../api/types';

export interface QuestionDraft {
  slide: number;
  question: string;
  answer: string;
}

interface Props {
  deck: Deck;
  /** null = closed; 'new' = add; a question = edit it. */
  editing: PredictedQuestion | 'new' | null;
  saving: boolean;
  onClose: () => void;
  onSave: (draft: QuestionDraft) => void;
}

export function QuestionEditor({ deck, editing, saving, onClose, onSave }: Props) {
  const [draft, setDraft] = useState<QuestionDraft>({ slide: 0, question: '', answer: '' });

  useEffect(() => {
    if (editing === 'new') setDraft({ slide: 0, question: '', answer: '' });
    else if (editing) setDraft({ slide: editing.slide, question: editing.question, answer: editing.answer });
  }, [editing]);

  const slides = [
    { value: '0', label: 'Whole talk' },
    ...deck.slides.map((s) => ({ value: String(s.number), label: `${s.number} · ${s.title || 'Untitled slide'}` })),
  ];
  const valid = draft.question.trim() !== '' && draft.answer.trim() !== '';

  return (
    <Modal
      opened={editing !== null}
      onClose={onClose}
      title={editing === 'new' ? 'Add a question' : 'Edit question'}
      centered
      size="lg"
    >
      <Stack gap={14}>
        <Select
          size="md"
          label="Slide"
          data={slides}
          value={String(draft.slide)}
          onChange={(v) => setDraft({ ...draft, slide: Number(v ?? 0) })}
          allowDeselect={false}
        />
        <TextInput
          size="md"
          label="Question"
          placeholder="What might someone ask?"
          value={draft.question}
          onChange={(e) => setDraft({ ...draft, question: e.currentTarget.value })}
          data-autofocus
        />
        <Textarea
          size="md"
          label="Answer"
          placeholder="Short answer Flick will say"
          autosize
          minRows={3}
          maxRows={8}
          value={draft.answer}
          onChange={(e) => setDraft({ ...draft, answer: e.currentTarget.value })}
        />
        <Group justify="flex-end" mt={6}>
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={saving} disabled={!valid} onClick={() => onSave(draft)}>
            {editing === 'new' ? 'Add question' : 'Save'}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
