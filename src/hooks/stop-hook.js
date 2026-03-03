#!/usr/bin/env node
'use strict';

/**
 * Claude Code Stop hook.
 *
 * Sends task completion notification to the claude-watch app.
 * Non-blocking: always exits quickly regardless of app state.
 */

const http = require('http');
const path = require('path');
const os = require('os');

// i18n: 開発時は src/i18n、パッケージ時は Resources/i18n から解決
let i18n;
try {
  i18n = require(path.join(__dirname, '..', 'i18n', 'index.cjs'));
} catch {
  try {
    i18n = require(path.join(__dirname, '..', '..', 'i18n', 'index.cjs'));
  } catch {
    i18n = { t: (key) => key };
  }
}
const { t } = i18n;

const SOCKET_PATH = path.join(os.homedir(), '.claude-watch', 'watch.sock');
const TIMEOUT_MS = 5000;
const MAX_STDIN_SIZE = 10 * 1024 * 1024; // 10MB

function sendNotification(message, title, type, session_cwd) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ message, title, type, session_cwd });

    const req = http.request(
      {
        socketPath: SOCKET_PATH,
        path: '/notification',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: TIMEOUT_MS,
      },
      (res) => {
        res.on('data', () => {});
        res.on('end', () => resolve());
      },
    );

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
    if (input.length > MAX_STDIN_SIZE) {
      process.exit(0);
    }
  }

  let data;
  try {
    data = JSON.parse(input);
  } catch {
    // No valid input
    process.exit(0);
  }

  const reason = data.stop_hook_active !== undefined ? t('hook.taskCompleted') : t('hook.claudeStopped');

  await sendNotification(reason, 'Claude Code', 'stop', process.cwd());
}

// テスト用エクスポート (直接実行時は main を起動)
if (require.main === module) {
  main()
    .catch(() => {})
    .finally(() => process.exit(0));
}

module.exports = { sendNotification, main, SOCKET_PATH, TIMEOUT_MS, MAX_STDIN_SIZE };
