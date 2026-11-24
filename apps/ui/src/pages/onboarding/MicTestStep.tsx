// Issue #3 · Design screen: O2 Microphone
//
// Ask for microphone permission and show a live level bar. Never blocks onboarding.
import { Box, Center, Group, Progress, Stack, Text } from '@mantine/core';
import { IconMicrophone, IconShieldCheck } from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';
import { colors } from '../../theme';
import { StepButton, type StepProps } from './OnboardingFlow';

type MicState = 'ask' | 'listening' | 'blocked';

export function MicTestStep({ onNext }: StepProps) {
  const [state, setState] = useState<MicState>('ask');
  const [level, setLevel] = useState(0);
  const cleanup = useRef<() => void>(() => undefined);

  useEffect(() => () => cleanup.current(), []);

  async function allow() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audio = new AudioContext();
      const analyser = audio.createAnalyser();
      analyser.fftSize = 512;
      audio.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      let frame = 0;
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let peak = 0;
        for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
        setLevel(Math.min(100, (peak / 64) * 100));
        frame = requestAnimationFrame(tick);
      };
      tick();
      cleanup.current = () => {
        cleanup.current = () => undefined; // run once
        cancelAnimationFrame(frame);
        stream.getTracks().forEach((t) => t.stop());
        void audio.close();
      };
      setState('listening');
    } catch {
      setState('blocked');
    }
  }

  return (
    <Stack gap={0} align="center">
      <Center
        w={104}
        h={104}
        style={{ borderRadius: '50%', background: colors.aquaButton, boxShadow: '0 0 0 14px #dff3f1' }}
      >
        <IconMicrophone size={44} color={colors.ink} />
      </Center>
      <Text fz={24} fw={800} c={colors.ink} mt={34}>
        Allow your microphone
      </Text>
      <Text fz={14.5} c={colors.muted} ta="center" maw={420} mt={8}>
        Flick listens only after you press the hotkey or click the mic.
      </Text>

      {state === 'listening' && (
        <Stack w="100%" maw={380} gap={6} mt={22}>
          <Progress value={level} size={10} radius="xl" color="aqua.6" bg="#e3dff0" transitionDuration={60} />
          <Text fz={13} c={colors.muted} ta="center">
            Say something. The bar should move.
          </Text>
        </Stack>
      )}
      {state === 'blocked' && (
        <Text fz={13.5} c="#9b2c2c" ta="center" mt={22}>
          Microphone blocked. You can allow it later in Windows settings.
        </Text>
      )}

      <Box mt={22} p="14px 16px" w="100%" style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 12 }}>
        <Group gap={12} wrap="nowrap" align="flex-start">
          <IconShieldCheck size={20} color={colors.plum} style={{ flexShrink: 0, marginTop: 1 }} />
          <Text fz={13.5} c={colors.muted}>
            <b style={{ color: colors.ink }}>Your voice stays on this computer.</b> Speech is turned into text here;
            only the question text is sent to the AI.
          </Text>
        </Group>
      </Box>

      <Box w="100%">
        {state === 'ask' ? (
          <StepButton onClick={allow}>Allow microphone</StepButton>
        ) : (
          <StepButton
            onClick={() => {
              cleanup.current();
              onNext();
            }}
          >
            Continue
          </StepButton>
        )}
      </Box>
    </Stack>
  );
}
