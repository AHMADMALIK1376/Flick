// Issue #6 · Design screen: D5 Q&A Log
//
// Past questions and answers, newest first. Filter by source, Export as CSV, Clear.
// Backend: GET /log, DELETE /log, GET /log/export · Live events: answer
import { Button, Card, Center, Group, Loader, Modal, SegmentedControl, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconDownload, IconTrash } from '@tabler/icons-react';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api/flick';
import type { Answer, AnswerOrigin } from '../../api/types';
import { PageHeader } from '../../components/PageHeader';
import { useFlickEvent } from '../../hooks/useEvents';
import { colors } from '../../theme';
import { LogItem } from './LogItem';

const FILTERS: { label: string; value: string; origins: AnswerOrigin[] | null }[] = [
  { label: 'All', value: 'all', origins: null },
  { label: 'Prepared', value: 'prepared', origins: ['prepared'] },
  { label: 'Slides', value: 'slides', origins: ['slides'] },
  { label: 'Web', value: 'web', origins: ['web'] },
  { label: 'Explain', value: 'explain', origins: ['explain'] },
  { label: 'Examples', value: 'example', origins: ['example'] },
  { label: 'Problems', value: 'error', origins: ['error'] },
];

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong.';
}

export function QaLogPage() {
  const [log, setLog] = useState<Answer[] | null>(null);
  const [filter, setFilter] = useState('all');
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    api
      .getLog()
      .then((items) => setLog(items.filter((a) => a.origin !== 'greeting')))
      .catch((err) => {
        setLog([]);
        notifications.show({ color: 'red', message: errorText(err) });
      });
  }, []);

  // New answers appear at the top without a reload.
  useFlickEvent('answer', (a) => {
    if (a.origin === 'greeting') return;
    setLog((old) => (old && !old.some((x) => x.id === a.id) ? [a, ...old] : old));
  });

  const shown = useMemo(() => {
    const origins = FILTERS.find((f) => f.value === filter)?.origins;
    return (log ?? []).filter((a) => !origins || origins.includes(a.origin));
  }, [log, filter]);

  async function clear() {
    setClearing(true);
    try {
      await api.clearLog();
      setLog([]);
      setConfirmClear(false);
      notifications.show({ color: 'teal', message: 'Log cleared' });
    } catch (err) {
      notifications.show({ color: 'red', message: errorText(err) });
    } finally {
      setClearing(false);
    }
  }

  const empty = log !== null && log.length === 0;

  return (
    <Stack gap={22} maw={860}>
      <PageHeader
        title="Q&A Log"
        subtitle="Every question asked during your talks, newest first."
        actions={
          <>
            <Button
              variant="default"
              leftSection={<IconDownload size={17} />}
              component="a"
              href={api.exportLogUrl()}
              download="flick-qa-log.csv"
              disabled={empty}
            >
              Export
            </Button>
            <Button
              variant="default"
              c="#9b2c2c"
              style={{ borderColor: '#f0c9c9' }}
              leftSection={<IconTrash size={17} />}
              disabled={empty}
              onClick={() => setConfirmClear(true)}
            >
              Clear
            </Button>
          </>
        }
      />

      {log === null ? (
        <Center h={200}>
          <Loader color="plum" />
        </Center>
      ) : empty ? (
        <Card>
          <Text c={colors.muted}>No questions yet. Questions asked during your talk appear here.</Text>
        </Card>
      ) : (
        <>
          <SegmentedControl
            data={FILTERS.map(({ label, value }) => ({ label, value }))}
            value={filter}
            onChange={setFilter}
            w="fit-content"
            radius="md"
            color="plum"
          />
          {shown.length === 0 ? (
            <Text c={colors.muted}>Nothing here for this filter.</Text>
          ) : (
            <Stack gap={14}>
              {shown.map((a) => (
                <LogItem key={a.id} answer={a} />
              ))}
            </Stack>
          )}
        </>
      )}

      <Modal opened={confirmClear} onClose={() => setConfirmClear(false)} title="Clear the whole log?" centered>
        <Text fz={14} c={colors.muted}>
          All questions and answers will be removed. This can't be undone.
        </Text>
        <Group justify="flex-end" mt={20}>
          <Button variant="default" onClick={() => setConfirmClear(false)}>
            Cancel
          </Button>
          <Button variant="default" c="#9b2c2c" style={{ borderColor: '#f0c9c9' }} loading={clearing} onClick={clear}>
            Clear log
          </Button>
        </Group>
      </Modal>
    </Stack>
  );
}
