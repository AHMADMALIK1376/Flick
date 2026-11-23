// Issue #4 · Design screen: D3 Preparing
//
// Progress bar + message while Flick predicts questions and writes slide explanations.
//
// Backend: POST /decks/{id}/prepare   (functions in src/api/flick.ts)
// Live events: prep_progress   (use useFlickEvent from src/hooks/useEvents.ts)

import { Text } from '@mantine/core';

// TODO: build D3
export function PreparingState() {
  return <Text c="dimmed">PreparingState (not built yet)</Text>;
}
