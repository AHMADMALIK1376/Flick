// Previous · Pause/Resume · Next · Stop, for "Present for me".
import { ActionIcon, Group, Tooltip } from '@mantine/core';
import {
  IconPlayerPause,
  IconPlayerPlay,
  IconPlayerSkipBack,
  IconPlayerSkipForward,
  IconPlayerStop,
} from '@tabler/icons-react';
import type { Presenter } from '../hooks/usePresenter';
import { colors } from '../theme';

export function PresentControls({ presenter, size = 'lg' }: { presenter: Presenter; size?: 'md' | 'lg' | 'xl' }) {
  const { status, busy } = presenter;
  const paused = status.state === 'paused';
  const icon = size === 'xl' ? 22 : size === 'lg' ? 19 : 16;
  const button = (label: string, onClick: () => void, child: React.ReactNode, primary = false, disabled = false) => (
    <Tooltip label={label} withArrow>
      <ActionIcon
        size={size}
        radius="xl"
        variant={primary ? 'filled' : 'default'}
        color={primary ? 'aqua.3' : undefined}
        c={primary ? colors.ink : colors.ink}
        aria-label={label}
        onClick={onClick}
        disabled={busy || disabled}
      >
        {child}
      </ActionIcon>
    </Tooltip>
  );

  return (
    <Group gap={8} wrap="nowrap">
      {button('Previous slide', presenter.previous, <IconPlayerSkipBack size={icon} />, false, (status.slide ?? 1) <= 1)}
      {paused
        ? button('Continue', presenter.resume, <IconPlayerPlay size={icon} />, true)
        : button('Pause (raise hand)', presenter.pause, <IconPlayerPause size={icon} />, true)}
      {button('Next slide', presenter.next, <IconPlayerSkipForward size={icon} />, false, (status.slide ?? 0) >= status.total)}
      {button('Stop presenting', presenter.stop, <IconPlayerStop size={icon} />)}
    </Group>
  );
}

/** "Slide 3 of 12" + what Flick is doing now. */
export function presentLabel(status: Presenter['status']): string {
  const where = status.slide ? `Slide ${status.slide} of ${status.total}` : 'Getting ready';
  if (status.state === 'paused') {
    return status.paused_for === 'question' ? `${where} · Listening to a question` : `${where} · Paused`;
  }
  if (status.state === 'starting') return 'Starting the slide show…';
  return `${where} · Presenting`;
}
