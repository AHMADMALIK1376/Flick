// The whiteboard as big as the window: opens by itself when Flick starts drawing, so the
// drawing is easy to read. "Make smaller" puts it back in the page; Esc does the same.
import { ActionIcon, Box, Group, Text, Tooltip } from '@mantine/core';
import { IconMinimize, IconPlayerPause, IconPlayerPlay, IconPlayerStop } from '@tabler/icons-react';
import { useEffect } from 'react';
import type { Drawing } from '../../api/types';
import { LogoMark } from '../../layout/Logo';
import { colors } from '../../theme';
import { Whiteboard } from './Whiteboard';

export interface BoardOverlayProps {
  drawing: Drawing;
  step: number;
  say: string | null;
  slide: number | null;
  paused?: boolean;
  onMinimize: () => void;
  onPause?: () => void;
  onResume?: () => void;
  onStop?: () => void;
}

export function BoardOverlay({ drawing, step, say, slide, paused, onMinimize, onPause, onResume, onStop }: BoardOverlayProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onMinimize();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onMinimize]);

  return (
    <Box
      role="dialog"
      aria-label="Flick's whiteboard"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 300,
        display: 'flex',
        flexDirection: 'column',
        background: '#fffdf8',
        animation: 'wb-overlay-in 220ms ease-out',
      }}
    >
      <Group px={20} py={10} gap={10} style={{ background: colors.soft, borderBottom: `1px solid ${colors.border}` }}>
        <LogoMark size={22} />
        <Text fw={800} fz={15} c={colors.ink}>
          Flick's whiteboard
        </Text>
        {slide && (
          <Text fz={13} c={colors.muted}>
            · slide {slide}
          </Text>
        )}
        <Box style={{ flex: 1 }} />
        {paused
          ? onResume && (
              <Tooltip label="Carry on">
                <ActionIcon size="lg" variant="light" aria-label="Carry on" onClick={onResume}>
                  <IconPlayerPlay size={18} />
                </ActionIcon>
              </Tooltip>
            )
          : onPause && (
              <Tooltip label="Pause">
                <ActionIcon size="lg" variant="light" aria-label="Pause" onClick={onPause}>
                  <IconPlayerPause size={18} />
                </ActionIcon>
              </Tooltip>
            )}
        {onStop && (
          <Tooltip label="Stop">
            <ActionIcon size="lg" variant="light" color="red" aria-label="Stop" onClick={onStop}>
              <IconPlayerStop size={18} />
            </ActionIcon>
          </Tooltip>
        )}
        <Tooltip label="Make smaller (Esc)">
          <ActionIcon size="lg" variant="subtle" color="gray" aria-label="Make the whiteboard smaller" onClick={onMinimize}>
            <IconMinimize size={18} />
          </ActionIcon>
        </Tooltip>
      </Group>
      <Box style={{ flex: 1, minHeight: 0, position: 'relative' }} p={16}>
        <Whiteboard drawing={drawing} step={step} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', borderRadius: 0 }} />
      </Box>
      {say && (
        <Text fz={22} lh={1.4} fw={600} c={colors.ink} ta="center" px={32} pb={22} maw={1100} mx="auto">
          {say}
        </Text>
      )}
    </Box>
  );
}
