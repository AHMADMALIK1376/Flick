// Issue #3 · Design screen: O1 Welcome
import { Card, Center, Group, Stack, Text, ThemeIcon } from '@mantine/core';
import { IconBolt, IconMicrophone, IconPresentation } from '@tabler/icons-react';
import { Logo } from '../../layout/Logo';
import { colors } from '../../theme';
import { StepButton, type StepProps } from './OnboardingFlow';

const FEATURES = [
  { icon: IconPresentation, title: 'Load your slides', text: 'Flick reads them and prepares likely questions.' },
  { icon: IconMicrophone, title: 'Ask by voice', text: 'Press Ctrl+Shift+Space and say “Flick, …”' },
  { icon: IconBolt, title: 'Answer in seconds', text: 'From your slides first, the web when needed.' },
];

export function WelcomeStep({ onNext }: StepProps) {
  return (
    <Stack gap={0}>
      <Center>
        <Logo size={72} />
      </Center>
      <Text fz={24} fw={800} ta="center" c={colors.ink} mt={22}>
        Your live Q&A assistant for presentations
      </Text>
      <Text fz={14.5} c={colors.muted} ta="center" maw={420} mx="auto" mt={8}>
        When someone asks a question you can’t answer, ask Flick. The answer appears in seconds.
      </Text>
      <Card mt={26} p={22}>
        <Stack gap={18}>
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <Group key={title} gap={14} wrap="nowrap">
              <ThemeIcon size={42} radius={10} variant="white" c={colors.plum} style={{ border: `1px solid ${colors.border}` }}>
                <Icon size={20} />
              </ThemeIcon>
              <Stack gap={2}>
                <Text fz={15} fw={700} c={colors.ink}>
                  {title}
                </Text>
                <Text fz={13.5} c={colors.muted}>
                  {text}
                </Text>
              </Stack>
            </Group>
          ))}
        </Stack>
      </Card>
      <StepButton onClick={onNext}>Get started</StepButton>
    </Stack>
  );
}
