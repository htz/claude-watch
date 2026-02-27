import { app, BrowserWindow, globalShortcut, ipcMain, session } from 'electron';
import { TrayManager } from './tray';
import { ClaudeWatchServer } from './server';
import type { PopupData, NotificationPopupData } from '../shared/types';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;
let trayManager: TrayManager;
let server: ClaudeWatchServer;
let notificationTimer: ReturnType<typeof setTimeout> | null = null;
let rendererReady = false;

// Buffer for messages that arrive before renderer is ready
let pendingPermission: PopupData | null = null;
let pendingNotification: NotificationPopupData | null = null;
let notificationQueue: NotificationPopupData[] = [];
let currentView: 'permission' | 'notification' | 'none' = 'none';

const WINDOW_WIDTH = 420;
const WINDOW_HEIGHT = 320;
const NOTIFICATION_AUTO_HIDE_MS = 5000;

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    closable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    visibleOnAllWorkspaces: true,
    hasShadow: true,
    roundedCorners: true,
    backgroundColor: '#00000000',
    vibrancy: 'popover',
    visualEffectState: 'active',
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);

  // ナビゲーション・ポップアップ制限
  window.webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });
  window.webContents.setWindowOpenHandler(() => {
    return { action: 'deny' };
  });

  window.webContents.on('did-finish-load', () => {
    rendererReady = true;

    // Flush any buffered messages
    if (pendingPermission) {
      const data = pendingPermission;
      pendingPermission = null;
      showPermission(data);
    }
    if (pendingNotification) {
      const data = pendingNotification;
      pendingNotification = null;
      showNotification(data);
    }
  });

  window.webContents.on('did-fail-load', () => {
    rendererReady = false;
  });

  // Hide on blur - only act when permission view is active
  window.on('blur', () => {
    setTimeout(() => {
      if (!mainWindow || mainWindow.isFocused()) return;
      if (currentView !== 'permission') return;

      if (server?.getQueueLength() > 0) {
        const currentId = getCurrentPermissionId();
        if (currentId) {
          server.respondToPermission(currentId, 'skip');
        }
        // 残りがあれば即座に次を表示
        if (server?.getQueueLength() > 0) {
          server.reshowCurrentItem();
          return;
        }
      }
      hideWindow();
    }, 300);
  });

  return window;
}

/** グローバルショートカットを登録（ポップアップ表示中のみ有効） */
function registerGlobalShortcuts(): void {
  // 許可 (パーミッションビュー) / 閉じる (通知ビュー)
  globalShortcut.register('CommandOrControl+Return', () => {
    if (currentView === 'permission') {
      const currentId = getCurrentPermissionId();
      if (currentId) {
        server.respondToPermission(currentId, 'allow');
        if (server.getQueueLength() > 0) {
          server.reshowCurrentItem();
        } else {
          showNextNotificationOrHide();
        }
      }
    } else if (currentView === 'notification') {
      if (notificationTimer) {
        clearTimeout(notificationTimer);
        notificationTimer = null;
      }
      showNextNotificationOrHide();
    }
  });

  // 拒否 (パーミッションビューのみ)
  globalShortcut.register('Escape', () => {
    if (currentView === 'permission') {
      const currentId = getCurrentPermissionId();
      if (currentId) {
        server.respondToPermission(currentId, 'deny');
        if (server.getQueueLength() > 0) {
          server.reshowCurrentItem();
        } else {
          showNextNotificationOrHide();
        }
      }
    } else if (currentView === 'notification') {
      if (notificationTimer) {
        clearTimeout(notificationTimer);
        notificationTimer = null;
      }
      showNextNotificationOrHide();
    }
  });
}

function unregisterGlobalShortcuts(): void {
  globalShortcut.unregister('CommandOrControl+Return');
  globalShortcut.unregister('Escape');
}

/** ウィンドウを表示（フォーカスを奪わない） */
function showWindowPassive(): void {
  if (!mainWindow) return;
  const { x, y } = trayManager.getPopupPosition(WINDOW_WIDTH, WINDOW_HEIGHT);
  mainWindow.setPosition(x, y, false);
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.showInactive();
  registerGlobalShortcuts();
}

function hideWindow(): void {
  if (!mainWindow) return;
  currentView = 'none';
  mainWindow.hide();
  unregisterGlobalShortcuts();
}

function getCurrentPermissionId(): string | null {
  return server?.getCurrentPermissionId() ?? null;
}

