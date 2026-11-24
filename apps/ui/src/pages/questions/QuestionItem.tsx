// Issue #5 · Design screen: D4 (one question card)
//
// Question + its answer, with Speak / Edit / Delete.
import { ActionIcon, Button, Card, Group, Text, Tooltip } from '@mantine/core';
import { IconPencil, IconPlayerStop, IconTrash, IconVolume } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import type { PredictedQuestion } from '../../api/types';
import { colors } from '../../theme';

interface Props {
  item: PredictedQuestion;
  onEdit: (item: PredictedQuestion) => void;
  onDelete: (item: PredictedQuestion) => void;
}

export function QuestionItem({ item, onEdit, onDelete }: Props) {
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => () => {
    if (speaking) window.speechSynthesis.cancel();
  }, [speaking]);

  function toggleSpeak() {
    window.speechSynthesis.cancel();
    if (speaking) {
      setSpeaking(false);
      return;
    }
    const utterance = new SpeechSynthesisUtterance(item.answer);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(utterance);
  }

  return (
    <Card p="18px 20px" style={{ display: 'flex', flexDirection: 'column' }}>
      <Text fz={15} fw={700} lh={1.4} c={colors.ink}>
        {item.question}
      </Text>
      <Text fz={14} lh={1.6} c={colors.muted} mt={8} style={{ flex: 1, whiteSpace: 'pre-wrap' }}>
        {item.answer}
      </Text>
      <Group gap={6} mt={14}>
        <Button
          size="xs"
          h={32}
          variant="default"
          leftSection={speaking ? <IconPlayerStop size={14} /> : <IconVolume size={14} />}
          onClick={toggleSpeak}
        >
          {speaking ? 'Stop' : 'Speak'}
        </Button>
        <div style={{ flex: 1 }} />
        <Tooltip label="Edit">
          <ActionIcon variant="subtle" color="gray" aria-label="Edit question" onClick={() => onEdit(item)}>
            <IconPencil size={16} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label="Delete">
          <ActionIcon variant="subtle" color="red" aria-label="Delete question" onClick={() => onDelete(item)}>
            <IconTrash size={16} />
          </ActionIcon>
        </Tooltip>
      </Group>
    </Card>
  );
}
