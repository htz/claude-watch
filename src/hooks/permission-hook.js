#!/usr/bin/env node
'use strict';

/**
 * Claude Code PreToolUse hook for all tool types.
 *
 * Reads tool invocation from stdin, sends to claude-watch app via HTTP,
 * and outputs permission decision to stdout.
 * Read/Glob/Grep (safe tools) are skipped.
 * settings.json の permissions (allow/deny/ask) を尊重 (deny → ask → allow の順で評価):
 *   - deny  → 即座に permissionDecision: 'deny' を出力
 *   - ask   → ポップアップ表示 (危険度は最低 HIGH に引き上げ)
 *   - allow → ポップアップ不要、exit(0) で Claude 本体にフォールスルー
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

// web-tree-sitter: 開発時は node_modules、パッケージ時は extraResource から解決
// v0.25 は package.json に main がなく exports のみのため、
// パッケージ時は tree-sitter.cjs を直接指定する必要がある
let TreeSitter = null;
try {
  TreeSitter = require('web-tree-sitter');
} catch {
  try {
    TreeSitter = require(path.join(__dirname, '..', 'web-tree-sitter', 'tree-sitter.cjs'));
  } catch {
    TreeSitter = null;
  }
}

let parser = null;

/**
 * tree-sitter-bash パーサーを初期化する。
 * WASM ファイルの読み込みが必要なため非同期。
 * 失敗時は parser = null のまま (graceful degradation)。
 */
async function initTreeSitter() {
  if (!TreeSitter) return;

  try {
    await TreeSitter.Parser.init();

    // WASM ファイルの探索: web-tree-sitter パッケージと同じディレクトリにコピー済み
    const candidates = [];

    // 開発時: node_modules/web-tree-sitter/tree-sitter-bash.wasm
    try {
      candidates.push(path.join(path.dirname(require.resolve('web-tree-sitter')), 'tree-sitter-bash.wasm'));
    } catch {
      // require.resolve が失敗する場合 (パッケージ時)
    }

    // パッケージ時: extraResource/web-tree-sitter/tree-sitter-bash.wasm
    candidates.push(path.join(__dirname, '..', 'web-tree-sitter', 'tree-sitter-bash.wasm'));

    let wasmPath = null;
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        wasmPath = p;
        break;
      }
    }

    if (!wasmPath) return;

    const Lang = await TreeSitter.Language.load(wasmPath);
    parser = new TreeSitter.Parser();
    parser.setLanguage(Lang);
  } catch {
    parser = null;
  }
}

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
 * Read and parse a single settings file.
 * Returns the full settings object, or null if the file does not exist or cannot be parsed.
 */
function readSettingsFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Find the project root by walking up from cwd looking for .claude/ directory.
 */
