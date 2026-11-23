// Issue #8 · Design screen: L2 Answer Card States + L4 Explain
//
// Separate always-on-top window (Electron opens #/card). No sidebar.
// States: listening → thinking → searching → streaming → answer, or error.
// Keep the state logic in answerState.ts so it can be tested.
// Live events: thinking, searching, answer_delta, answer   (use useFlickEvent from src/hooks/useEvents.ts)

import { Card, Text } from '@mantine/core';
import { TodoPanel } from '../../components/TodoPanel';

export function AnswerCard() {
  // TODO(#8): const [state, dispatch] = useReducer(answerReducer, initialCardState);
  //           useFlickEvent('thinking', (d) => dispatch({ type: 'thinking', ...d })); ...
  return (
    <Card m="sm" shadow="md">
      <Text fw={700}>Answer card</Text>
      <TodoPanel issue={8} items={['answerState.ts reducer', '6 states from the design', 'Explain badge', 'Hide a few seconds after the answer']} />
    </Card>
  );
}
