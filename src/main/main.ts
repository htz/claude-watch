import { app, BrowserWindow, ipcMain } from 'electron';
import { TrayManager } from './tray';
import { NotifierServer } from './server';
import type { PopupData, NotificationPopupData } from '../shared/types';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;
let trayManager: TrayManager;
let server: NotifierServer;
let notificationTimer: ReturnType<typeof setTimeout> | null = null;
let rendererReady = false;

// Buffer for messages that arrive before renderer is ready
let pendingPermission: PopupData | null = null;
let pendingNotification: NotificationPopupData | null = null;
let currentView: 'permission' | 'notification' | 'none' = 'none';
let nextShowPassive = false; // blur 後の再表示でフォーカスを奪わないフラグ

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
      sandbox: false,
    },
  });

  window.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);

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
        // 残りがあればフォーカスを奪わず即座に次を表示
        if (server?.getQueueLength() > 0) {
          nextShowPassive = true;
          server.reshowCurrentItem();
          return;
        }
      }
      hideWindow();
    }, 300);
  });

  return window;
}

/** ウィンドウを表示（パーミッション用: フォーカスを奪う） */
function showWindowActive(): void {
  if (!mainWindow) return;
  const { x, y } = trayManager.getPopupPosition(WINDOW_WIDTH, WINDOW_HEIGHT);
  mainWindow.setPosition(x, y, false);
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.show();
  mainWindow.focus();
}

/** ウィンドウを表示（通知用: フォーカスを奪わない） */
function showWindowPassive(): void {
  if (!mainWindow) return;
  const { x, y } = trayManager.getPopupPosition(WINDOW_WIDTH, WINDOW_HEIGHT);
  mainWindow.setPosition(x, y, false);
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.showInactive();
}

function hideWindow(): void {
  if (!mainWindow) return;
  currentView = 'none';
  mainWindow.hide();
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
  if (nextShowPassive) {
    nextShowPassive = false;
    showWindowPassive();
  } else {
    showWindowActive();
  }
}

function showNotification(data: NotificationPopupData): void {
  if (!mainWindow) return;

  // If renderer is not ready yet, buffer the message
  if (!rendererReady) {
    pendingNotification = data;
    return;
  }

  // パーミッションがアクティブに表示中なら通知を割り込ませない
  if (server?.getQueueLength() > 0 && mainWindow?.isVisible()) return;

  currentView = 'notification';
  mainWindow.webContents.send('notification', data);
  showWindowPassive();

  // Auto-hide after delay
  if (notificationTimer) {
    clearTimeout(notificationTimer);
  }
  notificationTimer = setTimeout(() => {
    // Only hide if no permission requests are pending
    if (server.getQueueLength() === 0) {
      hideWindow();
    }
    notificationTimer = null;
  }, NOTIFICATION_AUTO_HIDE_MS);
}

app.whenReady().then(async () => {
  // Hide dock icon - menu bar only app
  app.dock?.hide();

  // Create tray
  trayManager = new TrayManager();
  trayManager.create(() => {
    server.stop();
    app.quit();
  });

  // Tray click: re-show queued permission popup if any
  const tray = trayManager.getTray();
  if (tray) {
    tray.on('click', () => {
      if (server?.getQueueLength() > 0) {
        server.reshowCurrentItem();
      }
    });
  }

  // Create window
  mainWindow = createWindow();

  // Start HTTP server
  server = new NotifierServer({
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
  ipcMain.on('permission-response', (_event, { id, decision }: { id: string; decision: 'allow' | 'deny' | 'skip' }) => {
    server.respondToPermission(id, decision);

    // Show next item or hide window
    if (server.getQueueLength() > 0) {
      server.reshowCurrentItem();
    } else {
      hideWindow();
    }
  });

  ipcMain.on('dismiss-notification', () => {
    if (notificationTimer) {
      clearTimeout(notificationTimer);
      notificationTimer = null;
    }
    hideWindow();
  });
});

app.on('window-all-closed', () => {
  // Don't quit when windows are closed - we're a tray app
});

app.on('before-quit', () => {
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
