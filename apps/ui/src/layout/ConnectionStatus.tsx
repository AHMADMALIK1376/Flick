// Small "Connected / Not running" chip at the bottom of the sidebar.
import { Badge } from '@mantine/core';
import { useEventsConnected } from '../hooks/useEvents';

export function ConnectionStatus() {
  const connected = useEventsConnected();
  // TODO(#2): also call api.status() and show a warning if the speech or
  // meaning model failed to load, or if no API key is saved.
  return (
    <Badge variant="light" color={connected ? 'aqua.8' : 'red'} radius="sm">
      {connected ? 'Connected' : 'Backend not running'}
    </Badge>
  );
}
