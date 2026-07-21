import { Tray, Menu, nativeImage, MenuItemConstructorOptions } from 'electron';

export class TrayManager {
  private tray: Tray | null = null;
  private onDashboard: (() => void) | null = null;
  private onQuit: (() => void) | null = null;

  create(
    iconPath: string,
    callbacks: { onDashboard: () => void; onQuit: () => void },
  ): Tray {
    const icon = iconPath ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty();
    this.tray = new Tray(icon);
    this.tray.setToolTip('Voice to Text');

    this.onDashboard = callbacks.onDashboard;
    this.onQuit = callbacks.onQuit;

    // Double-click on tray icon opens the dashboard
    this.tray.on('double-click', () => {
      this.onDashboard?.();
    });

    this.updateMenu(false);
    return this.tray;
  }

  updateMenu(isRecording: boolean): void {
    if (!this.tray) return;

    const template: MenuItemConstructorOptions[] = [
      {
        label: 'Open Dashboard',
        click: () => this.onDashboard?.(),
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => this.onQuit?.(),
      },
    ];

    const contextMenu = Menu.buildFromTemplate(template);
    this.tray.setContextMenu(contextMenu);
  }

  destroy(): void {
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
  }
}
