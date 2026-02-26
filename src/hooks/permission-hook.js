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

  // プロジェクト設定のマージ
  const projectRoot = findProjectRoot(cwd || process.cwd());
  if (projectRoot) {
    // settings.json (Git 管理): deny/ask のみ（悪意あるリポジトリ対策で allow は無視）
    const projectSettingsPath = path.join(projectRoot, '.claude', 'settings.json');
    const projectPerms = readSettingsFile(projectSettingsPath);
    if (projectPerms) {
      for (const key of ['deny', 'ask']) {
        if (projectPerms[key]) {
          result[key] = mergePermissionLists(result[key], parsePermissionList(projectPerms[key]));
        }
      }
    }

    // settings.local.json (ローカル専用、Git 非管理): allow/deny/ask 全てマージ
    // ユーザーが手動または Claude Code の「このプロジェクトで常に許可」で作成するファイル
    const localSettingsPath = path.join(projectRoot, '.claude', 'settings.local.json');
    const localPerms = readSettingsFile(localSettingsPath);
    if (localPerms) {
      for (const key of ['allow', 'deny', 'ask']) {
        if (localPerms[key]) {
          result[key] = mergePermissionLists(result[key], parsePermissionList(localPerms[key]));
        }
      }
    }
  }

  return result;
}

/**
 * シェルの構文状態（クォート・$() 深さ）を行単位で更新する。
 * 複数行にまたがるダブルクォート・シングルクォート・$() を追跡し、
 * extractCommandLines で行を正しく結合するために使用する。
 *
 * @param {string} line - 解析対象の行
 * @param {{ subshellDepth: number, inDoubleQuote: boolean, inSingleQuote: boolean }} state
 * @returns {{ subshellDepth: number, inDoubleQuote: boolean, inSingleQuote: boolean }}
 */
function updateShellState(line, state) {
  let { subshellDepth, inDoubleQuote, inSingleQuote } = state;
  let i = 0;

  while (i < line.length) {
    const ch = line[i];

    if (inSingleQuote) {
      if (ch === "'") inSingleQuote = false;
      i++;
      continue;
    }

    if (inDoubleQuote) {
      if (ch === '\\' && i + 1 < line.length) {
        i += 2;
        continue;
      }
      if (ch === '"') {
        inDoubleQuote = false;
        i++;
        continue;
      }
      if (ch === '$' && i + 1 < line.length && line[i + 1] === '(') {
        subshellDepth++;
        i += 2;
        continue;
      }
      if (ch === ')' && subshellDepth > 0) {
        subshellDepth--;
        i++;
        continue;
      }
      i++;
      continue;
    }

    // 通常モード
    if (ch === '\\' && i + 1 < line.length) {
      i += 2;
      continue;
    }
    if (ch === "'") {
      inSingleQuote = true;
      i++;
      continue;
    }
    if (ch === '"') {
      inDoubleQuote = true;
      i++;
      continue;
    }
    if (ch === '$' && i + 1 < line.length && line[i + 1] === '(') {
      subshellDepth++;
      i += 2;
      continue;
    }
    if (ch === ')' && subshellDepth > 0) {
      subshellDepth--;
      i++;
      continue;
    }

    i++;
  }

  return { subshellDepth, inDoubleQuote, inSingleQuote };
}

/**
 * 複数行コマンドから実際のコマンド行を抽出する。
 * - ヒアドキュメント (<< MARKER ... MARKER) の内容をスキップ
 * - 行継続 (末尾 \) を結合
 * - $() が複数行にまたがる場合は結合（ヒアドキュメント内を含む）
 * - 空行を除去
 */
