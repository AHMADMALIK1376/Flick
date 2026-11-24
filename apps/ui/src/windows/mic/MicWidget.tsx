// Issue #9 · Design screen: L3 Mic / Tray / Icon
//
// Small round floating button (Electron opens #/mic). Click: start / stop recording.
// States: idle, listening, answering, done.
import { Box, Center, Loader, Text, UnstyledButton } from '@mantine/core';
import { IconCheck, IconMicrophone } from '@tabler/icons-react';
import { useEffect, useRef } from 'react';
import { desktop } from '../../desktop';
import { colors } from '../../theme';
import { useTransparentWindow } from '../useTransparentWindow';
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
  const { phase, note, toggle } = useAskFlow();

  // Desktop app: the Ask hotkey (Ctrl+Shift+Space) starts / stops recording here.
  const toggleRef = useRef(toggle);
  toggleRef.current = toggle;
  useEffect(() => desktop?.onToggleAsk(() => toggleRef.current()), []);

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

      {phase === 'listening' && (
        <UnstyledButton
          aria-label="Stop and ask"
          role="status"
          onClick={toggle}
          style={{
            width: 150,
            height: 48,
            borderRadius: 999,
            background: colors.ink,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            boxShadow: circle.boxShadow,
          }}
        >
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#f28b82' }} />
          <Box style={{ display: 'flex', alignItems: 'center', gap: 4, height: 22 }}>
            {[0, 0.15, 0.3, 0.45, 0.6].map((delay) => (
              <span key={delay} className="flick-bar" style={{ animationDelay: `${delay}s` }} />
            ))}
          </Box>
        </UnstyledButton>
      )}

      {phase === 'answering' && (
        <Box role="status" aria-label="Answering" style={{ ...circle, background: colors.surface, border: `1px solid ${colors.border}` }}>
          <Loader size={22} color="aqua.6" />
        </Box>
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
