#!/usr/bin/env node
/**
 * Claude Watch — フックセットアップ
 *
 * ~/.claude/settings.json にフックスクリプトを登録する。
 * アプリバンドル内 (/Applications/Claude Watch.app/Contents/Resources/hooks/) からも
 * 開発ディレクトリ (src/hooks/) からも動作する。
 *
 * Usage:
 *   node setup.js          — 対話式メニュー
 *   node setup.js --all    — 全フック・全ツール登録
 *   node setup.js --remove — 全フック削除
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');

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

const SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');
// setup.js と同じディレクトリにフックスクリプトがある
const HOOKS_DIR = __dirname;

// ---------------------------------------------------------------------------
// Tool options for PreToolUse matcher
// ---------------------------------------------------------------------------
const TOOL_OPTIONS = [
  { name: 'Bash', label: 'Bash' },
  { name: 'Edit', label: 'Edit' },
  { name: 'Write', label: 'Write' },
  { name: 'WebFetch', label: 'WebFetch' },
  { name: 'NotebookEdit', label: 'NotebookEdit' },
  { name: 'Task', label: 'Task' },
  { name: 'mcp__.+', label: 'MCP tools (mcp__)' },
];

// ---------------------------------------------------------------------------
// Hook definitions
// ---------------------------------------------------------------------------
const HOOK_DEFS = [
  {
    key: 'PreToolUse',
    labelKey: 'setup.hook.preToolUse',
    file: 'permission-hook.js',
    timeout: 300,
    needsMatcher: true,
  },
  {
    key: 'Notification',
    labelKey: 'setup.hook.notification',
    file: 'notify-hook.js',
    timeout: 10,
    needsMatcher: false,
  },
  { key: 'Stop', labelKey: 'setup.hook.stop', file: 'stop-hook.js', timeout: 10, needsMatcher: false },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function getNodePath() {
  return process.execPath;
}

function loadSettings() {
  try {
    const content = fs.readFileSync(SETTINGS_PATH, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

function saveSettings(settings) {
  const dir = path.dirname(SETTINGS_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  fs.writeFileSync(SETTINGS_PATH, `${JSON.stringify(settings, null, 2)}\n`, { encoding: 'utf-8', mode: 0o600 });
}

function isOurHook(hookConfig) {
  return hookConfig.hooks.some((h) => typeof h.command === 'string' && h.command.includes('claude-watch'));
}

function buildMatcher(tools) {
  const parts = tools.map((t) => t.name);
  return `^(${parts.join('|')})$`;
}

// ---------------------------------------------------------------------------
// readline helper — Enter / y / Y → true, n / N → false
// ---------------------------------------------------------------------------
function ask(rl, question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      const a = answer.trim().toLowerCase();
      resolve(a === '' || a === 'y');
    });
  });
}

// ---------------------------------------------------------------------------
// Remove our hooks from settings
// ---------------------------------------------------------------------------
function removeOurHooks(hooks, keys) {
  for (const key of keys) {
    if (!Array.isArray(hooks[key])) continue;
    hooks[key] = hooks[key].filter((h) => !isOurHook(h));
    if (hooks[key].length === 0) {
      delete hooks[key];
    }
  }
}

// ---------------------------------------------------------------------------
// Register a single hook
// ---------------------------------------------------------------------------
function registerHook(hooks, def, nodePath, matcher) {
  if (!Array.isArray(hooks[def.key])) {
    hooks[def.key] = [];
  }
  hooks[def.key] = hooks[def.key].filter((h) => !isOurHook(h));

  const hookPath = path.join(HOOKS_DIR, def.file);
  const entry = {
    hooks: [
      {
        type: 'command',
        command: `${nodePath} "${hookPath}"`,
        timeout: def.timeout,
      },
    ],
  };
  if (matcher !== undefined) {
    entry.matcher = matcher;
  }
  hooks[def.key].push(entry);
}

// ---------------------------------------------------------------------------
// Mode: --all
// ---------------------------------------------------------------------------
function runAll(nodePath) {
  const settings = loadSettings();
  if (!settings.hooks || typeof settings.hooks !== 'object') {
    settings.hooks = {};
  }
  const hooks = settings.hooks;

  const allMatcher = buildMatcher(TOOL_OPTIONS);
  for (const def of HOOK_DEFS) {
    registerHook(hooks, def, nodePath, def.needsMatcher ? allMatcher : undefined);
  }

  settings.hooks = hooks;
  saveSettings(settings);

  console.log(t('setup.result'));
  for (const def of HOOK_DEFS) {
    const toolsInfo = def.needsMatcher ? ` (${TOOL_OPTIONS.map((o) => o.label).join(', ')})` : '';
    console.log(`  ✔ ${def.key.padEnd(14)} → ${t('setup.registered')}${toolsInfo}`);
  }
  console.log('');
  console.log(t('setup.allRegistered'));
}

// ---------------------------------------------------------------------------
// Mode: --remove
// ---------------------------------------------------------------------------
function runRemove() {
  const settings = loadSettings();
  if (!settings.hooks || typeof settings.hooks !== 'object') {
    console.log(t('setup.noHooksFound'));
    return;
  }
  const hooks = settings.hooks;
  removeOurHooks(
    hooks,
    HOOK_DEFS.map((d) => d.key),
  );
  settings.hooks = hooks;
  saveSettings(settings);

  console.log(t('setup.result'));
  for (const def of HOOK_DEFS) {
    console.log(`  ✗ ${def.key.padEnd(14)} → ${t('setup.removed')}`);
  }
  console.log('');
  console.log(t('setup.allRemoved'));
}

// ---------------------------------------------------------------------------
// Mode: interactive
// ---------------------------------------------------------------------------
async function runInteractive(nodePath) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    console.log(t('setup.hookSelect'));
    const hookSelections = new Map();
    for (let i = 0; i < HOOK_DEFS.length; i++) {
      const def = HOOK_DEFS[i];
      const enabled = await ask(rl, `  [${i + 1}] ${t(def.labelKey).padEnd(42)} [Y/n]: `);
      hookSelections.set(def.key, enabled);
    }
    console.log('');

    let selectedTools = [];
    if (hookSelections.get('PreToolUse')) {
      console.log(t('setup.toolSelect'));
      for (let i = 0; i < TOOL_OPTIONS.length; i++) {
        const tool = TOOL_OPTIONS[i];
        const enabled = await ask(rl, `  [${i + 1}] ${tool.label.padEnd(20)} [Y/n]: `);
        if (enabled) {
          selectedTools.push(tool);
        }
      }
      console.log('');

      if (selectedTools.length === 0) {
        console.log(`  ${t('setup.noToolWarning')}`);
        hookSelections.set('PreToolUse', false);
        console.log('');
      }
    }

    const settings = loadSettings();
    if (!settings.hooks || typeof settings.hooks !== 'object') {
      settings.hooks = {};
    }
    const hooks = settings.hooks;

    const disabledKeys = HOOK_DEFS.filter((d) => !hookSelections.get(d.key)).map((d) => d.key);
    removeOurHooks(hooks, disabledKeys);

    for (const def of HOOK_DEFS) {
      if (!hookSelections.get(def.key)) continue;
      const matcher = def.needsMatcher ? buildMatcher(selectedTools) : undefined;
      registerHook(hooks, def, nodePath, matcher);
    }

    settings.hooks = hooks;
    saveSettings(settings);

    console.log(t('setup.result'));
    for (const def of HOOK_DEFS) {
      if (hookSelections.get(def.key)) {
        const toolsInfo = def.needsMatcher ? ` (${selectedTools.map((o) => o.label).join(', ')})` : '';
        console.log(`  ✔ ${def.key.padEnd(14)} → ${t('setup.registered')}${toolsInfo}`);
      } else {
        console.log(`  ✗ ${def.key.padEnd(14)} → ${t('setup.skipped')}`);
      }
    }
  } finally {
    rl.close();
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2);
  const nodePath = getNodePath();

  console.log(t('setup.title'));
  console.log('');
  console.log(`Node.js path: ${nodePath}`);
  console.log(`Hooks dir:    ${HOOKS_DIR}`);
  console.log(`Settings:     ${SETTINGS_PATH}`);
  console.log('');

  if (args.includes('--remove')) {
    runRemove();
    return;
  }

  // Verify hook scripts exist
  for (const def of HOOK_DEFS) {
    const filePath = path.join(HOOKS_DIR, def.file);
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
  console.log(t('setup.nextSteps'));
  console.log(`  ${t('setup.step1')}`);
  console.log(`  ${t('setup.step2')}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
