// Issue #4 · Design screen: D1 Presentation · Empty
//
// Two big options: "Use open PowerPoint" and "Upload .pptx" (Mantine Dropzone).
//
// Backend: POST /decks/from-powerpoint, POST /decks/upload   (functions in src/api/flick.ts)

import { Text } from '@mantine/core';

// TODO: build D1
export function EmptyState() {
  return <Text c="dimmed">EmptyState (not built yet)</Text>;
}
