import { Tray, Menu, nativeImage, app } from 'electron';
import path from 'path';

// Base64 埋め込みフォールバックアイコン (16x16 @1x)
const FALLBACK_ICON_1X =
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAAsTAAALEwEAmpwYAAABcklEQVR4nIXTS4jOYRQG8N9/hjK5lFHKwobIJWWIWE22VorZWFlhgR02srEyi1lIskCysrQxi5kUlkoWijLkLrJwW1gYQ4fnq39fn89Rb51z3vec85zL2+iNgZwm+i/M5fTFAAb73Dfd901LroufkVdhFzbnzTPcxf3ut00M8zCL9TiDjXiMt/iO1ViDTxjHzbCd6zgXjuAdjmMxTse+vZVkDK9wpcXkDw7hZTIvxAiuYj8OYh8u/H1qSRhci24DvmFt9KU4i/O4jpOpfQcWdJzwAodLuIUTMc7HJuzEKXzMCKdwALtDu3q3De+rEcvwpRV5NvU+xefYPmBF6FdAuRtqkvF2KM7EeS9WRt6Cr7gcRhW48AQTxeBh6E6nicXgAZ7jNS7hDYbjXBOaxD1cbI/xaMZ4DMtjq4CLIg9hDx5lQoXBXot0LvVW1lqmYln6OvzIot3oLFK/VR7F1jStyrnTa5W70fmF/fDPz9Qr0H+/829cs1LJFdT+zwAAAABJRU5ErkJggg==';

// Base64 埋め込みフォールバックアイコン (32x32 @2x)
const FALLBACK_ICON_2X =
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAACXBIWXMAABYlAAAWJQFJUiTwAAABt0lEQVR4nO3Wv49PQRQF8M9b60coiIjdYgtEoVCJSIRIJLaV7UShQEmh0BGJXiMh8U+IRiFZCpVCKGw2GlGIgiAKEhqeTHKL5+13vt+ZL9u9k7xk3n33nHPnzszLNNYPbWfc5JKaKcQm8WtyjSsgJ5RDk+GMnWRTaF6aV2WeQ9t5RmEz5sdwajv3F0YJLEZsR7yfwe3MDKsLmOmR+0gGy/iImxHbh0cxvoOXI3hTdaHtEc/hC7ZiIb7N4gZ243jEDk/QqTJve925HLEjuI8ruIQLEb9eqFVcwCjswjO8xTe8idyn2IhtOIi5Dqe4gKZD6L7vwV58xQdsx0as4gKeZ/SymM3Ek/HOmN1+fI+NmMx/Bu9TxJajK5/9A9oJv9DzcfTedXKvxYm4ihWcLtRbI55rWRqfwi1cxKHoQFqaJbzCPTyxFsVLMJMhJmzBsTD+1Wn3Q5yNDfkjTkbXaOo/YZshL8QGE0uRikp4HcXNFeoUF9D24kexKcaPcSDG6WScKNSoLiKHxViaHKrNm4zIuO/+E2dd7gNNjfkkwjQ3omo0hXlV97wBAwYMGKACfwDEnHrkJKaLrAAAAABJRU5ErkJggg==';

const TRAY_RETRY_DELAY_MS = 1500;
const TRAY_MAX_RETRIES = 3;

interface TrayCreateOptions {
  onQuit: () => void;
  onToggleLaunchAtLogin: (enabled: boolean) => void;
  onClick?: () => void;
  launchAtLogin: boolean;
}

export class TrayManager {
  private tray: Tray | null = null;
  private createOptions: TrayCreateOptions | null = null;
  private retryCount = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  create(options: TrayCreateOptions): Tray {
    this.createOptions = options;

    this.setupTray();

    // Tray 作成後に表示確認 — bounds 幅が 0 なら macOS が描画していない可能性
    this.scheduleVisibilityCheck();

    return this.tray!;
  }

  /**
   * Tray インスタンスを作成し、メニューとイベントハンドラを設定する。
   * 初回作成・リトライ時の両方から呼ばれる。
   */
  private setupTray(useFallbackIcon = false): void {
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }

    const icon = useFallbackIcon ? this.createFallbackIcon() : this.loadIcon();
    this.tray = new Tray(icon);
    this.tray.setToolTip('Claude Watch');
    this.rebuildContextMenu(this.createOptions!.launchAtLogin);

    if (this.createOptions!.onClick) {
      this.tray.on('click', this.createOptions!.onClick);
    }
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
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
  }

  /**
   * アイコンを読み込む。ファイルから読めない場合は埋め込み base64 にフォールバック。
   */
  private loadIcon(): Electron.NativeImage {
    const iconPath = this.getIconPath();
    const icon = nativeImage.createFromPath(iconPath);

    if (!icon.isEmpty()) {
      console.log(`[tray] Icon loaded from ${iconPath}`);
      icon.setTemplateImage(true);
      return icon;
    }

    console.warn(`[tray] Icon empty from path: ${iconPath}, using embedded fallback`);
    return this.createFallbackIcon();
  }

  /**
   * Base64 埋め込みアイコンからテンプレート画像を生成
   */
  private createFallbackIcon(): Electron.NativeImage {
    const img1x = nativeImage.createFromBuffer(Buffer.from(FALLBACK_ICON_1X, 'base64'), { scaleFactor: 1.0 });
    const img2x = nativeImage.createFromBuffer(Buffer.from(FALLBACK_ICON_2X, 'base64'), { scaleFactor: 2.0 });
    // 2x をベースに 1x の表現も追加
    img2x.addRepresentation({ scaleFactor: 1.0, buffer: img1x.toPNG() });
    img2x.setTemplateImage(true);
    return img2x;
  }

  /**
   * Tray 作成後に macOS が実際に描画しているか確認し、
   * bounds 幅が 0 の場合はリトライする。
   */
  private scheduleVisibilityCheck(): void {
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (!this.tray || !this.createOptions) return;

      const bounds = this.tray.getBounds();
      if (bounds.width > 0 && bounds.height > 0) {
        console.log('[tray] Tray visible:', bounds);
        this.retryCount = 0;
        return;
      }

      if (this.retryCount >= TRAY_MAX_RETRIES) {
        console.warn(`[tray] Tray still not visible after ${TRAY_MAX_RETRIES} retries`);
        this.retryCount = 0;
        return;
      }

      this.retryCount++;
      console.warn(`[tray] Tray not visible (bounds=${JSON.stringify(bounds)}), retry ${this.retryCount}/${TRAY_MAX_RETRIES}`);

      // 既存の Tray を破棄して再作成（フォールバックアイコンを使用）
      this.setupTray(true);
      this.scheduleVisibilityCheck();
    }, TRAY_RETRY_DELAY_MS);
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
