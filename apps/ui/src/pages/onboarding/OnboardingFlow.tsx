// Issue #3 · Design screen: O1–O4 Onboarding
//
// Shown on first run (no API key). Steps: Welcome → API key → Mic test → All set.
// Tip: use Mantine <Stepper> or just a step number in useState.
//
// Backend: GET /settings, PATCH /settings   (functions in src/api/flick.ts)

import { Center, Stack } from '@mantine/core';
import { Logo } from '../../layout/Logo';
import { TodoPanel } from '../../components/TodoPanel';

export function OnboardingFlow() {
  return (
    <Center mih="100vh">
      <Stack align="center" w={480}>
        <Logo size={40} />
        <TodoPanel
          issue={3}
          items={[
            'Step 1 WelcomeStep.tsx',
            'Step 2 ApiKeyStep.tsx: save key with api.updateSettings({ anthropic_api_key })',
            'Step 3 MicTestStep.tsx',
            'Step 4 AllSetStep.tsx: show both hotkeys, then navigate("/presentation")',
          ]}
        />
      </Stack>
    </Center>
  );
}
