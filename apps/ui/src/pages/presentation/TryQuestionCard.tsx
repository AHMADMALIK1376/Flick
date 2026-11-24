// "Try a question": type a question and see Flick's answer, with its source badge.
// Backend: POST /ask
import { Anchor, Box, Button, Card, Group, Stack, Text, TextInput } from '@mantine/core';
import { IconExternalLink, IconSend } from '@tabler/icons-react';
import { useState } from 'react';
import { api } from '../../api/flick';
import type { Answer } from '../../api/types';
import { OriginBadge } from '../../components/OriginBadge';
import { colors } from '../../theme';
import { formatDuration } from '../../utils/format';
import { CardTitle } from './parts';
import { errorText } from './useDeckLoader';

export function TryQuestionCard() {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function ask() {
    const question = text.trim();
    if (!question || busy) return;
    setBusy(true);
    setNote(null);
    try {
      const result = await api.ask(question);
      setAnswer(result);
      if (!result) setNote('Nothing to answer.');
    } catch (err) {
      setAnswer(null);
      setNote(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardTitle>Try a question</CardTitle>
      <Group gap={10} mt={14} wrap="nowrap">
        <TextInput
          size="md"
          style={{ flex: 1 }}
          placeholder="Type a question your audience might ask"
          aria-label="Question"
          value={text}
          onChange={(e) => setText(e.currentTarget.value)}
          onKeyDown={(e) => e.key === 'Enter' && void ask()}
        />
        <Button size="md" leftSection={<IconSend size={17} />} loading={busy} onClick={ask} disabled={!text.trim()}>
          Ask
        </Button>
      </Group>

      {note && (
        <Text fz={13} c={colors.muted} mt={12}>
          {note}
        </Text>
      )}

      {answer && (
        <Box mt={16} p={18} style={{ background: colors.soft, border: `1px solid ${colors.border}`, borderRadius: 12 }}>
          <Group justify="space-between" mb={10}>
            <OriginBadge origin={answer.origin} />
            <Text fz={12} c={colors.muted}>
              {formatDuration(answer.duration_ms)}
              {answer.current_slide ? ` · slide ${answer.current_slide}` : ''}
            </Text>
          </Group>
          <Text fz={15} lh={1.6} c={colors.ink} style={{ whiteSpace: 'pre-wrap' }}>
            {answer.answer}
          </Text>
          {answer.sources.length > 0 && (
            <Stack gap={4} mt={12}>
              {answer.sources.map((s) => (
                <Anchor key={s.url} href={s.url} target="_blank" rel="noreferrer" fz={13} fw={600} c={colors.plum}>
                  <Group gap={4} wrap="nowrap">
                    <IconExternalLink size={14} />
                    {s.title || s.url}
                  </Group>
                </Anchor>
              ))}
            </Stack>
          )}
        </Box>
      )}
    </Card>
  );
}
