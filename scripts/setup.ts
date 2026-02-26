#!/usr/bin/env tsx
/**
 * Setup script for claude-watch.
 *
 * Registers hook scripts in ~/.claude/settings.json.
 * Preserves existing hooks and settings.
 *
 * Usage:
 *   npx tsx scripts/setup.ts          — 対話式メニュー
 *   npx tsx scripts/setup.ts --all    — 全フック・全ツール登録
 *   npx tsx scripts/setup.ts --remove — 全フック削除
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import readline from 'readline';

const SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');
const PROJECT_ROOT = path.resolve(__dirname, '..');
const HOOKS_DIR = path.join(PROJECT_ROOT, 'src', 'hooks');

// ---------------------------------------------------------------------------
// Tool options for PreToolUse matcher
// ---------------------------------------------------------------------------
interface ToolOption {
  name: string;   // regex fragment: "Bash", "Edit", "mcp__.+"
  label: string;  // 表示名
}

const TOOL_OPTIONS: ToolOption[] = [
  { name: 'Bash',         label: 'Bash' },
  { name: 'Edit',         label: 'Edit' },
  { name: 'Write',        label: 'Write' },
  { name: 'WebFetch',     label: 'WebFetch' },
  { name: 'NotebookEdit', label: 'NotebookEdit' },
  { name: 'Task',         label: 'Task' },
  { name: 'mcp__.+',      label: 'MCP tools (mcp__)' },
];

// ---------------------------------------------------------------------------
// Hook definitions
// ---------------------------------------------------------------------------
interface HookDef {
  key: string;      // settings.json のキー
  label: string;    // 表示名
  file: string;     // フックスクリプトファイル名
  timeout: number;
  needsMatcher: boolean; // true = ツール選択で matcher を設定
}

const HOOK_DEFS: HookDef[] = [
  { key: 'PreToolUse',   label: 'PreToolUse (パーミッション確認ポップアップ)', file: 'permission-hook.js', timeout: 300, needsMatcher: true },
  { key: 'Notification',  label: 'Notification (タスク通知)',                   file: 'notify-hook.js',     timeout: 10,  needsMatcher: false },
  { key: 'Stop',          label: 'Stop (タスク完了通知)',                       file: 'stop-hook.js',       timeout: 10,  needsMatcher: false },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function getNodePath(): string {
  return process.execPath;
}

function loadSettings(): Record<string, unknown> {
  try {
    const content = fs.readFileSync(SETTINGS_PATH, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

function saveSettings(settings: Record<string, unknown>): void {
  const dir = path.dirname(SETTINGS_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n', { encoding: 'utf-8', mode: 0o600 });
}

interface HookEntry {
  type: string;
  command: string;
  timeout: number;
}

interface HookConfig {
  matcher?: string;
  hooks: HookEntry[];
}

function isOurHook(hookConfig: HookConfig): boolean {
  return hookConfig.hooks.some(
    (h) => typeof h.command === 'string' && h.command.includes('claude-watch')
  );
}

function buildMatcher(tools: ToolOption[]): string {
  const parts = tools.map((t) => t.name);
  return `^(${parts.join('|')})$`;
}

// ---------------------------------------------------------------------------
// readline helper — Enter / y / Y → true, n / N → false
// ---------------------------------------------------------------------------
function ask(rl: readline.Interface, question: string): Promise<boolean> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      const a = answer.trim().toLowerCase();
      resolve(a === '' || a === 'y');
    });
  });
}

// ---------------------------------------------------------------------------
// Remove our hooks from settings (used by --remove and selective skip)
// ---------------------------------------------------------------------------
function removeOurHooks(
  hooks: Record<string, HookConfig[]>,
  keys: string[],
): void {
  for (const key of keys) {
    if (!Array.isArray(hooks[key])) continue;
    hooks[key] = hooks[key].filter((h: HookConfig) => !isOurHook(h));
    // 空配列になったらキーごと削除
    if (hooks[key].length === 0) {
      delete hooks[key];
    }
  }
}

// ---------------------------------------------------------------------------
// Register a single hook
// ---------------------------------------------------------------------------
function registerHook(
  hooks: Record<string, HookConfig[]>,
  def: HookDef,
  nodePath: string,
  matcher?: string,
): void {
  if (!Array.isArray(hooks[def.key])) {
    hooks[def.key] = [];
  }
  // Remove existing claude-watch entry first
  hooks[def.key] = hooks[def.key].filter((h: HookConfig) => !isOurHook(h));

  const entry: HookConfig = {
    hooks: [{
      type: 'command',
      command: `${nodePath} ${path.join(HOOKS_DIR, def.file)}`,
      timeout: def.timeout,
    }],
  };
  if (matcher !== undefined) {
    entry.matcher = matcher;
  }
  hooks[def.key].push(entry);
}

// ---------------------------------------------------------------------------
// Mode: --all
// ---------------------------------------------------------------------------
function runAll(nodePath: string): void {
  const settings = loadSettings();
  if (!settings.hooks || typeof settings.hooks !== 'object') {
    settings.hooks = {};
  }
  const hooks = settings.hooks as Record<string, HookConfig[]>;

  const allMatcher = buildMatcher(TOOL_OPTIONS);
  for (const def of HOOK_DEFS) {
    registerHook(hooks, def, nodePath, def.needsMatcher ? allMatcher : undefined);
  }

  settings.hooks = hooks;
  saveSettings(settings);

  console.log('=== 結果 ===');
  for (const def of HOOK_DEFS) {
    const toolsInfo = def.needsMatcher
      ? ` (${TOOL_OPTIONS.map((t) => t.label).join(', ')})`
      : '';
    console.log(`  ✔ ${def.key.padEnd(14)} → 登録${toolsInfo}`);
  }
  console.log('');
  console.log('全フック・全ツールを登録しました。');
}

// ---------------------------------------------------------------------------
// Mode: --remove
// ---------------------------------------------------------------------------
function runRemove(): void {
  const settings = loadSettings();
  if (!settings.hooks || typeof settings.hooks !== 'object') {
    console.log('フックが見つかりません。何もしません。');
    return;
  }
  const hooks = settings.hooks as Record<string, HookConfig[]>;
  removeOurHooks(hooks, HOOK_DEFS.map((d) => d.key));
  settings.hooks = hooks;
  saveSettings(settings);

  console.log('=== 結果 ===');
  for (const def of HOOK_DEFS) {
    console.log(`  ✗ ${def.key.padEnd(14)} → 削除`);
  }
  console.log('');
  console.log('全フックを削除しました。');
}

// ---------------------------------------------------------------------------
// Mode: interactive
// ---------------------------------------------------------------------------
async function runInteractive(nodePath: string): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    // --- フック選択 ---
    console.log('=== フック選択 ===');
    const hookSelections: Map<string, boolean> = new Map();
    for (let i = 0; i < HOOK_DEFS.length; i++) {
      const def = HOOK_DEFS[i];
      const enabled = await ask(rl, `  [${i + 1}] ${def.label.padEnd(42)} [Y/n]: `);
      hookSelections.set(def.key, enabled);
    }
    console.log('');

    // --- PreToolUse が有効ならツール選択 ---
    let selectedTools: ToolOption[] = [];
    if (hookSelections.get('PreToolUse')) {
      console.log('=== PreToolUse 対象ツール ===');
      for (let i = 0; i < TOOL_OPTIONS.length; i++) {
        const tool = TOOL_OPTIONS[i];
        const enabled = await ask(rl, `  [${i + 1}] ${tool.label.padEnd(20)} [Y/n]: `);
        if (enabled) {
          selectedTools.push(tool);
        }
      }
      console.log('');

      // 少なくとも 1 つ選ばなかった場合、PreToolUse 自体を無効化
      if (selectedTools.length === 0) {
        console.log('  ⚠ ツールが選択されなかったため PreToolUse を無効化します。');
        hookSelections.set('PreToolUse', false);
        console.log('');
      }
    }

    // --- settings.json 更新 ---
    const settings = loadSettings();
    if (!settings.hooks || typeof settings.hooks !== 'object') {
      settings.hooks = {};
    }
    const hooks = settings.hooks as Record<string, HookConfig[]>;

    // 非選択フックの除去
    const disabledKeys = HOOK_DEFS
      .filter((d) => !hookSelections.get(d.key))
      .map((d) => d.key);
    removeOurHooks(hooks, disabledKeys);

    // 選択フックの登録
    for (const def of HOOK_DEFS) {
      if (!hookSelections.get(def.key)) continue;
      const matcher = def.needsMatcher ? buildMatcher(selectedTools) : undefined;
      registerHook(hooks, def, nodePath, matcher);
    }

    settings.hooks = hooks;
    saveSettings(settings);

    // --- 結果表示 ---
    console.log('=== 結果 ===');
    for (const def of HOOK_DEFS) {
      if (hookSelections.get(def.key)) {
        const toolsInfo = def.needsMatcher
          ? ` (${selectedTools.map((t) => t.label).join(', ')})`
          : '';
        console.log(`  ✔ ${def.key.padEnd(14)} → 登録${toolsInfo}`);
      } else {
        console.log(`  ✗ ${def.key.padEnd(14)} → スキップ`);
      }
    }
  } finally {
    rl.close();
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const nodePath = getNodePath();

  console.log('Claude Watch — フックセットアップ');
  console.log('');
  console.log(`Node.js path: ${nodePath}`);
  console.log(`Settings file: ${SETTINGS_PATH}`);
  console.log('');

  // --remove は hook ファイルの存在確認不要
  if (args.includes('--remove')) {
    runRemove();
    return;
  }

  // Verify hook scripts exist
  const hookFiles = HOOK_DEFS.map((d) => d.file);
  for (const file of hookFiles) {
    const filePath = path.join(HOOKS_DIR, file);
    if (!fs.existsSync(filePath)) {
      console.error(`Error: Hook script not found: ${filePath}`);
      process.exit(1);
    }
  }

  if (args.includes('--all')) {
    runAll(nodePath);
  } else {
    await runInteractive(nodePath);
  }

  console.log('');
  console.log('Next steps:');
  console.log('  1. Start the app: npm start');
  console.log('  2. Use Claude Code as usual');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
