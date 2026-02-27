#!/usr/bin/env node
'use strict';

/**
 * Claude Code Notification hook.
 *
 * Sends notifications to the claude-watch app.
 * Non-blocking: always exits quickly regardless of app state.
 */

const http = require('http');
const path = require('path');
const os = require('os');

const SOCKET_PATH = path.join(os.homedir(), '.claude-watch', 'watch.sock');
const TIMEOUT_MS = 5000;
const MAX_STDIN_SIZE = 10 * 1024 * 1024; // 10MB

function sendNotification(message, title, type) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ message, title, type, session_cwd: process.cwd() });

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
        // Consume response
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
    process.exit(0);
  }

  // Extract notification info
  const message = data.notification || data.message || '';
  const title = data.title || 'Claude Code';
  const type = data.type || 'question';

  if (!message) {
    process.exit(0);
  }

  await sendNotification(message, title, type);
}

main()
  .catch(() => {})
  .finally(() => process.exit(0));
