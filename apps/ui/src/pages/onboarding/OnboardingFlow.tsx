// Issue #3 · Design screens: O1–O4 Onboarding
//
// Shown on first run (no API key). Steps: Welcome → Microphone → Claude API key → Ready.
import { Box, Button, Center, Group, Stack } from '@mantine/core';
import { useState } from 'react';
import { Logo } from '../../layout/Logo';
import { colors } from '../../theme';
import { AllSetStep } from './AllSetStep';
import { ApiKeyStep } from './ApiKeyStep';
import { MicTestStep } from './MicTestStep';
import { WelcomeStep } from './WelcomeStep';

export interface StepProps {
  /** Go to the next step. */
  onNext: () => void;
}

const STEPS = 4;

export function OnboardingFlow() {
  const [step, setStep] = useState(1);
  const next = () => setStep((s) => Math.min(STEPS, s + 1));

  return (
    <Center mih="100vh" style={{ background: colors.background }}>
      <Stack w={600} mih={700} px={44} py={36} gap={0} justify="space-between">
        <Group justify="space-between">
          <Logo size={30} />
          <Group gap={6} aria-label={`Step ${step} of ${STEPS}`} role="img">
            {Array.from({ length: STEPS }, (_, i) => (
              <Box
                key={i}
                h={8}
                w={i + 1 === step ? 26 : 8}
                style={{
                  borderRadius: 4,
                  background: i + 1 <= step ? colors.aqua : '#e3dff0',
                  transition: 'width 200ms ease',
                }}
              />
            ))}
          </Group>
        </Group>

        <Box py={28}>
          {step === 1 && <WelcomeStep onNext={next} />}
          {step === 2 && <MicTestStep onNext={next} />}
          {step === 3 && <ApiKeyStep onNext={next} />}
          {step === 4 && <AllSetStep />}
        </Box>

        <Group justify="flex-start" h={44}>
          {step > 1 && (
            <Button variant="default" size="md" onClick={() => setStep(step - 1)}>
              Back
            </Button>
          )}
        </Group>
      </Stack>
    </Center>
  );
}

/** The main button of a step, bottom right of its content. */
export function StepButton(props: React.ComponentProps<typeof Button<'button'>>) {
  return (
    <Group justify="flex-end" mt={28}>
      <Button size="md" miw={180} {...props} />
    </Group>
  );
}
