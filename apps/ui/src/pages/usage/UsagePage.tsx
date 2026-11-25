// Token Analyzer: how many Claude tokens, and how much money, each part of Flick uses.
// A card per whole presentation / study session (by mode), per slide explained or example
// drawn, for questions, and for getting a deck ready. Click a card to open it in place.
// Backend: GET /usage, DELETE /usage · Live events: usage
import { Box, Button, Card, Center, Group, Loader, Modal, SegmentedControl, SimpleGrid, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconTrash } from '@tabler/icons-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api/flick';
import type { UsageReport } from '../../api/types';
import { PageHeader } from '../../components/PageHeader';
import { MODEL_EVENT } from '../../layout/ModelPicker';
import { useFlickEvent } from '../../hooks/useEvents';
import { colors } from '../../theme';
import { tokens, usd } from './format';
import { UsageCardView } from './UsageCardView';

const FILTERS = [
  { label: 'All', value: 'all' },
  { label: 'Presentations', value: 'presentation' },
  { label: 'Study', value: 'study' },
  { label: 'Single slides', value: 'slide' },
  { label: 'Questions', value: 'questions' },
  { label: 'Preparation', value: 'prep' },
];

/** claude-haiku-5-5 → Haiku 5.5 */
function modelName(model: string): string {
  const m = /^claude-([a-z]+)-(\d+)-(\d+)/.exec(model);
  return m ? `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}.${m[3]}` : model;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong.';
}

function Tile({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <Card p={16}>
      <Text fz={12} fw={700} c={colors.muted} tt="uppercase" style={{ letterSpacing: 0.4 }}>
        {label}
      </Text>
      <Text fz={28} fw={800} c={colors.ink} style={{ fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </Text>
      <Text fz={12.5} c={colors.muted}>
        {hint}
      </Text>
    </Card>
  );
}

export function UsagePage() {
  const [report, setReport] = useState<UsageReport | null>(null);
  const [filter, setFilter] = useState('all');
  const [open, setOpen] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const refreshTimer = useRef<number | null>(null);

  const load = useCallback(() => {
    api
      .usage()
      .then(setReport)
      .catch((err) => notifications.show({ color: 'red', message: errorText(err) }));
  }, []);

  useEffect(load, [load]);
  // The model was changed in the sidebar: show its prices.
  useEffect(() => {
    window.addEventListener(MODEL_EVENT, load);
    return () => window.removeEventListener(MODEL_EVENT, load);
  }, [load]);
  useEffect(() => () => {
    if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
  }, []);

  // A call was counted: refresh (at most twice a second while a talk is running).
  useFlickEvent('usage', () => {
    if (refreshTimer.current) return;
    refreshTimer.current = window.setTimeout(() => {
      refreshTimer.current = null;
      load();
    }, 500);
  });

  const cards = useMemo(
    () => (report?.cards ?? []).filter((c) => filter === 'all' || c.type === filter),
    [report, filter],
  );

  const talks = (report?.cards ?? []).filter((c) => (c.type === 'presentation' || c.type === 'study') && c.totals.calls > 0);
  const averageTalk = talks.length ? talks.reduce((sum, c) => sum + c.totals.cost, 0) / talks.length : null;
  const price = report ? report.prices[report.model] : null;

  async function clear() {
    try {
      await api.clearUsage();
      setConfirmClear(false);
      setOpen(null);
      load();
    } catch (err) {
      notifications.show({ color: 'red', message: errorText(err) });
    }
  }

  return (
    <Stack gap={18}>
      <PageHeader
        title="Token Analyzer"
        subtitle="How many Claude tokens each presentation, slide, question and drawing uses, and what it costs."
        actions={
          <Button variant="default" leftSection={<IconTrash size={16} />} disabled={!report?.cards.length} onClick={() => setConfirmClear(true)}>
            Clear
          </Button>
        }
      />

      {report === null ? (
        <Center py={60}>
          <Loader color="plum" />
        </Center>
      ) : (
        <>
          <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing={14}>
            <Tile label="Total spent" value={usd(report.total.cost)} hint={`${report.total.calls} Claude calls`} />
            <Tile
              label="Tokens"
              value={tokens(report.total.tokens)}
              hint={`${tokens(report.total.input)} in · ${tokens(report.total.output)} out · ${tokens(report.total.cache_read)} cached`}
            />
            <Tile
              label="Average talk"
              value={averageTalk === null ? '—' : usd(averageTalk)}
              hint={talks.length ? `over ${talks.length} presentations / study sessions` : 'present or study a deck to see it'}
            />
            <Tile
              label="Prices"
              value={modelName(report.model)}
              hint={
                price
                  ? `$${price.input.toFixed(2)} in · $${price.output.toFixed(2)} out per million tokens · $${report.web_search.toFixed(2)} a web search`
                  : 'per million tokens'
              }
            />
          </SimpleGrid>

          <SegmentedControl value={filter} onChange={setFilter} data={FILTERS} w="fit-content" aria-label="Show cards for" />

          {cards.length === 0 ? (
            <Card p={30}>
              <Text ta="center" fz={30} aria-hidden>
                📊
              </Text>
              <Text ta="center" fw={700} c={colors.ink} mt={6}>
                Nothing counted yet
              </Text>
              <Text ta="center" fz={13.5} c={colors.muted} mt={4} maw={460} mx="auto">
                Ask a question, explain a slide, or let Flick present or teach a deck. Each one gets a card here with
                its tokens and cost.
              </Text>
            </Card>
          ) : (
            <Stack gap={12}>
              {cards.map((c) => (
                <UsageCardView key={c.id} card={c} open={open === c.id} onToggle={() => setOpen(open === c.id ? null : c.id)} />
              ))}
            </Stack>
          )}

          <Box>
            <Text fz={12} c={colors.muted}>
              Costs use Claude's list prices for the model each call used. Prompts over 100K tokens on Haiku 5.5 cost 5×.
              Answers ready from preparation cost nothing at talk time; their cost is on the deck's preparation card.
            </Text>
          </Box>
        </>
      )}

      <Modal opened={confirmClear} onClose={() => setConfirmClear(false)} title="Clear the Token Analyzer?" centered>
        <Text fz={14}>This removes every card. Your decks and answers stay.</Text>
        <Group justify="flex-end" mt={18}>
          <Button variant="default" onClick={() => setConfirmClear(false)}>
            Cancel
          </Button>
          <Button color="red" onClick={clear}>
            Clear
          </Button>
        </Group>
      </Modal>
    </Stack>
  );
}
