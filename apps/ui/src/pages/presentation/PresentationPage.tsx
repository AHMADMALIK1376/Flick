// Issue #4 · Design screens: D1 Empty · D3 Preparing · D2 Ready
//
// Main page. Loads the active deck and shows one of 3 states:
//   no deck → <EmptyState/>, preparing → <PreparingState/>, else <ReadyState/>.
// Below: <DeckList/> with earlier presentations.
import { Center, Loader, SimpleGrid, Stack } from '@mantine/core';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/flick';
import type { Answer, Deck, DeckSummary, PrepProgress, Settings, Status } from '../../api/types';
import { PageHeader } from '../../components/PageHeader';
import { StatusPill } from '../../components/StatusPill';
import { useFlickEvent } from '../../hooks/useEvents';
import { usePresenter } from '../../hooks/usePresenter';
import { DeckList } from './DeckList';
import { DuringTalkCard } from './DuringTalkCard';
import { EmptyState } from './EmptyState';
import { PreparingState } from './PreparingState';
import { PresentForMeCard } from './PresentForMeCard';
import { ReadyState } from './ReadyState';
import { RecentQuestionsCard } from './RecentQuestionsCard';

interface PageData {
  deck: Deck | null;
  decks: DeckSummary[];
  settings: Settings | null;
  log: Answer[];
}

export function PresentationPage() {
  const [data, setData] = useState<PageData | null>(null);
  const [progress, setProgress] = useState<PrepProgress | null>(null);
  const [voice, setVoice] = useState<Status['voice'] | null>(null);
  const presenter = usePresenter();

  // Flick's voice downloads once on first start: check until it's ready.
  useEffect(() => {
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
  }, []);

  const reload = useCallback(async () => {
    const [deck, decks, settings, log] = await Promise.all([
      api.activeDeck().catch(() => null),
      api.listDecks().catch(() => [] as DeckSummary[]),
      api.getSettings().catch(() => null),
      api.getLog(50).catch(() => [] as Answer[]),
    ]);
    setData({ deck, decks, settings, log });
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useFlickEvent('prep_progress', (p) => {
    setProgress(p);
    if (p.status !== 'preparing') void reload();
  });
  useFlickEvent('answer', () => void reload());

  if (!data) {
    return (
      <Center h={300}>
        <Loader color="plum" />
      </Center>
    );
  }

  const { deck, decks, settings, log } = data;
  const live = progress && deck && progress.deck_id === deck.id ? progress : null;
  const preparing = !!deck && (live ? live.status === 'preparing' : deck.prep_status === 'preparing');
  const askHotkey = settings?.ask_hotkey ?? 'Ctrl+Shift+Space';
  const explainHotkey = settings?.explain_hotkey ?? 'Ctrl+Shift+E';

  const pill = presenter.active ? (
    <StatusPill tone="working">Flick is presenting</StatusPill>
  ) : !deck ? (
    <StatusPill tone="neutral">No presentation loaded</StatusPill>
  ) : preparing ? (
    <StatusPill tone="working">Preparing questions…</StatusPill>
  ) : deck.prep_status === 'error' ? (
    <StatusPill tone="bad">Preparing failed</StatusPill>
  ) : (
    <StatusPill tone="good">Ready for your talk</StatusPill>
  );

  return (
    <Stack gap={24} maw={1200}>
      <PageHeader title="Presentation" subtitle="Load your slides, then ask Flick during your talk." actions={pill} />

      {deck && !preparing && <PresentForMeCard deck={deck} presenter={presenter} voice={voice} askHotkey={askHotkey} />}

      <SimpleGrid cols={{ base: 1, md: 2 }} spacing={24} style={{ alignItems: 'start' }}>
        <Stack gap={24}>
          {!deck ? (
            <EmptyState hasApiKey={settings?.has_api_key ?? true} onLoaded={reload} />
          ) : preparing ? (
            <PreparingState deck={deck} progress={live} />
          ) : (
            <ReadyState deck={deck} log={log} onChanged={reload} />
          )}
        </Stack>
        <Stack gap={24}>
          <DuringTalkCard askHotkey={askHotkey} explainHotkey={explainHotkey} />
          {deck && !preparing && <RecentQuestionsCard log={log} />}
        </Stack>
      </SimpleGrid>

      {decks.length > 1 && <DeckList decks={decks} onChanged={reload} />}
    </Stack>
  );
}