function extractCommandLines(fullCommand) {
  const rawLines = fullCommand.split('\n');
  const commands = [];
  let heredocDelimiter = null;
  let continuationBuffer = '';
  let shellState = { subshellDepth: 0, inDoubleQuote: false, inSingleQuote: false };

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

    // 行継続・クォート継続・サブシェル継続の結合
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
    const needsContinuation = shellState.subshellDepth > 0 || shellState.inDoubleQuote || shellState.inSingleQuote;

    if (!completeLine) {
      if (!needsContinuation) continuationBuffer = '';
      continue;
    }

    // ヒアドキュメント開始を検出 (<<, <<-, 引用符付きデリミタ)
    // 継続中は raw line のみ検査（バッファ内の << の再検出を防止）
    const heredocSource = needsContinuation ? line : completeLine;
    const heredocMatches = [...heredocSource.matchAll(/<<-?\s*\\?['"]?(\w+)['"]?/g)];
    if (heredocMatches.length > 0) {
      heredocDelimiter = heredocMatches[heredocMatches.length - 1][1];
    }

    // シェル構文状態を更新（raw line 単位で判定）
    shellState = updateShellState(line, shellState);

    // 未閉じのクォートや $() がある場合は次の行と結合するため継続
    if (shellState.subshellDepth > 0 || shellState.inDoubleQuote || shellState.inSingleQuote) continue;

    // 行を確定
    commands.push(completeLine);
    continuationBuffer = '';
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
  let hasNonCommentTokens = false;

  for (const token of tokens) {
    // コメントトークン {comment: "..."} → スキップ
    if (typeof token === 'object' && token !== null && 'comment' in token) {
      continue;
    }

    hasNonCommentTokens = true;

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
  }

  if (current.length > 0) {
    commands.push(current.join(' '));
  }

  // コメントのみの入力 → 空配列 (コマンドなし)
  if (!hasNonCommentTokens) return [];

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
 * 文字列トークン内の $(...) をバランスド括弧で抽出する。
 * ダブルクォート内に埋め込まれた $() に対応 (shell-quote は文字列として返す)。
 */
function extractDollarParenFromString(str) {
  const results = [];
  let i = 0;
  while (i < str.length) {
    if (str[i] === '$' && i + 1 < str.length && str[i + 1] === '(') {
      let depth = 1;
      let j = i + 2;
      while (j < str.length && depth > 0) {
        if (str[j] === '(') depth++;
        else if (str[j] === ')') depth--;
        j++;
      }
      if (depth === 0) {
        results.push(str.slice(i + 2, j - 1));
      }
      i = j;
    } else {
      i++;
    }
  }
  return results;
}

/**
 * トークンが変数代入 (VAR=value) かどうか判定する。
 * shell-quote はクォートを除去済みなので、文字列トークンの先頭が \w+= であれば代入。
 */
function isAssignmentToken(token) {
  return typeof token === 'string' && /^\w+=/.test(token);
}

/**
 * current トークン配列から先頭の変数代入トークンを除去し、コマンド文字列を返す。
 * 全てが代入の場合は null を返す（純粋な変数代入行）。
 *
 * 例: ['FOO=bar', 'npm', 'test'] → 'npm test'
 *     ['MARKER=/tmp/foo']        → null
 */
function buildCommandFromTokens(currentTokens) {
  let start = 0;
  while (start < currentTokens.length && /^\w+=/.test(currentTokens[start])) {
    start++;
  }
  if (start >= currentTokens.length) return null; // 純粋な変数代入
  return currentTokens.slice(start).join(' ');
}

/**
 * shell-quote トークン配列から全サブコマンドを再帰的に抽出する (内部用)。
 * - 演算子 (&&, ||, ;, |, &) で分割
 * - 先頭の変数代入トークン (VAR=value) を除去してコマンドのみ抽出
 * - 非クォート $() のトークン列から内部コマンドを再帰的に抽出
 * - 文字列トークン内の $() (ダブルクォート内) も抽出
 * - バッククォートは解決不能 (hasUnresolvable)
 */
function extractFromTokens(tokens) {
  const result = { commands: [], hasUnresolvable: false };
  let current = [];
  let i = 0;
  let hasNonCommentTokens = false;
  // shell-quote がネスト $() を誤パースした場合の代入値残骸をスキップするフラグ。
  // VAR="...-$(... "$(inner)"... )" のように、shell-quote がダブルクォート境界を
  // 誤認識し、代入値の一部を別トークンとして分離してしまうケースに対応。
  let inAssignmentValue = false;

  /** current を1コマンドとして確定し、代入トークンを除去して result に追加 */
  function flushCurrent() {
    if (current.length === 0) return;
    const cmd = buildCommandFromTokens(current);
    if (cmd && cmd.trim()) {
      result.commands.push(cmd);
    }
    current = [];
  }

  while (i < tokens.length) {
    const token = tokens[i];

    // コメントトークン → スキップ
    if (typeof token === 'object' && token !== null && 'comment' in token) {
      i++;
      continue;
    }

    hasNonCommentTokens = true;

    // コマンド区切り演算子 → ここまでを1コマンドとして確定、代入コンテキスト終了
    if (typeof token === 'object' && token !== null && token.op && COMMAND_SEPARATORS.has(token.op)) {
      inAssignmentValue = false;
      flushCurrent();
      i++;
      continue;
    }

    // 代入値の残骸スキップ: shell-quote の誤パースで分離されたトークン
    if (inAssignmentValue) {
      // トークン内の $() からはコマンドを抽出（ベストエフォート）
      if (typeof token === 'string') {
        if (token.includes('`')) result.hasUnresolvable = true;
        if (/\$\(/.test(token)) {
          const extracted = extractDollarParenFromString(token);
          for (const cmd of extracted) {
            const nested = extractAllSubCommands(cmd);
            result.commands.push(...nested.commands);
            if (nested.hasUnresolvable) result.hasUnresolvable = true;
          }
        }
      }
      i++;
      continue;
    }

    // 非クォート $() / $((): "$" or "prefix$" トークン + {op: "("} で開始
    // VAR=$() 形式では "VAR=$" トークンになるため endsWith('$') で検出
    if (typeof token === 'string' && token.endsWith('$') &&
        i + 1 < tokens.length &&
        typeof tokens[i + 1] === 'object' && tokens[i + 1] !== null && tokens[i + 1].op === '(') {
      const isAssignment = isAssignmentToken(token);

      // $ より前のプレフィックスを判定 ($() と $(( で共通)
      if (token !== '$') {
        const prefix = token.slice(0, -1);
        // 変数代入プレフィックス (MARKER=, FOO=bar-) はコマンドではないため除外
        // コマンドプレフィックス (echo 等) は保持
        if (prefix && !isAssignment) {
          current.push(prefix);
        }
      }

      // $(( 算術展開の検出: $( の直後にさらに ( があれば $(( でありコマンド置換ではない
      // 例: echo $((1+2)), VAR=$((x*3))
      if (i + 2 < tokens.length &&
          typeof tokens[i + 2] === 'object' && tokens[i + 2] !== null && tokens[i + 2].op === '(') {
        // 算術展開はコマンドを含まない — )) まで読み飛ばし
        let depth = 1;
        let j = i + 2;
        while (j < tokens.length && depth > 0) {
          const t = tokens[j];
          if (typeof t === 'object' && t !== null && t.op === '(') depth++;
          else if (typeof t === 'object' && t !== null && t.op === ')') {
            depth--;
            if (depth === 0) break;
          }
          j++;
        }
        i = j + 1;
        continue;
      }

      // 通常の $() コマンド置換 — 内部コマンドを再帰抽出
      let depth = 1;
      let j = i + 2;
      const innerTokens = [];
      while (j < tokens.length && depth > 0) {
        const t = tokens[j];
        if (typeof t === 'object' && t !== null && t.op === '(') depth++;
        else if (typeof t === 'object' && t !== null && t.op === ')') {
          depth--;
          if (depth === 0) break;
        }
        if (depth > 0) innerTokens.push(t);
        j++;
      }

      if (innerTokens.length > 0) {
        const nested = extractFromTokens(innerTokens);
        result.commands.push(...nested.commands);
        if (nested.hasUnresolvable) result.hasUnresolvable = true;
      }

      // shell-quote が代入トークン内の $() をネスト誤パースしている場合、
      // 閉じ括弧後の残骸トークンをスキップする。
      // 判定: 代入トークンの値部分に literal $( が含まれている
      // (例: "MARKER=prefix-$(echo -n $" の "prefix-$(echo -n " 部分)
      if (isAssignment && /\$\(/.test(token.slice(0, -1))) {
        inAssignmentValue = true;
      }

      i = j + 1;
      continue;
    }

    // 文字列トークン
    if (typeof token === 'string') {
      // バッククォート検出
      if (token.includes('`')) result.hasUnresolvable = true;

      // ダブルクォート内の $() (文字列に埋め込まれた形)
      if (/\$\(/.test(token) && token !== '$') {
        const extracted = extractDollarParenFromString(token);
        for (const cmd of extracted) {
          const nested = extractAllSubCommands(cmd);
          result.commands.push(...nested.commands);
          if (nested.hasUnresolvable) result.hasUnresolvable = true;
        }
      }

      current.push(token);
      i++;
      continue;
    }

    // グロブパターン
    if (typeof token === 'object' && token !== null && token.pattern) {
      current.push(token.pattern);
      i++;
      continue;
    }

    // その他の演算子
    if (typeof token === 'object' && token !== null && token.op) {
      // サブシェル括弧 ( ) はコマンドではなくグルーピング — 透過的にスキップ
      // 例: (echo hello) → echo hello, node -e console.log(1) → node -e console.log 1
      if (token.op === '(' || token.op === ')') {
        i++;
        continue;
      }
      // リダイレクト (>, <, >> 等) はコマンドの一部として保持
      current.push(token.op);
      i++;
      continue;
    }

    i++;
  }

  flushCurrent();

  // コメントのみ → 空
  if (!hasNonCommentTokens) {
    result.commands = [];
  }

  return result;
}

/**
 * コマンド文字列から全サブコマンドを再帰的に抽出する。
 * 演算子分割、$() 内部コマンド抽出、コメント除去を統合的に処理する。
 *
 * @returns {{ commands: string[], hasUnresolvable: boolean }}
 *   commands: 抽出された全サブコマンド (外部コマンド + $() 内部コマンド)
 *   hasUnresolvable: バッククォート等、静的解析不能な置換を含む場合 true
 */
function extractAllSubCommands(line) {
  if (!shellParse) {
    return { commands: [line], hasUnresolvable: false };
  }

  let tokens;
  try {
    tokens = shellParse(line, NO_EXPAND_ENV);
  } catch {
    return { commands: [line], hasUnresolvable: true };
  }

  return extractFromTokens(tokens);
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
 *   4. extractAllSubCommands (演算子分割 + $() 再帰展開)
 *   5. パターン照合
 *
 * @param {string} command - Bash コマンド文字列
 * @param {string[]} patterns - パターンリスト
 * @param {'all'|'any'} mode
 *   - 'all': 全サブコマンド ($() 内含む) がマッチした場合 true (allow 用)
 *            バッククォート等の解決不能な置換を含む場合は false
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

  // 全サブコマンドを抽出 ($() 内も再帰的に展開)
  const allSubCommands = [];
  let hasUnresolvable = false;

  for (const line of lines) {
    if (isPureAssignment(line)) continue;

    const extracted = extractAllSubCommands(line);
    if (extracted.hasUnresolvable) hasUnresolvable = true;

    for (const cmd of extracted.commands) {
      const trimmed = cmd.trim();
      if (trimmed && !isPureAssignment(trimmed)) {
        allSubCommands.push(trimmed);
      }
    }
  }

  if (allSubCommands.length === 0) return false;

  // allow 用: バッククォート等の解決不能な置換がある場合は安全側に拒否
  if (mode !== 'any' && hasUnresolvable) return false;

  if (mode === 'any') {
    // deny 用: いずれかがマッチすれば true
    return allSubCommands.some(cmd => matchesSingleCommand(cmd, patterns));
  }

  return allSubCommands.every(cmd => matchesSingleCommand(cmd, patterns));
}

/**
 * Bash コマンドから allow パターンにマッチしないサブコマンドを抽出する。
 * matchesCommandPattern と同じパイプライン（extractCommandLines → normalizeShellLine → extractAllSubCommands）を使用。
 *
 * @param {string} command - Bash コマンド文字列
 * @param {string[]} allowPatterns - allow リストの Bash パターン
 * @returns {{ unmatched: string[], hasUnresolvable: boolean }}
 */
function extractUnmatchedCommands(command, allowPatterns) {
  // コマンド行を抽出・正規化
  let lines;
  if (command.includes('\n')) {
    lines = extractCommandLines(command)
      .map(cmd => normalizeShellLine(cmd))
      .filter(cmd => cmd !== null);
  } else {
    lines = [command];
  }

  // 全サブコマンドを抽出 ($() 内も再帰的に展開)
  const allSubCommands = [];
  let hasUnresolvable = false;

  for (const line of lines) {
    if (isPureAssignment(line)) continue;

    const extracted = extractAllSubCommands(line);
    if (extracted.hasUnresolvable) hasUnresolvable = true;

    for (const cmd of extracted.commands) {
      const trimmed = cmd.trim();
      if (trimmed && !isPureAssignment(trimmed)) {
        allSubCommands.push(trimmed);
      }
    }
  }

  // マッチしないサブコマンドを収集
  const unmatched = allSubCommands.filter(cmd => !matchesSingleCommand(cmd, allowPatterns));

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

  // ask リストマッチ判定 (deny → ask → allow の順で評価)
  const isAskListed = toolName === 'Bash'
    ? matchesCommandPattern(command, perms.ask.bashPatterns, 'any')
    : matchesToolPattern(toolName, perms.ask.toolPatterns);

  // ask にマッチしなかった場合のみ allow を評価
  if (!isAskListed) {
    // allow リスト → exit(0) で Claude 本体にフォールスルー (ポップアップ不要)
    const isAllowed = toolName === 'Bash'
      ? matchesCommandPattern(command, perms.allow.bashPatterns)
      : matchesToolPattern(toolName, perms.allow.toolPatterns);

    if (isAllowed) process.exit(0);
  }

  // ask リスト、またはどのリストにも含まれない → ポップアップ表示へ進む

  // 未許可コマンド情報を算出 (Bash のみ)
  // 全サブコマンドが allow にマッチしていればポップアップ不要で自動許可
  // ただし ask にマッチしている場合は自動許可しない
  let unmatchedCommands = undefined;
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

module.exports = { parsePermissionList, mergePermissionLists, findProjectRoot, loadPermissionSettings, matchesCommandPattern, matchesSingleCommand, extractCommandLines, matchesToolPattern, stripLeadingEnvVars, isPureAssignment, normalizeShellLine, splitOnOperators, containsCommandSubstitution, extractAllSubCommands, extractDollarParenFromString, extractUnmatchedCommands, updateShellState, isAssignmentToken, buildCommandFromTokens };
