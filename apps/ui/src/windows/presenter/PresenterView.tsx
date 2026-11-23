// Issue #9 · Design screen: L1 Presenter View
//
// Compact window: current slide, last question, last answer (<OriginBadge/>), Ask and Explain buttons.
//
// Backend: POST /explain, POST /ask-audio   (functions in src/api/flick.ts)
// Live events: answer   (use useFlickEvent from src/hooks/useEvents.ts)

import { Card, Text } from '@mantine/core';
import { TodoPanel } from '../../components/TodoPanel';

export function PresenterView() {
  return (
    <Card m="sm">
      <Text fw={700}>Presenter view</Text>
      <TodoPanel issue={9} items={['Current slide', 'Last question + answer', 'Ask and Explain buttons']} />
    </Card>
  );
}
