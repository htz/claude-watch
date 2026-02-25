import http from 'http';
import path from 'path';
import { analyzeCommand } from '../shared/danger-level';
import { describeCommand } from '../shared/tool-classifier';
import type { PermissionRequest, PermissionResponse, NotificationRequest, QueueItem, PopupData, NotificationPopupData } from '../shared/types';

const PORT = 19400;
const HOST = '127.0.0.1';
const PERMISSION_TIMEOUT = 5 * 60 * 1000; // 5 minutes

function generateId(): string {
  // Simple UUID-like ID using crypto
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
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
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res);
      });

      this.server.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          console.error(`Port ${PORT} is already in use`);
          reject(err);
        } else {
          reject(err);
        }
      });

      this.server.listen(PORT, HOST, () => {
        console.log(`Notifier server listening on ${HOST}:${PORT}`);
        resolve();
      });
    });
  }

  stop(): void {
    // Deny all pending requests
    for (const item of this.queue) {
      item.resolve({ decision: 'deny' });
    }
    this.queue = [];

    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }

  /** ユーザーがポップアップで応答した。次の表示は呼び出し側に委ねる */
  respondToPermission(id: string, decision: 'allow' | 'deny' | 'skip'): void {
    const index = this.queue.findIndex(item => item.id === id);
    if (index === -1) return;

    const item = this.queue[index];
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
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);

        if (url === '/permission') {
          this.handlePermission(data as PermissionRequest, res);
        } else if (url === '/notification') {
          this.handleNotification(data as NotificationRequest, res);
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

  private handlePermission(request: PermissionRequest, res: http.ServerResponse): void {
    const command = request.tool_input.command || '';
    const dangerInfo = analyzeCommand(command);
    const { detail } = describeCommand(command);
    const id = generateId();

    // Promise that resolves when user responds
    const responsePromise = new Promise<PermissionResponse>((resolve) => {
      const item: QueueItem = {
        id,
        request,
        dangerInfo,
        description: detail,
        resolve,
        createdAt: Date.now(),
      };
      this.queue.push(item);

      // Timeout: auto-deny after 5 minutes
      setTimeout(() => {
        const idx = this.queue.findIndex(i => i.id === id);
        if (idx !== -1) {
          this.queue[idx].resolve({ decision: 'deny' });
          this.queue.splice(idx, 1);
          if (this.queue.length > 0) {
            this.showCurrentItem();
          }
        }
      }, PERMISSION_TIMEOUT);

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
    const data: NotificationPopupData = {
      message: request.message || '',
      title: request.title || '通知',
      type: request.type || 'info',
    };

    this.callbacks.onNotification(data);

    res.writeHead(200);
    res.end(JSON.stringify({ status: 'ok' }));
  }

  private showCurrentItem(): void {
    if (this.queue.length === 0) return;

    const current = this.queue[0];
    const command = current.request.tool_input.command || '';

    const projectName = current.request.session_cwd
      ? path.basename(current.request.session_cwd)
      : undefined;

    const popupData: PopupData = {
      id: current.id,
      toolName: current.request.tool_name,
      command,
      dangerInfo: current.dangerInfo,
      description: current.description,
      queueCount: this.queue.length - 1,
      projectName,
    };

    this.callbacks.onPermissionRequest(popupData);
  }
}
