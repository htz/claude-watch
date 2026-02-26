import { Tray, Menu, nativeImage, app } from 'electron';
import path from 'path';

interface TrayCreateOptions {
  onQuit: () => void;
  onToggleLaunchAtLogin: (enabled: boolean) => void;
  launchAtLogin: boolean;
}

export class TrayManager {
  private tray: Tray | null = null;
  private createOptions: TrayCreateOptions | null = null;

  create(options: TrayCreateOptions): Tray {
    this.createOptions = options;

    // Use template image for auto light/dark mode support
    const iconPath = this.getIconPath();
    const icon = nativeImage.createFromPath(iconPath);
    // Mark as template image for macOS menu bar
    icon.setTemplateImage(true);

    this.tray = new Tray(icon);
    this.tray.setToolTip('Claude Watch');

    this.rebuildContextMenu(options.launchAtLogin);
    return this.tray;
  }

  updateLaunchAtLoginState(checked: boolean): void {
    this.rebuildContextMenu(checked);
  }

  private rebuildContextMenu(launchAtLogin: boolean): void {
    if (!this.tray || !this.createOptions) return;

    const { onQuit, onToggleLaunchAtLogin } = this.createOptions;
    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Claude Watch',
        enabled: false,
      },
      { type: 'separator' },
      {
        label: 'ログイン時に起動',
        type: 'checkbox',
        checked: launchAtLogin,
        click: (menuItem) => onToggleLaunchAtLogin(menuItem.checked),
      },
      { type: 'separator' },
      {
        label: '終了',
        click: onQuit,
      },
    ]);

    this.tray.setContextMenu(contextMenu);
  }

  /**
   * Tray アイコンの位置に基づいてポップアップの表示位置を計算
   */
  getPopupPosition(windowWidth: number, windowHeight: number): { x: number; y: number } {
    if (!this.tray) {
      return { x: 0, y: 0 };
    }

    const trayBounds = this.tray.getBounds();

    // Tray アイコンの中心X座標から、ウィンドウ幅の半分を引く
    const x = Math.round(trayBounds.x + trayBounds.width / 2 - windowWidth / 2);
    // Tray アイコンの下に配置
    const y = Math.round(trayBounds.y + trayBounds.height + 4);

    return { x, y };
  }

  getTray(): Tray | null {
    return this.tray;
  }

  destroy(): void {
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
  }

  private getIconPath(): string {
    if (app.isPackaged) {
      // Production: assets are in extraResource
      return path.join(process.resourcesPath, 'assets', 'IconTemplate.png');
    }
    // Development: try multiple candidate paths since __dirname varies with webpack
    const candidates = [
      path.join(__dirname, '..', '..', 'assets', 'IconTemplate.png'),
      path.join(process.cwd(), 'assets', 'IconTemplate.png'),
    ];
    const fs = require('fs');
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
    console.warn('[tray] Icon not found, tried:', candidates);
    return candidates[0];
  }
}
