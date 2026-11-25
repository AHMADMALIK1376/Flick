// The voice question box: "Listening…" → your words appear while you speak → when you stop,
// fix anything by typing, then ✓ asks Flick (Enter) and ✕ drops it (Esc). It closes by itself
// after 20 seconds if you leave it.
import { ActionIcon, Box, Group, Loader, Text, Textarea, Tooltip } from '@mantine/core';
import { IconCheck, IconX } from '@tabler/icons-react';
import { useEffect, useRef } from 'react';
import type { AskFlow } from './useAskFlow';
import { REVIEW_MS } from './useAskFlow';

const BARS = 12;

function Level({ level, active }: { level: number; active: boolean }) {
  return (
    <Box aria-hidden style={{ display: 'flex', alignItems: 'center', gap: 3, height: 18 }}>
      {Array.from({ length: BARS }, (_, i) => {
        const wave = active ? Math.max(0.15, level * (0.55 + 0.45 * Math.sin(i * 1.7 + Date.now() / 160))) : 0.12;
        return (
          <span
            key={i}
            style={{
              width: 3,
              height: `${Math.round(4 + wave * 14)}px`,
              borderRadius: 2,
              background: active ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.35)',
              transition: 'height 90ms linear',
            }}
          />
        );
      })}
    </Box>
  );
}

export function AskPanel({ flow, autoFocus = true }: { flow: AskFlow; autoFocus?: boolean }) {
  const { phase, text, edit, touch, send, cancel, speaking, level, closesIn } = flow;
  const box = useRef<HTMLTextAreaElement>(null);
  const reviewing = phase === 'review';

  useEffect(() => {
    if (reviewing && autoFocus) {
      const el = box.current;
      el?.focus();
      el?.setSelectionRange(el.value.length, el.value.length);
    }
  }, [reviewing, autoFocus]);

  if (phase !== 'listening' && phase !== 'writing' && phase !== 'review' && phase !== 'answering') return null;

  const status =
    phase === 'listening'
      ? speaking || text
        ? 'Writing…'
        : 'Listening…'
      : phase === 'writing'
        ? 'Writing…'
        : phase === 'answering'
          ? 'Asking Flick…'
          : `Press ✓ to ask · closes in ${Math.ceil(closesIn / 1000)}s`;

  return (
    <Box
      role="dialog"
      aria-label="Your question"
      style={{
        background: 'rgba(52,52,58,0.96)',
        borderRadius: 22,
        padding: '14px 16px 12px',
        boxShadow: '0 14px 40px rgba(0,0,0,0.35)',
        color: '#fff',
        width: '100%',
      }}
    >
      {reviewing ? (
        <Textarea
          ref={box}
          value={text}
          onChange={(e) => edit(e.currentTarget.value)}
          onFocus={touch}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            } else if (e.key === 'Escape') cancel();
          }}
          autosize
          minRows={1}
          maxRows={4}
          variant="unstyled"
          aria-label="Your question (you can edit it)"
          styles={{ input: { color: '#fff', fontSize: 17, fontStyle: 'italic', fontWeight: 600, lineHeight: 1.45, padding: 0 } }}
        />
      ) : (
        <Text
          fz={17}
          fs="italic"
          fw={600}
          lh={1.45}
          c={text ? '#fff' : 'rgba(255,255,255,0.55)'}
          style={{ minHeight: 25, maxHeight: 100, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical' }}
          aria-live="polite"
        >
          {text || (phase === 'listening' ? 'Speak now…' : '')}
        </Text>
      )}

      <Group gap={10} mt={10} wrap="nowrap">
        <Text fz={12} c="rgba(255,255,255,0.7)" style={{ flex: 1 }} role="status">
          {status}
        </Text>
        {phase === 'listening' && <Level level={level} active={speaking} />}
        {(phase === 'writing' || phase === 'answering') && <Loader size={16} color="white" />}
        {reviewing && (
          <Box
            aria-hidden
            style={{ width: 54, height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.2)', overflow: 'hidden' }}
          >
            <Box style={{ width: `${(closesIn / REVIEW_MS) * 100}%`, height: '100%', background: '#fff', transition: 'width 250ms linear' }} />
          </Box>
        )}
        <Tooltip label="Drop it (Esc)">
          <ActionIcon size={34} radius="md" variant="filled" color="dark.4" aria-label="Cancel the question" onClick={cancel}>
            <IconX size={18} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label={phase === 'listening' ? 'Done speaking' : 'Ask Flick (Enter)'}>
          <ActionIcon
            size={34}
            radius="md"
            variant="filled"
            color="dark.4"
            aria-label={phase === 'listening' ? 'Done speaking' : 'Ask Flick'}
            disabled={phase === 'writing' || phase === 'answering' || (reviewing && !text.trim())}
            onClick={phase === 'listening' ? flow.toggle : () => void send()}
          >
            <IconCheck size={18} />
          </ActionIcon>
        </Tooltip>
      </Group>
    </Box>
  );
}
