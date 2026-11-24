// Bottom of the sidebar: is the backend running, and is anything missing?
import { Anchor, Badge, Group, Stack, Text } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/flick';
import type { Status } from '../api/types';
import { useEventsConnected } from '../hooks/useEvents';
import { colors } from '../theme';

const REFRESH_MS = 10_000;

export function ConnectionStatus() {
  const connected = useEventsConnected();
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    if (!connected) {
      setStatus(null);
      return;
    }
    let alive = true;
    const load = () =>
      api
        .status()
        .then((s) => alive && setStatus(s))
        .catch(() => alive && setStatus(null)); // the red badge already says the backend is down
    load();
    const timer = window.setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [connected]);

  return (
    <Stack gap={6}>
      <Badge variant="light" color={connected ? 'aqua.8' : 'red'} radius="sm" w="fit-content">
        {connected ? 'Connected' : 'Backend not running'}
      </Badge>
      {connected && status && <StatusNotes status={status} />}
    </Stack>
  );
}

function StatusNotes({ status }: { status: Status }) {
  const notes: ReactNode[] = [];
  if (!status.has_api_key) {
    notes.push(
      <Warning key="key">
        No Claude API key. Add it in{' '}
        <Anchor component={Link} to="/settings" fz={12} c={colors.plum} fw={600}>
          Settings
        </Anchor>
        .
      </Warning>,
    );
  }
  if (!status.speech_model.ready && status.speech_model.error) {
    notes.push(<Warning key="speech">Voice input is not available.</Warning>);
  }
  if (!status.meaning_model.ready && status.meaning_model.error) {
    notes.push(<Warning key="meaning">Smart matching is not available.</Warning>);
  }
  if (!status.voice.ready && status.voice.error) {
    notes.push(<Warning key="voice">Flick's voice is not available.</Warning>);
  }
  if (!status.powerpoint) {
    notes.push(<Warning key="ppt">PowerPoint link works only on Windows.</Warning>);
  }
  const loading =
    (!status.speech_model.ready && !status.speech_model.error) ||
    (!status.meaning_model.ready && !status.meaning_model.error) ||
    (!status.voice.ready && !status.voice.error);

  return (
    <Stack gap={4}>
      {notes}
      {loading && (
        <Text fz={12} c={colors.muted}>
          {status.voice.downloading ? "Downloading Flick's voice…" : 'Loading speech models…'}
        </Text>
      )}
    </Stack>
  );
}

function Warning({ children }: { children: ReactNode }) {
  return (
    <Group gap={6} wrap="nowrap" align="flex-start">
      <IconAlertTriangle size={14} color="#8a4220" style={{ flexShrink: 0, marginTop: 2 }} />
      <Text fz={12} c="#8a4220" lh={1.35}>
        {children}
      </Text>
    </Group>
  );
}
