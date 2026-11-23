// Issue #3 · Design screen: O2 Claude API key
//
// Password input for the key + Save. Show a friendly error if saving fails.
//
// Backend: PATCH /settings   (functions in src/api/flick.ts)

import { Text } from '@mantine/core';

// TODO: build O2 (after #12, also call api.testKey())
export function ApiKeyStep() {
  return <Text c="dimmed">ApiKeyStep (not built yet)</Text>;
}
