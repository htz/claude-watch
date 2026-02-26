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

// shell-quote: 開発時は node_modules、パッケージ時は extraResource から解決
let shellParse;
try {
  shellParse = require('shell-quote').parse;
} catch {
  try {
    shellParse = require(path.join(__dirname, '..', 'shell-quote')).parse;
  } catch {
    shellParse = null;
  }
}

// shell-quote の変数展開を抑止する Proxy ($HOME → "$HOME" のまま保持)
const NO_EXPAND_ENV = new Proxy({}, { get: (_, key) => '$' + key });

// コマンド区切り演算子
const COMMAND_SEPARATORS = new Set(['&&', '||', ';', '|', '&']);

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
 * 複数行コマンドから実際のコマンド行を抽出する。
 * - ヒアドキュメント (<< MARKER ... MARKER) の内容をスキップ
 * - 行継続 (末尾 \) を結合
 * - 空行を除去
 */
function extractCommandLines(fullCommand) {
  const rawLines = fullCommand.split('\n');
  const commands = [];
  let heredocDelimiter = null;
  let continuationBuffer = '';

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];

    // ヒアドキュメント内 → 閉じデリミタまでスキップ
    if (heredocDelimiter) {
      // <<- の場合はタブインデント付きの閉じデリミタも許容
      const trimmed = line.replace(/^\t+/, '').trim();
      if (trimmed === heredocDelimiter) {
        heredocDelimiter = null;
      }
      continue;
    }

    // 行継続の結合
    if (continuationBuffer) {
      continuationBuffer += ' ' + line.trim();
    } else {
      continuationBuffer = line;
    }

    if (continuationBuffer.trimEnd().endsWith('\\')) {
      continuationBuffer = continuationBuffer.trimEnd().slice(0, -1);
      continue;
    }

    const completeLine = continuationBuffer.trim();
    continuationBuffer = '';

    if (!completeLine) continue;

    // ヒアドキュメント開始を検出 (<<, <<-, 引用符付きデリミタ)
    // 同一行に複数の << がある場合は最後のものを採用
    const heredocMatches = [...completeLine.matchAll(/<<-?\s*\\?['"]?(\w+)['"]?/g)];
    if (heredocMatches.length > 0) {
      heredocDelimiter = heredocMatches[heredocMatches.length - 1][1];
    }

    commands.push(completeLine);
  }

  // 残りの継続バッファ
  if (continuationBuffer.trim()) {
    commands.push(continuationBuffer.trim());
  }

  return commands;
}

/**
 * コマンド行先頭の環境変数代入 (VAR=value) を除去して実際のコマンドを返す。
 * 対応形式: VAR=val, VAR="val", VAR='val', 複数連続 (A=1 B=2 cmd)
 * 純粋な変数代入のみの行 (コマンドなし) は空文字を返す。
 */
function stripLeadingEnvVars(command) {
  return command.replace(/^(?:\w+=(?:'[^']*'|"(?:[^"\\]|\\.)*"|\S*)\s+)+/, '');
}

/**
 * 行が純粋な変数代入 (コマンド実行なし) かどうか判定する。
 * export VAR=val, VAR=val (末尾にコマンドなし) にマッチ。
 */
function isPureAssignment(line) {
  return /^(?:export\s+)?\w+=(?:'[^']*'|"(?:[^"\\]|\\.)*"|\S*)$/.test(line.trim());
}

/**
 * コマンド行をシェル演算子 (&&, ||, ;, |, &) で分割する。
 * shell-quote でトークナイズし、コマンド区切り演算子で分割する。
 * クォート・エスケープは shell-quote が正しく処理する。
 */
function splitOnOperators(command) {
  if (!shellParse) return [command];

  let tokens;
  try {
    tokens = shellParse(command, NO_EXPAND_ENV);
  } catch {
    return [command];
  }

  const commands = [];
  let current = [];

  for (const token of tokens) {
    if (typeof token === 'object' && token.op && COMMAND_SEPARATORS.has(token.op)) {
      // コマンド区切り演算子 → ここまでを1コマンドとして確定
      if (current.length > 0) {
        commands.push(current.join(' '));
        current = [];
      }
    } else if (typeof token === 'object' && token.pattern) {
      // グロブパターン (*.txt 等) — op: "glob" より pattern を優先
      current.push(token.pattern);
    } else if (typeof token === 'string') {
      current.push(token);
    } else if (typeof token === 'object' && token.op) {
      // リダイレクト (>, <, >>, >&, etc.) やサブシェル括弧 → コマンドの一部として保持
      current.push(token.op);
    }
    // {comment: "..."} はスキップ
  }

  if (current.length > 0) {
    commands.push(current.join(' '));
  }

  return commands.length > 0 ? commands : [command];
}

/**
 * コマンドにシェルのコマンド置換 ($() や バッククォート) が含まれるか検出する。
 * shell-quote のトークンを解析: $ + ( 演算子 = 非クォート $()、
 * 文字列トークン内の $( や ` = クォート内の置換。
 *
 * 注意: shell-quote はシングルクォートとダブルクォートの区別を保持しないため、
 * '$(safe)' もダブルクォート内と同様に検出される (安全側に倒す)。
 */
function containsCommandSubstitution(command) {
  if (!shellParse) return false;

  let tokens;
  try {
    tokens = shellParse(command, NO_EXPAND_ENV);
  } catch {
    return true; // パース失敗 → 安全側: 置換ありとみなす
  }

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (typeof token !== 'string') continue;

    // 非クォート $(): "$" トークン + "(" 演算子
    if (token === '$' && i + 1 < tokens.length &&
        typeof tokens[i + 1] === 'object' && tokens[i + 1].op === '(') {
      return true;
    }

    // 文字列トークン内の $( (クォート内 $())
    if (/\$\(/.test(token)) return true;

    // バッククォート
    if (token.includes('`')) return true;
  }

  return false;
}

/**
 * 単一行コマンドがパターンリストのいずれかにマッチするか判定する。
 * 先頭の環境変数代入 (FOO=bar cmd) を除去してからパターン照合する。
 */
function matchesSingleCommand(command, patterns) {
  // 環境変数プレフィックスを除去 (例: "NODE_ENV=test npm test" → "npm test")
  const cmd = stripLeadingEnvVars(command) || command;

  for (const pattern of patterns) {
    if (pattern.endsWith(':*')) {
      // Prefix match: "cat:*" matches "cat foo.txt"
      const prefix = pattern.slice(0, -2);
      if (cmd === prefix || cmd.startsWith(prefix + ' ') || cmd.startsWith(prefix + '\t')) {
        return true;
      }
    } else if (pattern.includes('*')) {
      // Simple glob: convert to regex（連続する * を単一の .* に正規化して ReDoS を防止）
      const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*+/g, '.*');
      if (new RegExp(`^${escaped}$`).test(cmd)) {
        return true;
      }
    } else {
      // Exact match
      if (cmd === pattern || cmd.startsWith(pattern + ' ')) {
        return true;
      }
    }
  }
  return false;
}

/**
 * シェル制御構文の行を正規化する。
 * - 純粋な構文キーワード (then, fi, done 等) → null (除外)
 * - if/elif COND; then → 条件コマンドを抽出
 * - while/until COND; do → 条件コマンドを抽出
 * - for/case/case分岐パターン → null (構文的要素)
 * - それ以外 → そのまま返す
 */
function normalizeShellLine(line) {
  const trimmed = line.trim();

  // 純粋な構文キーワード (リダイレクト・コメント付きも許容: done < file, fi # comment)
  if (/^(then|else|fi|do|done|esac)\b/.test(trimmed) || /^(;;|\{|\})(\s|$)/.test(trimmed)) return null;

  // for VAR in ...; do  /  for ((expr)); do
  if (/^for\s+/.test(trimmed)) return null;

  // case ... in
  if (/^case\s+.+\s+in$/.test(trimmed)) return null;

  // case 分岐パターン (例: foo), *.txt|*.md), *)  )
  if (/^[^(]*\)\s*$/.test(trimmed)) return null;

  // if/elif CONDITION; then → 条件コマンドを抽出
  const ifMatch = trimmed.match(/^(?:if|elif)\s+(.*?)\s*;\s*then$/);
  if (ifMatch) return ifMatch[1];

  // while/until CONDITION; do → 条件コマンドを抽出
  const whileMatch = trimmed.match(/^(?:while|until)\s+(.*?)\s*;\s*do$/);
  if (whileMatch) return whileMatch[1];

  // if/elif (then が次行)
  const ifNoThen = trimmed.match(/^(?:if|elif)\s+(.+)$/);
  if (ifNoThen) return ifNoThen[1];

  // while/until (do が次行)
  const whileNoDo = trimmed.match(/^(?:while|until)\s+(.+)$/);
  if (whileNoDo) return whileNoDo[1];

  return trimmed;
}

/**
 * Check if a Bash command matches any of the given patterns.
 *
 * 処理フロー:
 *   1. 複数行 → extractCommandLines (ヒアドキュメント・行継続を考慮)
 *   2. normalizeShellLine (if/for/fi 等のシェル制御構文を正規化)
 *   3. isPureAssignment で変数代入行を除外
 *   4. splitOnOperators (&&, ||, ;, |, & で分割)
 *   5. パターン照合
 *
 * @param {string} command - Bash コマンド文字列
 * @param {string[]} patterns - パターンリスト
 * @param {'all'|'any'} mode
 *   - 'all': 全サブコマンドがマッチした場合 true (allow 用)
 *            コマンド置換 ($(), ``) を含むサブコマンドがあれば false
 *   - 'any': いずれかのサブコマンドがマッチした場合 true (deny 用)
 */
function matchesCommandPattern(command, patterns, mode) {
  if (mode === undefined) mode = 'all';

  // コマンド行を抽出・正規化
  let lines;
  if (command.includes('\n')) {
    lines = extractCommandLines(command)
      .map(cmd => normalizeShellLine(cmd))
      .filter(cmd => cmd !== null);
  } else {
    lines = [command];
  }

  // allow 用: 元のコマンド行でコマンド置換を検出 (再構築前にチェック)
  // shell-quote はクォート情報を保持しないため、再構築後の文字列では誤検出する
  if (mode !== 'any' && lines.some(line => containsCommandSubstitution(line))) {
    return false;
  }

  // 演算子で分割
  const subCommands = lines
    .filter(cmd => !isPureAssignment(cmd))
    .flatMap(cmd => splitOnOperators(cmd))
    .map(cmd => cmd.trim())
    .filter(cmd => cmd && !isPureAssignment(cmd));

  if (subCommands.length === 0) return false;

  if (mode === 'any') {
    // deny 用: いずれかがマッチすれば true
    return subCommands.some(cmd => matchesSingleCommand(cmd, patterns));
  }

  return subCommands.every(cmd => matchesSingleCommand(cmd, patterns));
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
  // 'any' モード: いずれかのサブコマンドが deny にマッチすれば拒否
  const isDenied = toolName === 'Bash'
    ? matchesCommandPattern(command, perms.deny.bashPatterns, 'any')
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

module.exports = { parsePermissionList, mergePermissionLists, findProjectRoot, loadPermissionSettings, matchesCommandPattern, matchesSingleCommand, extractCommandLines, matchesToolPattern, stripLeadingEnvVars, isPureAssignment, normalizeShellLine, splitOnOperators, containsCommandSubstitution };