function findProjectRoot(cwd) {
  let dir = cwd;
  for (;;) {
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
 * 設定オブジェクトから bypassPermissions が有効かを判定する。
 * - permissions.defaultMode === 'bypassPermissions' (Claude Code 本家準拠)
 * - トップレベル bypassPermissions === true (後方互換)
 */
function isBypassPermissions(settings) {
  if (settings.bypassPermissions === true) return true;
  if (settings.permissions && settings.permissions.defaultMode === 'bypassPermissions') return true;
  return false;
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
 *
 * bypassPermissions: 以下のいずれかで有効化される:
 *   - permissions.defaultMode === 'bypassPermissions' (Claude Code 本家準拠)
 *   - トップレベル bypassPermissions === true (後方互換)
 */
function loadPermissionSettings(cwd) {
  const empty = { bashPatterns: [], toolPatterns: [] };
  const result = {
    allow: { ...empty },
    deny: { ...empty },
    ask: { ...empty },
    bypassPermissions: false,
  };

  // グローバル設定: allow/deny/ask 全てマージ + bypassPermissions
  const globalPath = path.join(os.homedir(), '.claude', 'settings.json');
  const globalSettings = readSettingsFile(globalPath);
  if (globalSettings) {
    if (isBypassPermissions(globalSettings)) {
      result.bypassPermissions = true;
    }
    const globalPerms = globalSettings.permissions;
    if (globalPerms) {
      for (const key of ['allow', 'deny', 'ask']) {
        if (globalPerms[key]) {
          result[key] = mergePermissionLists(result[key], parsePermissionList(globalPerms[key]));
        }
      }
    }
  }

  // プロジェクト設定のマージ
  const projectRoot = findProjectRoot(cwd || process.cwd());
  if (projectRoot) {
    // settings.json (Git 管理): allow/deny/ask 全てマージ (Claude Code 本家と同じ)
    // deny → ask → allow の評価順序でセキュリティを担保
    const projectSettingsPath = path.join(projectRoot, '.claude', 'settings.json');
    const projectSettings = readSettingsFile(projectSettingsPath);
    if (projectSettings) {
      const projectPerms = projectSettings.permissions;
      if (projectPerms) {
        for (const key of ['allow', 'deny', 'ask']) {
          if (projectPerms[key]) {
            result[key] = mergePermissionLists(result[key], parsePermissionList(projectPerms[key]));
          }
        }
      }
    }

    // settings.local.json (ローカル専用、Git 非管理): allow/deny/ask 全てマージ + bypassPermissions
    // ユーザーが手動または Claude Code の「このプロジェクトで常に許可」で作成するファイル
    const localSettingsPath = path.join(projectRoot, '.claude', 'settings.local.json');
    const localSettings = readSettingsFile(localSettingsPath);
    if (localSettings) {
      if (isBypassPermissions(localSettings)) {
        result.bypassPermissions = true;
      }
      const localPerms = localSettings.permissions;
      if (localPerms) {
        for (const key of ['allow', 'deny', 'ask']) {
          if (localPerms[key]) {
            result[key] = mergePermissionLists(result[key], parsePermissionList(localPerms[key]));
          }
        }
      }
    }
  }

  return result;
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
 * ノードが変数展開 ($var, ${var}) を含むか判定する。
 * コマンド名が動的に決定される場合に hasUnresolvable を設定するために使用。
 */
function hasVariableExpansion(node) {
  if (node.type === 'simple_expansion' || node.type === 'expansion') {
    return true;
  }
  for (let i = 0; i < node.childCount; i++) {
    if (hasVariableExpansion(node.child(i))) return true;
  }
  return false;
}

/**
 * AST を再帰的に walk し、全 command ノードのテキストを収集する。
 * - variable_assignment / declaration_command は除外（コマンドではない）
 * - command_substitution 内のコマンドも再帰的に抽出
 * - 動的コマンド名 ($cmd) を検出した場合は hasUnresolvable = true
 *
 * @param {object} rootNode - tree-sitter の rootNode
 * @returns {{ commands: string[], hasUnresolvable: boolean }}
 */
function extractCommandsFromAST(rootNode) {
  const commands = [];
  let hasUnresolvable = false;

  function walk(node) {
    // command ノード = 実行されるコマンド
    if (node.type === 'command') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        // 動的コマンド名 ($cmd, ${cmd}) の検出
        if (hasVariableExpansion(nameNode)) {
          hasUnresolvable = true;
        }
        // variable_assignment (FOO=bar cmd → cmd) を除去してコマンド部分のみ抽出
        const hasAssignments = node.namedChildren.some((c) => c.type === 'variable_assignment');
        if (hasAssignments) {
          const parts = [];
          for (let i = 0; i < node.childCount; i++) {
            const child = node.child(i);
            if (child.type !== 'variable_assignment') {
              parts.push(child.text);
            }
          }
          commands.push(parts.join(' '));
        } else {
          commands.push(node.text);
        }
      } else {
        // コマンド名がない場合（純粋な変数代入 FOO=bar）はスキップ
        // ただし名前なしコマンドでも引数があれば（まれ）安全側に倒す
        const hasArgs = node.namedChildCount > 0 && node.namedChildren.some((c) => c.type !== 'variable_assignment');
        if (hasArgs) {
          commands.push(node.text);
        }
      }
      // command の中にネストされた command_substitution があれば子ノードを走査
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child.type !== 'command_name') {
          walk(child);
        }
      }
      return;
    }

    // variable_assignment は command の外でも出現する（トップレベル代入）
    // その値に command_substitution が含まれる場合は走査する
    if (node.type === 'variable_assignment') {
      const valueNode = node.childForFieldName('value');
      if (valueNode) walk(valueNode);
      return;
    }

    // declaration_command (local, declare, export 等) の引数内にある
    // command_substitution のみ走査
    if (node.type === 'declaration_command') {
      for (let i = 0; i < node.childCount; i++) {
        walk(node.child(i));
      }
      return;
    }

    // 全子ノードを再帰（command_substitution 内も自動的に走査）
    for (let i = 0; i < node.childCount; i++) {
      walk(node.child(i));
    }
  }

  walk(rootNode);
  return { commands, hasUnresolvable };
}

