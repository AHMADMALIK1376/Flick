import { Menu, Tray, nativeImage } from 'electron';

export interface TrayActions {
  openDashboard: () => void;
  openPresenter: () => void;
  ask: () => void;
  explain: () => void;
  present: () => void;
  stopPresenting: () => void;
  quit: () => void;
}

export function createTray(iconPath: string, actions: TrayActions): Tray {
  const image = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  const tray = new Tray(image);
  tray.setToolTip('Flick');
  tray.on('double-click', actions.openDashboard);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Flick', click: actions.openDashboard },
      { label: 'Presenter view', click: actions.openPresenter },
      { type: 'separator' },
      { label: 'Ask a question', click: actions.ask },
      { label: 'Explain this slide', click: actions.explain },
      { type: 'separator' },
      { label: 'Present for me', click: actions.present },
      { label: 'Stop presenting', click: actions.stopPresenting },
      { type: 'separator' },
      { label: 'Quit Flick', click: actions.quit },
    ]),
  );
  return tray;
}
