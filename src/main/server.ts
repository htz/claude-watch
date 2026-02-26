import http from 'http';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { analyzeToolDanger } from '../shared/danger-level';
import { describeToolAction } from '../shared/tool-classifier';
import { SOCKET_DIR, SOCKET_PATH } from '../shared/constants';
import type { PermissionRequest, PermissionResponse, NotificationRequest, QueueItem, PopupData, NotificationPopupData } from '../shared/types';

const PERMISSION_TIMEOUT = 5 * 60 * 1000; // 5 minutes
const MAX_BODY_SIZE = 1 * 1024 * 1024; // 1MB
const MAX_QUEUE_SIZE = 100;

function generateId(): string {
  return crypto.randomUUID();
}

export interface ServerCallbacks {
  onPermissionRequest: (data: PopupData) => void;
  onNotification: (data: NotificationPopupData) => void;
}

export class NotifierServer {
  private server: http.Server | null = null;
  private queue: QueueItem[] = [];
  private callbacks: ServerCallbacks;

  constructor(callbacks: ServerCallbacks) {
    this.callbacks = callbacks;
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Ensure socket directory exists with restrictive permissions
      fs.mkdirSync(SOCKET_DIR, { recursive: true, mode: 0o700 });
      fs.chmodSync(SOCKET_DIR, 0o700);

      // Clean up stale socket file from previous crash
      try { fs.unlinkSync(SOCKET_PATH); } catch {}

      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res);
      });

      this.server.on('error', (err: NodeJS.ErrnoException) => {
        reject(err);
      });

      this.server.listen(SOCKET_PATH, () => {
        // ソケットファイルを所有者のみアクセス可能に制限
        try { fs.chmodSync(SOCKET_PATH, 0o600); } catch {}
        console.log(`Notifier server listening on ${SOCKET_PATH}`);
        resolve();
      });
    });
  }

  stop(): void {
    // Deny all pending requests and clear timers
    for (const item of this.queue) {
      clearTimeout(item.timer);
      item.resolve({ decision: 'deny' });
    }
    this.queue = [];

    if (this.server) {
      this.server.close();
      this.server = null;
    }

    // Clean up socket file
    try { fs.unlinkSync(SOCKET_PATH); } catch {}
  }

  /** ユーザーがポップアップで応答した。次の表示は呼び出し側に委ねる */
  respondToPermission(id: string, decision: 'allow' | 'deny' | 'skip'): void {
    const index = this.queue.findIndex(item => item.id === id);
    if (index === -1) return;

    const item = this.queue[index];
    clearTimeout(item.timer);
    item.resolve({ decision });
    this.queue.splice(index, 1);
  }

  getQueueLength(): number {
    return this.queue.length;
  }

  /** 現在表示中（キュー先頭）のパーミッションリクエストIDを返す */
  getCurrentPermissionId(): string | null {
    return this.queue.length > 0 ? this.queue[0].id : null;
  }

  /** キューの先頭アイテムを再表示する */
  reshowCurrentItem(): void {
    this.showCurrentItem();
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    // CORS headers for local requests
    res.setHeader('Content-Type', 'application/json');

    const url = (req.url || '').split('?')[0].replace(/\/+$/, '') || '/';

    if (req.method === 'GET' && url === '/health') {
      res.writeHead(200);
      res.end(JSON.stringify({ status: 'ok', queue: this.queue.length }));
      return;
    }

    if (req.method !== 'POST') {
      res.writeHead(405);
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }

    let body = '';
    let aborted = false;
    req.on('data', chunk => {
      body += chunk;
      if (body.length > MAX_BODY_SIZE) {
        aborted = true;
        res.writeHead(413);
        res.end(JSON.stringify({ error: 'Payload too large' }));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (aborted) return;
      try {
        const data = JSON.parse(body);

        if (url === '/permission') {
          if (!this.validatePermissionRequest(data)) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'Invalid permission request' }));
            return;
          }
          this.handlePermission(data, res);
        } else if (url === '/notification') {
          if (!this.validateNotificationRequest(data)) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: 'Invalid notification request' }));
            return;
          }
          this.handleNotification(data, res);
        } else {
          res.writeHead(404);
          res.end(JSON.stringify({ error: 'Not found' }));
        }
      } catch (err) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
  }

  private validatePermissionRequest(data: unknown): data is PermissionRequest {
    if (typeof data !== 'object' || data === null) return false;
    const obj = data as Record<string, unknown>;
    if (typeof obj.tool_name !== 'string') return false;
    if (obj.tool_input !== undefined && (typeof obj.tool_input !== 'object' || obj.tool_input === null)) return false;
    if (obj.session_cwd !== undefined && typeof obj.session_cwd !== 'string') return false;
    return true;
  }

  private validateNotificationRequest(data: unknown): data is NotificationRequest {
    if (typeof data !== 'object' || data === null) return false;
    const obj = data as Record<string, unknown>;
    if (typeof obj.message !== 'string') return false;
    if (obj.title !== undefined && typeof obj.title !== 'string') return false;
    if (obj.type !== undefined && !['info', 'stop', 'question'].includes(obj.type as string)) return false;
    if (obj.session_cwd !== undefined && typeof obj.session_cwd !== 'string') return false;
    return true;
  }

  private handlePermission(request: PermissionRequest, res: http.ServerResponse): void {
    // キューサイズ制限
    if (this.queue.length >= MAX_QUEUE_SIZE) {
      res.writeHead(429);
      res.end(JSON.stringify({ error: 'Too many pending requests' }));
      return;
    }

    const dangerInfo = analyzeToolDanger(request.tool_name, request.tool_input as Record<string, unknown>);
    const { displayText, detail } = describeToolAction(request.tool_name, request.tool_input as Record<string, unknown>);
    const id = generateId();

    // Promise that resolves when user responds
    const responsePromise = new Promise<PermissionResponse>((resolve) => {
      // Timeout: auto-deny after 5 minutes
      const timer = setTimeout(() => {
        const idx = this.queue.findIndex(i => i.id === id);
        if (idx !== -1) {
          this.queue[idx].resolve({ decision: 'deny' });
          this.queue.splice(idx, 1);
          if (this.queue.length > 0) {
            this.showCurrentItem();
          }
        }
      }, PERMISSION_TIMEOUT);

      const item: QueueItem = {
        id,
        request,
        dangerInfo,
        description: detail,
        displayText,
        resolve,
        createdAt: Date.now(),
        timer,
      };
      this.queue.push(item);

      // Show popup if this is the first item (or currently displayed)
      if (this.queue.length === 1) {
        this.showCurrentItem();
      } else {
        // Update queue count on current popup
        this.showCurrentItem();
      }
    });

    responsePromise.then((response) => {
      res.writeHead(200);
      res.end(JSON.stringify(response));
    });
  }

  private handleNotification(request: NotificationRequest, res: http.ServerResponse): void {
    const projectName = request.session_cwd
      ? path.basename(request.session_cwd)
      : undefined;

    const data: NotificationPopupData = {
      message: request.message || '',
      title: request.title || '通知',
      type: request.type || 'info',
      projectName,
      queueCount: this.queue.length,
    };

    this.callbacks.onNotification(data);

    res.writeHead(200);
    res.end(JSON.stringify({ status: 'ok' }));
  }

  private showCurrentItem(): void {
    if (this.queue.length === 0) return;

    const current = this.queue[0];

    const projectName = current.request.session_cwd
      ? path.basename(current.request.session_cwd)
      : undefined;

    const popupData: PopupData = {
      id: current.id,
      toolName: current.request.tool_name,
      command: current.displayText,
      dangerInfo: current.dangerInfo,
      description: current.description,
      queueCount: this.queue.length - 1,
      projectName,
    };

    this.callbacks.onPermissionRequest(popupData);
  }
}
