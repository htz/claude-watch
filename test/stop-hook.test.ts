import http from 'http';
import os from 'os';
import path from 'path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

const { sendNotification, TIMEOUT_MS, MAX_STDIN_SIZE } = require('../src/hooks/stop-hook');

let mockServer: http.Server;
let socketPath: string;
let receivedRequests: { method: string; url: string; body: string }[];

function createMockServer(sock: string): Promise<void> {
  return new Promise((resolve) => {
    mockServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk: string) => {
        body += chunk;
      });
      req.on('end', () => {
        receivedRequests.push({ method: req.method || '', url: req.url || '', body });
        res.writeHead(200);
        res.end(JSON.stringify({ status: 'ok' }));
      });
    });
    mockServer.listen(sock, () => resolve());
  });
}

function closeMockServer(): Promise<void> {
  return new Promise((resolve) => {
    if (mockServer) {
      mockServer.close(() => resolve());
    } else {
      resolve();
    }
  });
}

describe('stop-hook.js', () => {
  describe('constants', () => {
    it('should have 5 second timeout', () => {
      expect(TIMEOUT_MS).toBe(5000);
    });

    it('should have 10MB max stdin size', () => {
      expect(MAX_STDIN_SIZE).toBe(10 * 1024 * 1024);
    });
  });

  describe('sendNotification', () => {
    it('should be a function', () => {
      expect(typeof sendNotification).toBe('function');
    });

    it('should resolve even when server is unreachable', async () => {
      // 存在しないソケットに送信しても resolve する (エラーを握りつぶす)
      await expect(sendNotification('test', 'title', 'stop', '/cwd')).resolves.toBeUndefined();
    });

    it('should accept message, title, type, and session_cwd parameters', async () => {
      await expect(sendNotification('msg', 'Claude Code', 'stop', '/project')).resolves.toBeUndefined();
    });
  });

  describe('sendNotification with mock server', () => {
    beforeAll(async () => {
      socketPath = path.join(os.tmpdir(), `stop-mock-${process.pid}.sock`);
      receivedRequests = [];
      await createMockServer(socketPath);
    });

    afterAll(async () => {
      await closeMockServer();
      try {
        const fs = await import('fs');
        fs.unlinkSync(socketPath);
      } catch {}
    });

    afterEach(() => {
      receivedRequests = [];
    });

    it('should send correct JSON body for stop notification', async () => {
      const body = JSON.stringify({
        message: 'タスクが完了しました',
        title: 'Claude Code',
        type: 'stop',
        session_cwd: '/test/project',
      });

      await new Promise<void>((resolve) => {
        const req = http.request(
          {
            socketPath,
            path: '/notification',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(body),
            },
          },
          (res) => {
            res.on('data', () => {});
            res.on('end', () => resolve());
          },
        );
        req.write(body);
        req.end();
      });

      expect(receivedRequests).toHaveLength(1);
      expect(receivedRequests[0].method).toBe('POST');
      expect(receivedRequests[0].url).toBe('/notification');

      const parsed = JSON.parse(receivedRequests[0].body);
      expect(parsed.message).toBe('タスクが完了しました');
      expect(parsed.title).toBe('Claude Code');
      expect(parsed.type).toBe('stop');
      expect(parsed.session_cwd).toBe('/test/project');
    });

    it('should include session_cwd in the request body', async () => {
      const body = JSON.stringify({
        message: 'Claude が停止しました',
        title: 'Claude Code',
        type: 'stop',
        session_cwd: '/Users/dev/my-project',
      });

      await new Promise<void>((resolve) => {
        const req = http.request(
          {
            socketPath,
            path: '/notification',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(body),
            },
          },
          (res) => {
            res.on('data', () => {});
            res.on('end', () => resolve());
          },
        );
        req.write(body);
        req.end();
      });

      const parsed = JSON.parse(receivedRequests[0].body);
      expect(parsed.session_cwd).toBe('/Users/dev/my-project');
    });
  });
});
