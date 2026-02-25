#!/usr/bin/env node
'use strict';

/**
 * Claude Code PreToolUse hook for all tool types.
 *
 * Reads tool invocation from stdin, sends to claude-code-notifier app via HTTP,
 * and outputs permission decision to stdout.
 * Read/Glob/Grep (safe tools) are skipped. Bash checks allowed patterns.
 *
 * Fallback: If the app is not running or errors occur, exits with code 0
 * to let Claude Code show its normal permission dialog.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const SOCKET_PATH = path.join(os.homedir(), '.claude-code-notifier', 'notifier.sock');
const TIMEOUT_MS = 300000; // 5 minutes

/**
 * Load allowed patterns from ~/.claude/settings.json
 */
function loadAllowedPatterns() {
  const patterns = [];
  const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');

  try {
    const content = fs.readFileSync(settingsPath, 'utf-8');
    const settings = JSON.parse(content);

    if (settings.permissions && Array.isArray(settings.permissions.allow)) {
      for (const entry of settings.permissions.allow) {
        // Entry format: "Bash(command:*)" or "Bash(git status)"
        if (typeof entry === 'string' && entry.startsWith('Bash(') && entry.endsWith(')')) {
          const inner = entry.slice(5, -1); // Extract between Bash( and )
          patterns.push(inner);
        }
      }
    }
  } catch {
    // Ignore errors (file not found, parse error, etc.)
  }

  return patterns;
}

/**
 * Check if a command matches any allowed pattern.
 */
function isCommandAllowed(command, patterns) {
  for (const pattern of patterns) {
    if (pattern.endsWith(':*')) {
      // Prefix match: "cat:*" matches "cat foo.txt"
      const prefix = pattern.slice(0, -2);
      if (command === prefix || command.startsWith(prefix + ' ') || command.startsWith(prefix + '\t')) {
        return true;
      }
    } else if (pattern.includes('*')) {
      // Simple glob: convert to regex
      const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
      if (new RegExp(`^${escaped}$`).test(command)) {
        return true;
      }
    } else {
      // Exact match
      if (command === pattern || command.startsWith(pattern + ' ')) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Check if the notifier app is running.
 */
function healthCheck() {
  return new Promise((resolve) => {
    // Socket file existence check — no HTTP request needed if absent
    if (!fs.existsSync(SOCKET_PATH)) {
      resolve(false);
      return;
    }

    const req = http.request({
      socketPath: SOCKET_PATH,
      path: '/health',
      method: 'GET',
      timeout: 2000,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json.status === 'ok');
        } catch {
          resolve(false);
        }
      });
    });

    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });

    req.end();
  });
}

/**
 * Send permission request to the notifier app.
 */
function requestPermission(toolName, toolInput) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ tool_name: toolName, tool_input: toolInput, session_cwd: process.cwd() });

    const req = http.request({
      socketPath: SOCKET_PATH,
      path: '/permission',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: TIMEOUT_MS,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error('Invalid response'));
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout'));
    });

    req.write(body);
    req.end();
  });
}

async function main() {
  // Read stdin
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
  }

  let data;
  try {
    data = JSON.parse(input);
  } catch {
    // Invalid input - fallback
    process.exit(0);
  }

  const toolName = data.tool_name;
  const toolInput = data.tool_input || {};

  // 読み取り専用ツールはポップアップ不要
  const SAFE_TOOLS = ['Read', 'Glob', 'Grep'];
  if (SAFE_TOOLS.includes(toolName)) {
    process.exit(0);
  }

  // Bash: 空コマンドや allowed patterns はスキップ
  if (toolName === 'Bash') {
    const command = (toolInput.command || '').trim();
    if (!command) process.exit(0);
    const allowedPatterns = loadAllowedPatterns();
    if (isCommandAllowed(command, allowedPatterns)) process.exit(0);
  }

  // Check if app is running
  const isRunning = await healthCheck();
  if (!isRunning) {
    // App not running - fallback to normal dialog
    process.exit(0);
  }

  // Request permission from the app
  try {
    const response = await requestPermission(toolName, toolInput);

    if (response.decision === 'skip') {
      // Skip: no output → fallback to terminal dialog
      process.exit(0);
    } else if (response.decision === 'allow') {
      const output = JSON.stringify({
        hookSpecificOutput: {
          permissionDecision: 'allow',
          updatedInput: null,
        },
      });
      process.stdout.write(output);
    } else {
      const output = JSON.stringify({
        hookSpecificOutput: {
          permissionDecision: 'deny',
          reason: 'ユーザーが拒否しました',
        },
      });
      process.stdout.write(output);
    }
  } catch {
    // Error or timeout - fallback to normal dialog
    process.exit(0);
  }
}

main().catch(() => process.exit(0));
