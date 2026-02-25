#!/usr/bin/env node
'use strict';

/**
 * Claude Code Stop hook.
 *
 * Sends task completion notification to the claude-code-notifier app.
 * Non-blocking: always exits quickly regardless of app state.
 */

const http = require('http');

const NOTIFIER_HOST = '127.0.0.1';
const NOTIFIER_PORT = 19400;
const TIMEOUT_MS = 5000;

function sendNotification(message, title, type, session_cwd) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ message, title, type, session_cwd });

    const req = http.request({
      hostname: NOTIFIER_HOST,
      port: NOTIFIER_PORT,
      path: '/notification',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: TIMEOUT_MS,
    }, (res) => {
      res.on('data', () => {});
      res.on('end', () => resolve());
    });

    req.on('error', () => resolve());
    req.on('timeout', () => {
      req.destroy();
      resolve();
    });

    req.write(body);
    req.end();
  });
}

async function main() {
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
  }

  let data;
  try {
    data = JSON.parse(input);
  } catch {
    // No valid input
    process.exit(0);
  }

  const reason = data.stop_hook_active !== undefined
    ? 'タスクが完了しました'
    : 'Claude Code が停止しました';

  await sendNotification(reason, 'Claude Code', 'stop', process.cwd());
}

main().catch(() => {}).finally(() => process.exit(0));
