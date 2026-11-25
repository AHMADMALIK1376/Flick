// "Present for me": live presenting state + the controls. Used by the Presentation page,
// the answer card and the presenter view.
import { notifications } from '@mantine/notifications';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/flick';
import type { Board, PresentStatus } from '../api/types';
import { useFlickEvent } from './useEvents';

const IDLE: PresentStatus = {
  state: 'idle',
  slide: null,
  total: 0,
  line: null,
  paused_for: null,
  message: null,
  deck: null,
  deck_id: null,
  style: 'class',
  study: false,
};

export function usePresenter() {
  const [status, setStatus] = useState<PresentStatus>(IDLE);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .presentStatus()
      .then(setStatus)
      .catch(() => undefined);
  }, []);
  useFlickEvent('present', setStatus);

  const run = useCallback(async (action: () => Promise<PresentStatus>) => {
    setBusy(true);
    try {
      setStatus(await action());
    } catch (err) {
      notifications.show({ color: 'red', message: err instanceof Error ? err.message : 'Something went wrong.' });
    } finally {
      setBusy(false);
    }
  }, []);

  const active = status.state === 'starting' || status.state === 'presenting' || status.state === 'paused';

  return {
    status,
    active,
    busy,
    start: (fromSlide?: number, style?: string, board?: Board) => run(() => api.presentStart(fromSlide, style, board)),
    startStudy: (style: string, deckId?: string, fromSlide?: number, board?: Board) =>
      run(() => api.studyStart(style, deckId, fromSlide, board)),
    pause: () => run(api.presentPause),
    resume: () => run(api.presentResume),
    next: () => run(api.presentNext),
    previous: () => run(api.presentPrevious),
    stop: () => run(api.presentStop),
  };
}

export type Presenter = ReturnType<typeof usePresenter>;
