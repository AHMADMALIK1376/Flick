// Issue #5 · Design screen: D4 Prepared Questions
//
// Questions of the active deck grouped by slide (slide 0 = whole talk), with a search box.
//
// Backend: GET /decks/active   (functions in src/api/flick.ts)

import { Stack } from '@mantine/core';
import { PageHeader } from '../../components/PageHeader';
import { TodoPanel } from '../../components/TodoPanel';

export function PreparedQuestionsPage() {
  return (
    <Stack>
      <PageHeader title='Prepared Questions' subtitle='Questions Flick expects, with ready answers.' />
      <TodoPanel
        issue={5}
        items={[
          'Group deck.predicted by slide',
          'Search box',
          'QuestionItem.tsx for one question',
          'Add / Edit / Delete after #10',
        ]}
      />
    </Stack>
  );
}
