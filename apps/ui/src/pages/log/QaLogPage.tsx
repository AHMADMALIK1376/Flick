// Issue #6 · Design screen: D5 Q&A Log
//
// Past questions and answers, newest first. Filter by origin, Clear, Export (after #11).
//
// Backend: GET /log, DELETE /log   (functions in src/api/flick.ts)
// Live events: answer   (use useFlickEvent from src/hooks/useEvents.ts)

import { Stack } from '@mantine/core';
import { PageHeader } from '../../components/PageHeader';
import { TodoPanel } from '../../components/TodoPanel';

export function QaLogPage() {
  return (
    <Stack>
      <PageHeader title='Q&A Log' subtitle='Every question Flick answered.' />
      <TodoPanel
        issue={6}
        items={[
          'Load api.getLog()',
          'LogItem.tsx for one entry (use <OriginBadge/>)',
          'Filter by origin',
          'Clear with confirm',
          "Add new answers live (useFlickEvent('answer'))",
        ]}
      />
    </Stack>
  );
}
