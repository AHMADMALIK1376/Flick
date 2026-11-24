// Issue #4 · Design screen: D2 (bottom list)
//
// Earlier presentations with Use and Delete.
// Backend: POST /decks/{id}/activate, DELETE /decks/{id}
import { ActionIcon, Badge, Button, Card, Group, Modal, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconTrash } from '@tabler/icons-react';
import { useState } from 'react';
import { api } from '../../api/flick';
import type { DeckSummary } from '../../api/types';
import { colors } from '../../theme';
import { formatTime } from '../../utils/format';
import { CardTitle } from './parts';
import { errorText } from './useDeckLoader';

export function DeckList({ decks, onChanged }: { decks: DeckSummary[]; onChanged: () => void }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<DeckSummary | null>(null);

  async function act(id: string, action: () => Promise<unknown>) {
    setBusyId(id);
    try {
      await action();
      onChanged();
    } catch (err) {
      notifications.show({ color: 'red', message: errorText(err) });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card>
      <CardTitle>Your presentations</CardTitle>
      <Stack gap={0} mt={10}>
        {decks.map((d, i) => (
          <Group
            key={d.id}
            justify="space-between"
            wrap="nowrap"
            py={12}
            style={{ borderTop: i === 0 ? undefined : `1px solid ${colors.border}` }}
          >
            <Stack gap={2} style={{ minWidth: 0 }}>
              <Group gap={8} wrap="nowrap">
                <Text fw={700} c={colors.ink} truncate>
                  {d.name}
                </Text>
                {d.active && (
                  <Badge color="aqua.8" variant="light" radius="sm" tt="none">
                    Active
                  </Badge>
                )}
              </Group>
              <Text fz={13} c={colors.muted}>
                {d.slide_count} slides · {d.question_count} questions · loaded {formatTime(d.loaded_at)}
              </Text>
            </Stack>
            <Group gap={8} wrap="nowrap">
              {!d.active && (
                <Button
                  size="xs"
                  variant="default"
                  loading={busyId === d.id}
                  onClick={() => act(d.id, () => api.activateDeck(d.id))}
                >
                  Use
                </Button>
              )}
              <ActionIcon
                variant="subtle"
                color="red"
                aria-label="Delete presentation"
                onClick={() => setToDelete(d)}
                disabled={busyId === d.id}
              >
                <IconTrash size={17} />
              </ActionIcon>
            </Group>
          </Group>
        ))}
      </Stack>

      <Modal opened={toDelete !== null} onClose={() => setToDelete(null)} title="Delete presentation?" centered>
        <Text fz={14} c={colors.muted}>
          “{toDelete?.name}” and its prepared questions will be removed from Flick. Your .pptx file stays.
        </Text>
        <Group justify="flex-end" mt={20}>
          <Button variant="default" onClick={() => setToDelete(null)}>
            Cancel
          </Button>
          <Button
            variant="default"
            c="#9b2c2c"
            style={{ borderColor: '#f0c9c9' }}
            onClick={() => {
              const deck = toDelete;
              setToDelete(null);
              if (deck) void act(deck.id, () => api.deleteDeck(deck.id));
            }}
          >
            Delete
          </Button>
        </Group>
      </Modal>
    </Card>
  );
}
