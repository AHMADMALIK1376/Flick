// Issue #4 · Design screen: D2 Ready
//
// Deck name, slides, prepared questions, explanations ready, "Explain this slide", "Prepare again".
//
// Backend: POST /explain, POST /decks/{id}/prepare   (functions in src/api/flick.ts)

import { Text } from '@mantine/core';

// TODO: build D2
export function ReadyState() {
  return <Text c="dimmed">ReadyState (not built yet)</Text>;
}