function showPermission(data: PopupData): void {
  if (!mainWindow) return;

  // If renderer is not ready yet, buffer the message
  if (!rendererReady) {
    pendingPermission = data;
    return;
  }

  // Clear any notification timer
  if (notificationTimer) {
    clearTimeout(notificationTimer);
    notificationTimer = null;
  }

  currentView = 'permission';
  mainWindow.webContents.send('permission-request', data);
  showWindowPassive();
}

function showNotification(data: NotificationPopupData): void {
  if (!mainWindow) return;

  // If renderer is not ready yet, buffer the message
  if (!rendererReady) {
    pendingNotification = data;
    return;
  }

  // パーミッションがアクティブに表示中なら通知をキューに入れる
  if (server?.getQueueLength() > 0 && mainWindow?.isVisible()) {
    notificationQueue.push(data);
    return;
  }

  // 通知が表示中ならキューに入れて順番待ち
  if (currentView === 'notification' && mainWindow?.isVisible()) {
    notificationQueue.push(data);
    mainWindow.webContents.send('queue-update', notificationQueue.length + (server?.getQueueLength() ?? 0));
    return;
  }

  displayNotification(data);
}

/** 通知を実際に表示する（内部用） */
function displayNotification(data: NotificationPopupData): void {
  if (!mainWindow) return;

  // 表示時点のキュー件数を反映（通知キュー + パーミッションキュー）
  data.queueCount = notificationQueue.length + (server?.getQueueLength() ?? 0);

  currentView = 'notification';
  mainWindow.webContents.send('notification', data);
  showWindowPassive();

  // Clear any existing timer
  if (notificationTimer) {
    clearTimeout(notificationTimer);
    notificationTimer = null;
  }

  // question タイプはユーザーが dismiss するまで表示し続ける
  if (data.type === 'question') return;

  // Auto-hide after delay
  notificationTimer = setTimeout(() => {
    notificationTimer = null;
    showNextNotificationOrHide();
  }, NOTIFICATION_AUTO_HIDE_MS);
}

/** キューに次の通知があれば表示、なければウィンドウを隠す */
function showNextNotificationOrHide(): void {
  // パーミッションが待機中ならそちらを優先
  if (server?.getQueueLength() > 0) {
    server.reshowCurrentItem();
    return;
  }

  // 通知キューに残りがあれば次を表示
  if (notificationQueue.length > 0) {
    const next = notificationQueue.shift()!;
    displayNotification(next);
    return;
  }

  hideWindow();
}

app.whenReady().then(async () => {
  // Content Security Policy（開発時は webpack dev server 用に緩和）
  const csp = app.isPackaged
    ? "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'"
    : "default-src 'none'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self' ws:";
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
      },
    });
  });

  // Hide dock icon - menu bar only app
  app.dock?.hide();

  // Create tray
  trayManager = new TrayManager();
  const launchAtLogin = app.getLoginItemSettings().openAtLogin;
  trayManager.create({
    onQuit: () => {
      server.stop();
      app.quit();
    },
    onToggleLaunchAtLogin: (enabled: boolean) => {
      app.setLoginItemSettings({ openAtLogin: enabled });
    },
    onClick: () => {
      if (server?.getQueueLength() > 0) {
        server.reshowCurrentItem();
      }
    },
    launchAtLogin,
  });

  // Create window
  mainWindow = createWindow();

  // Start HTTP server
  server = new ClaudeWatchServer({
    onPermissionRequest: showPermission,
    onNotification: showNotification,
  });

  try {
    await server.start();
  } catch (err) {
    console.error('Failed to start server:', err);
    app.quit();
    return;
  }

  // IPC handlers
  ipcMain.on('permission-response', (_event, payload: unknown) => {
    // ランタイム検証
    if (typeof payload !== 'object' || payload === null) return;
    const { id, decision } = payload as Record<string, unknown>;
    if (typeof id !== 'string') return;
    if (!['allow', 'deny', 'skip'].includes(decision as string)) return;

    server.respondToPermission(id, decision as 'allow' | 'deny' | 'skip');

    // Show next permission, queued notification, or hide
    if (server.getQueueLength() > 0) {
      server.reshowCurrentItem();
    } else {
      showNextNotificationOrHide();
    }
  });

  ipcMain.on('dismiss-notification', () => {
    if (notificationTimer) {
      clearTimeout(notificationTimer);
      notificationTimer = null;
    }
    showNextNotificationOrHide();
  });
});

app.on('window-all-closed', () => {
  // Don't quit when windows are closed - we're a tray app
});

app.on('before-quit', () => {
  globalShortcut.unregisterAll();
  if (server) {
    server.stop();
  }
  if (trayManager) {
    trayManager.destroy();
  }
});

// Webpack entry point declarations
declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;
