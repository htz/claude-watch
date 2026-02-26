#!/usr/bin/env node
'use strict';

/**
 * Claude Code PreToolUse hook for all tool types.
 *
 * Reads tool invocation from stdin, sends to claude-watch app via HTTP,
 * and outputs permission decision to stdout.
 * Read/Glob/Grep (safe tools) are skipped.
 * settings.json の permissions (allow/deny/ask) を尊重:
 *   - allow → ポップアップ不要、exit(0) で Claude 本体にフォールスルー
 *   - deny  → 即座に permissionDecision: 'deny' を出力
 *   - ask   → ポップアップ表示 (デフォルト動作)
 * Bash / 非 Bash 両方でパターン照合に対応。
 *
 * 設定ファイルの読み込み優先順 (全てマージ):
 *   1. ~/.claude/settings.json          (グローバル)
 *   2. <project>/.claude/settings.json  (プロジェクト、Git 管理)
 *   3. <project>/.claude/settings.local.json (プロジェクト、ローカル)
 *
 * Fallback: If the app is not running or errors occur, exits with code 0
 * to let Claude Code show its normal permission dialog.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const SOCKET_PATH = path.join(os.homedir(), '.claude-watch', 'watch.sock');
const TIMEOUT_MS = 300000; // 5 minutes
const MAX_STDIN_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * Parse a permissions list (allow/deny/ask) into Bash command patterns and tool patterns.
 */
function parsePermissionList(entries) {
  const bashPatterns = [];
  const toolPatterns = [];

  if (!Array.isArray(entries)) return { bashPatterns, toolPatterns };

  for (const entry of entries) {
    if (typeof entry !== 'string') continue;

    if (entry.startsWith('Bash(') && entry.endsWith(')')) {
      // Bash pattern: "Bash(git status)" → "git status"
      const inner = entry.slice(5, -1);
      bashPatterns.push(inner);
    } else {
      // Non-Bash tool pattern: "Edit", "Write", "mcp__notion__*", etc.
      toolPatterns.push(entry);
    }
  }

  return { bashPatterns, toolPatterns };
}

/**
 * Merge two parsed permission lists by concatenating their patterns.
 */
function mergePermissionLists(a, b) {
  return {
    bashPatterns: a.bashPatterns.concat(b.bashPatterns),
    toolPatterns: a.toolPatterns.concat(b.toolPatterns),
  };
}

/**
 * Read and parse permissions from a single settings file.
 * Returns null if the file does not exist or cannot be parsed.
 */
function readSettingsFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const settings = JSON.parse(content);
    return settings.permissions || null;
  } catch {
    return null;
  }
}

/**
 * Find the project root by walking up from cwd looking for .claude/ directory.
 */
