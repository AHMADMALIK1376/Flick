// Issue #7 · Design screen: D6 Settings
//
// Form for all settings. Send only changed fields. Never show the full API key.
//
// Backend: GET /settings, PATCH /settings, GET /models   (functions in src/api/flick.ts)

import { Stack } from '@mantine/core';
import { PageHeader } from '../../components/PageHeader';
import { TodoPanel } from '../../components/TodoPanel';

export function SettingsPage() {
  return (
    <Stack>
      <PageHeader title='Settings' subtitle='Your Claude key, voice and hotkeys.' />
      <TodoPanel
        issue={7}
        items={[
          'Claude API key (masked) + Change',
          'Model (api.models())',
          'Answer mode: speak / private',
          'Ask + Explain hotkeys',
          'Speech model, language (English / Urdu)',
          'Show mic widget',
        ]}
      />
    </Stack>
  );
}
