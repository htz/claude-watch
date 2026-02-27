import { contextBridge, ipcRenderer } from 'electron';
import type { ClaudeWatchAPI, NotificationPopupData, PopupData } from '../shared/types';

const api: ClaudeWatchAPI = {
  onPermission: (callback: (data: PopupData) => void) => {
    ipcRenderer.removeAllListeners('permission-request');
    ipcRenderer.on('permission-request', (_event, data: PopupData) => {
      callback(data);
    });
  },

  onNotification: (callback: (data: NotificationPopupData) => void) => {
    ipcRenderer.removeAllListeners('notification');
    ipcRenderer.on('notification', (_event, data: NotificationPopupData) => {
      callback(data);
    });
  },

  onQueueUpdate: (callback: (count: number) => void) => {
    ipcRenderer.removeAllListeners('queue-update');
    ipcRenderer.on('queue-update', (_event, count: number) => {
      callback(count);
    });
  },

  respond: (id: string, decision: 'allow' | 'deny' | 'skip') => {
    ipcRenderer.send('permission-response', { id, decision });
  },

  dismissNotification: () => {
    ipcRenderer.send('dismiss-notification');
  },
};

contextBridge.exposeInMainWorld('claudeWatchAPI', api);