function findProjectRoot(cwd) {
  let dir = cwd;
  while (true) {
    if (fs.existsSync(path.join(dir, '.claude'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }
  return null;
}

/**
 * Load permission settings from all settings files (global + project).
 * Merges allow/deny/ask lists from:
 *   1. ~/.claude/settings.json          (グローバル)
 *   2. <project>/.claude/settings.json  (プロジェクト)
 *   3. <project>/.claude/settings.local.json (プロジェクトローカル)
 *
 * セキュリティ: プロジェクト設定からは deny/ask のみマージ可能。
 * allow はグローバル設定 (~/.claude/settings.json) のみ適用される。
 */
function loadPermissionSettings(cwd) {
  const empty = { bashPatterns: [], toolPatterns: [] };
  const result = {
    allow: { ...empty },
    deny: { ...empty },
    ask: { ...empty },
  };

  // グローバル設定: allow/deny/ask 全てマージ
  const globalPath = path.join(os.homedir(), '.claude', 'settings.json');
  const globalPerms = readSettingsFile(globalPath);
  if (globalPerms) {
    for (const key of ['allow', 'deny', 'ask']) {
      if (globalPerms[key]) {
        result[key] = mergePermissionLists(result[key], parsePermissionList(globalPerms[key]));
      }
    }
  }

  // プロジェクト設定: deny/ask のみマージ（allow はセキュリティ上無視）
  const projectRoot = findProjectRoot(cwd || process.cwd());
  if (projectRoot) {
    const projectFiles = [
      path.join(projectRoot, '.claude', 'settings.json'),
      path.join(projectRoot, '.claude', 'settings.local.json'),
    ];

    for (const filePath of projectFiles) {
      const perms = readSettingsFile(filePath);
      if (!perms) continue;

      for (const key of ['deny', 'ask']) {
        if (perms[key]) {
          result[key] = mergePermissionLists(result[key], parsePermissionList(perms[key]));
        }
      }
    }
  }

  return result;
}

/**
 * Check if a Bash command matches any of the given patterns.
 * 改行を含むコマンドは各行を個別にチェックし、全行がマッチした場合のみ true を返す。
 */
function matchesCommandPattern(command, patterns) {
  // 改行を含むコマンドは各行を個別にチェック（改行インジェクション防止）
  if (command.includes('\n')) {
    const lines = command.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    // 全行がパターンにマッチする場合のみ許可（1行でもマッチしなければ false）
    return lines.length > 0 && lines.every(line => matchesCommandPattern(line, patterns));
  }

  for (const pattern of patterns) {
    if (pattern.endsWith(':*')) {
      // Prefix match: "cat:*" matches "cat foo.txt"
      const prefix = pattern.slice(0, -2);
      if (command === prefix || command.startsWith(prefix + ' ') || command.startsWith(prefix + '\t')) {
        return true;
      }
    } else if (pattern.includes('*')) {
      // Simple glob: convert to regex（連続する * を単一の .* に正規化して ReDoS を防止）
      const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*+/g, '.*');
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
 * Check if a non-Bash tool name matches any of the given patterns.
 * Handles exact match ("Edit") and wildcard ("mcp__notion__*").
 */
function matchesToolPattern(toolName, toolPatterns) {
  for (const pattern of toolPatterns) {
    if (pattern === toolName) {
      return true;
    }
    if (pattern.includes('*')) {
      const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*+/g, '.*');
      if (new RegExp(`^${escaped}$`).test(toolName)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Check if the claude-watch app is running.
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
 * Send permission request to the claude-watch app.
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
  // Read stdin (with size limit)
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

  // settings.json の permissions (allow/deny/ask) を読み込み
  const perms = loadPermissionSettings();
  const command = toolName === 'Bash' ? (toolInput.command || '').trim() : '';

  // Bash: 空コマンドはスキップ
  if (toolName === 'Bash' && !command) process.exit(0);

  // deny リスト → 即座に拒否 (ポップアップ不要)
  const isDenied = toolName === 'Bash'
    ? matchesCommandPattern(command, perms.deny.bashPatterns)
    : matchesToolPattern(toolName, perms.deny.toolPatterns);

  if (isDenied) {
    const output = JSON.stringify({
      hookSpecificOutput: {
        permissionDecision: 'deny',
        reason: 'settings.json の deny リストに含まれています',
      },
    });
    process.stdout.write(output);
    process.exit(0);
  }

  // allow リスト → exit(0) で Claude 本体にフォールスルー (ポップアップ不要)
  const isAllowed = toolName === 'Bash'
    ? matchesCommandPattern(command, perms.allow.bashPatterns)
    : matchesToolPattern(toolName, perms.allow.toolPatterns);

  if (isAllowed) process.exit(0);

  // ask リスト、またはどのリストにも含まれない → ポップアップ表示へ進む

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
      process.stdout.write(output, () => process.exit(0));
    } else {
      const output = JSON.stringify({
        hookSpecificOutput: {
          permissionDecision: 'deny',
          reason: 'ユーザーが拒否しました',
        },
      });
      process.stdout.write(output, () => process.exit(0));
    }
  } catch {
    // Error or timeout - fallback to normal dialog
    process.exit(0);
  }
}

// テスト用エクスポート (直接実行時は main を起動)
if (require.main === module) {
  main().catch(() => process.exit(0));
}

module.exports = { parsePermissionList, mergePermissionLists, findProjectRoot, loadPermissionSettings, matchesCommandPattern, matchesToolPattern };
