// The class whiteboard: a large floating window over the slide show (Electron opens #/canvas).
// It appears when Flick draws for the class and hides when the drawing is put away.
// Preview without the backend: #/canvas?demo=1 (diagram) or ?demo=2 (story).
import { ActionIcon, Box, Group, Text } from '@mantine/core';
import { IconX } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { Whiteboard } from '../../components/whiteboard/Whiteboard';
import { SAMPLE_DIAGRAM, SAMPLE_STORY } from '../../components/whiteboard/samples';
import { desktop } from '../../desktop';
import { useCanvas } from '../../hooks/useCanvas';
import { LogoMark } from '../../layout/Logo';
import { colors } from '../../theme';
import { useTransparentWindow } from '../useTransparentWindow';

function demoNumber(): number {
  const query = window.location.hash.split('?')[1] ?? window.location.search.slice(1);
  return Number(new URLSearchParams(query).get('demo') ?? 0);
}

export function CanvasWindow() {
  useTransparentWindow();
  const { canvas, close, setCanvas } = useCanvas('class');

  // Preview mode: play a sample drawing step by step.
  const [demo] = useState(demoNumber);
  useEffect(() => {
    if (!demo) return;
    const drawing = demo === 2 ? SAMPLE_STORY : SAMPLE_DIAGRAM;
    setCanvas({ id: 'demo', drawing, slide: null, step: 0, say: null });
    const timers = drawing.steps.map((s, i) =>
      window.setTimeout(() => setCanvas((c) => (c ? { ...c, step: i + 1, say: s.say } : c)), 600 + i * 2200),
    );
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [demo, setCanvas]);

  useEffect(() => {
    if (canvas) desktop?.showCanvas();
    else desktop?.hideCanvas();
  }, [canvas]);

  if (!canvas) return null;

  return (
    <Box h="100vh" p={10}>
      <Box
        h="100%"
        style={{
          display: 'flex',
          flexDirection: 'column',
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 18,
          boxShadow: '0 18px 50px rgba(42,36,64,0.22)',
          overflow: 'hidden',
        }}
      >
        <Group px={16} py={10} gap={10} style={{ background: colors.soft, borderBottom: `1px solid ${colors.border}` }}>
          <LogoMark size={22} />
          <Text fw={800} fz={14} c={colors.ink}>
            Flick's whiteboard
          </Text>
          {canvas.slide && (
            <Text fz={12.5} c={colors.muted}>
              · slide {canvas.slide}
            </Text>
          )}
          <Box style={{ flex: 1 }} />
          <ActionIcon variant="subtle" color="gray" aria-label="Close the whiteboard" onClick={close}>
            <IconX size={16} />
          </ActionIcon>
        </Group>
        <Box style={{ flex: 1, minHeight: 0, display: 'grid', placeItems: 'center' }} p={12}>
          <Whiteboard drawing={canvas.drawing} step={canvas.step} style={{ maxHeight: '100%', width: 'auto', maxWidth: '100%' }} />
        </Box>
        {canvas.say && (
          <Text fz={17} lh={1.45} c={colors.ink} ta="center" px={24} pb={16}>
            {canvas.say}
          </Text>
        )}
      </Box>
    </Box>
  );
}
