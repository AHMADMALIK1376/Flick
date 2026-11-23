// Issue #9 · Design screen: L3 Mic / Tray / Icon
//
// Small round floating button (Electron opens #/mic). Click: start/stop recording.
// States: idle, recording, working.
//
// Backend: POST /question-starting, POST /ask-audio   (functions in src/api/flick.ts)

import { Text } from '@mantine/core';

// TODO: build L3 using recorder.ts
export function MicWidget() {
  return <Text c="dimmed">MicWidget (not built yet)</Text>;
}
