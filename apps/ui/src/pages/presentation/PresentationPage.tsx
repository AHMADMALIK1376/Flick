// Issue #4 · Design screen: D1 Empty · D3 Preparing · D2 Ready
//
// Main page. Load the active deck and show one of 3 states:
//   no deck → <EmptyState/>, prep_status 'preparing' → <PreparingState/>, else <ReadyState/>.
// Below it: <DeckList/> with earlier presentations.
//
// Backend: GET /decks/active, GET /decks   (functions in src/api/flick.ts)
// Live events: prep_progress   (use useFlickEvent from src/hooks/useEvents.ts)

import { Stack } from '@mantine/core';
import { PageHeader } from '../../components/PageHeader';
import { TodoPanel } from '../../components/TodoPanel';

export function PresentationPage() {
  return (
    <Stack>
      <PageHeader title='Presentation' subtitle='Load your slides so Flick can answer questions.' />
      <TodoPanel
        issue={4}
        items={[
          'EmptyState.tsx (D1)',
          'PreparingState.tsx (D3)',
          'ReadyState.tsx (D2)',
          'DeckList.tsx (earlier decks)',
        ]}
      />
    </Stack>
  );
}
