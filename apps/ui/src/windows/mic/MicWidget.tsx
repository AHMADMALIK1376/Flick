// Issue #9 · Design screen: L3 Mic / Tray / Icon
//
// Small round floating button (Electron opens #/mic). Click: ask by voice.
// While asking it becomes the question box (AskPanel): live words, edit, ✓ / ✕.
import { Box, Center, Text, UnstyledButton } from '@mantine/core';
import { IconCheck, IconMicrophone } from '@tabler/icons-react';
import { useEffect, useRef } from 'react';
import { desktop } from '../../desktop';
import { colors } from '../../theme';
import { useTransparentWindow } from '../useTransparentWindow';
import { AskPanel } from './AskPanel';
import { useAskFlow } from './useAskFlow';

const circle = {
  width: 48,
  height: 48,
  borderRadius: '50%',
  display: 'grid',
  placeItems: 'center',
  boxShadow: '0 8px 22px rgba(42,36,64,0.16)',
} as const;

export function MicWidget() {
  useTransparentWindow();
  const flow = useAskFlow();
  const { phase, note, toggle } = flow;
  const panel = phase === 'listening' || phase === 'writing' || phase === 'review' || phase === 'answering';

  // Desktop app: the Ask hotkey (Ctrl+Shift+Space) starts, stops, or sends.
  const toggleRef = useRef(toggle);
  toggleRef.current = toggle;
  useEffect(() => desktop?.onToggleAsk(() => toggleRef.current()), []);

  // The window grows into the question box, and can take typing only while it is one.
  useEffect(() => {
    desktop?.setMicMode?.(panel ? 'panel' : 'button');
  }, [panel]);

  if (panel) {
    return (
      <Box h="100vh" p={8} style={{ display: 'flex', alignItems: 'flex-end' }}>
        <AskPanel flow={flow} />
      </Box>
    );
  }

  return (
    <Center h="100vh" style={{ flexDirection: 'column', gap: 4 }}>
      {phase === 'idle' && (
        <UnstyledButton
          aria-label="Ask Flick"
          onClick={toggle}
          style={{ ...circle, background: colors.surface, border: `1px solid ${colors.border}` }}
        >
          <IconMicrophone size={22} color={colors.plum} />
        </UnstyledButton>
      )}

      {phase === 'done' && (
        <UnstyledButton aria-label="Ask Flick again" onClick={toggle} style={{ ...circle, background: colors.aquaButton }}>
          <IconCheck size={22} stroke={2.4} color={colors.ink} />
        </UnstyledButton>
      )}

      {note && (
        <Text fz={11} fw={600} c={colors.ink} px={8} py={2} style={{ background: colors.surface, borderRadius: 8 }}>
          {note}
        </Text>
      )}
    </Center>
  );
}