/**
 * コマンド文字列をパースして全サブコマンドを抽出する。
 * parser が初期化されていない場合は入力をそのまま返す (graceful degradation)。
 *
 * @param {string} command - Bash コマンド文字列
 * @returns {{ commands: string[], hasUnresolvable: boolean }}
 */
function parseAndExtractCommands(command) {
  if (!parser) {
    // tree-sitter 未初期化: 入力全体を1コマンドとして扱い、安全側に hasUnresolvable
    return { commands: [command], hasUnresolvable: true };
  }

  const tree = parser.parse(command);
  const result = extractCommandsFromAST(tree.rootNode);

  // ERROR ノードが存在する場合はパース失敗 — 安全側に倒す
  if (tree.rootNode.hasError) {
    result.hasUnresolvable = true;
  }

  return result;
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
      if (cmd === prefix || cmd.startsWith(`${prefix} `) || cmd.startsWith(`${prefix}\t`)) {
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
      if (cmd === pattern || cmd.startsWith(`${pattern} `)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Check if a Bash command matches any of the given patterns.
 *
 * 処理フロー:
 *   1. tree-sitter-bash で AST にパース
 *   2. extractCommandsFromAST で全コマンドノードを抽出
 *   3. パターン照合
 *
 * @param {string} command - Bash コマンド文字列
 * @param {string[]} patterns - パターンリスト
 * @param {'all'|'any'} mode
 *   - 'all': 全サブコマンド ($() 内含む) がマッチした場合 true (allow 用)
 *            動的コマンド名等の解決不能な置換を含む場合は false
 *   - 'any': いずれかのサブコマンドがマッチした場合 true (deny 用)
 */
function matchesCommandPattern(command, patterns, mode) {
  if (mode === undefined) mode = 'all';

  const { commands, hasUnresolvable } = parseAndExtractCommands(command);

  if (commands.length === 0) return false;

  // allow 用: 解決不能な要素がある場合は安全側に拒否
  if (mode !== 'any' && hasUnresolvable) return false;

  if (mode === 'any') {
    // deny 用: いずれかがマッチすれば true
    return commands.some((cmd) => matchesSingleCommand(cmd, patterns));
  }

  return commands.every((cmd) => matchesSingleCommand(cmd, patterns));
}

/**
 * Bash コマンドから allow パターンにマッチしないサブコマンドを抽出する。
 *
 * @param {string} command - Bash コマンド文字列
 * @param {string[]} allowPatterns - allow リストの Bash パターン
 * @returns {{ unmatched: string[], hasUnresolvable: boolean }}
 */
function extractUnmatchedCommands(command, allowPatterns) {
  const { commands, hasUnresolvable } = parseAndExtractCommands(command);

  // マッチしないサブコマンドを収集
  const unmatched = commands.filter((cmd) => !matchesSingleCommand(cmd, allowPatterns));

  return { unmatched, hasUnresolvable };
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

    const req = http.request(
      {
        socketPath: SOCKET_PATH,
        path: '/health',
        method: 'GET',
        timeout: 2000,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            resolve(json.status === 'ok');
          } catch {
            resolve(false);
          }
        });
      },
    );

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
function requestPermission(toolName, toolInput, unmatchedCommands, isAskListed) {
  return new Promise((resolve, reject) => {
    const payload = { tool_name: toolName, tool_input: toolInput, session_cwd: process.cwd() };
    if (unmatchedCommands) {
      payload.unmatched_commands = unmatchedCommands;
    }
    if (isAskListed) {
      payload.is_ask_listed = true;
    }
    const body = JSON.stringify(payload);

    const req = http.request(
      {
        socketPath: SOCKET_PATH,
        path: '/permission',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: TIMEOUT_MS,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error('Invalid response'));
          }
        });
      },
    );

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
  // tree-sitter の初期化 (WASM 読み込み)
  await initTreeSitter();

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

  // stdin の permission_mode で bypass 判定 (CLI --dangerously-skip-permissions 対応)
  if (data.permission_mode === 'bypassPermissions') process.exit(0);

  // 読み取り専用ツールはポップアップ不要
  const SAFE_TOOLS = ['Read', 'Glob', 'Grep'];
  if (SAFE_TOOLS.includes(toolName)) {
    process.exit(0);
  }

  // settings.json の permissions (allow/deny/ask) を読み込み
  const perms = loadPermissionSettings();

  // settings ファイルの bypassPermissions が有効な場合も全てスキップ
  if (perms.bypassPermissions) process.exit(0);

  const command = toolName === 'Bash' ? (toolInput.command || '').trim() : '';

  // Bash: 空コマンドはスキップ
  if (toolName === 'Bash' && !command) process.exit(0);

  // deny リスト → 即座に拒否 (ポップアップ不要)
  // 'any' モード: いずれかのサブコマンドが deny にマッチすれば拒否
  const isDenied =
    toolName === 'Bash'
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

  // ask リストマッチ判定 (deny → ask → allow の順で評価)
  const isAskListed =
    toolName === 'Bash'
      ? matchesCommandPattern(command, perms.ask.bashPatterns, 'any')
      : matchesToolPattern(toolName, perms.ask.toolPatterns);

  // ask にマッチしなかった場合のみ allow を評価
  if (!isAskListed) {
    // allow リスト → exit(0) で Claude 本体にフォールスルー (ポップアップ不要)
    const isAllowed =
      toolName === 'Bash'
        ? matchesCommandPattern(command, perms.allow.bashPatterns)
        : matchesToolPattern(toolName, perms.allow.toolPatterns);

    if (isAllowed) process.exit(0);
  }

  // ask リスト、またはどのリストにも含まれない → ポップアップ表示へ進む

  // 未許可コマンド情報を算出 (Bash のみ)
  // 全サブコマンドが allow にマッチしていればポップアップ不要で自動許可
  // ただし ask にマッチしている場合は自動許可しない
  let unmatchedCommands;
  if (toolName === 'Bash' && command) {
    const { unmatched, hasUnresolvable } = extractUnmatchedCommands(command, perms.allow.bashPatterns);
    if (!isAskListed && unmatched.length === 0 && !hasUnresolvable) {
      process.exit(0);
    }
    unmatchedCommands = { commands: unmatched, hasUnresolvable };
  }

  // Check if app is running
  const isRunning = await healthCheck();
  if (!isRunning) {
    // App not running - fallback to normal dialog
    process.exit(0);
  }

  // Request permission from the app
  try {
    const response = await requestPermission(toolName, toolInput, unmatchedCommands, isAskListed);

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

module.exports = {
  parsePermissionList,
  mergePermissionLists,
  findProjectRoot,
  isBypassPermissions,
  loadPermissionSettings,
  matchesCommandPattern,
  matchesSingleCommand,
  matchesToolPattern,
  stripLeadingEnvVars,
  extractUnmatchedCommands,
  extractCommandsFromAST,
  parseAndExtractCommands,
  initTreeSitter,
};
