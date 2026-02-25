#!/usr/bin/env tsx
/**
 * Setup script for claude-code-notifier.
 *
 * Registers hook scripts in ~/.claude/settings.json.
 * Preserves existing hooks and settings.
 *
 * Usage: npm run setup
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';

const SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');
const PROJECT_ROOT = path.resolve(__dirname, '..');
const HOOKS_DIR = path.join(PROJECT_ROOT, 'src', 'hooks');

function getNodePath(): string {
  try {
    const nodePath = execSync('which node', { encoding: 'utf-8' }).trim();
    return nodePath;
  } catch {
    return 'node';
  }
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
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
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
    (h) => typeof h.command === 'string' && h.command.includes('claude-code-notifier')
  );
}

function main(): void {
  const nodePath = getNodePath();
  console.log(`Node.js path: ${nodePath}`);
  console.log(`Hooks directory: ${HOOKS_DIR}`);
  console.log(`Settings file: ${SETTINGS_PATH}`);
  console.log('');

  // Verify hook scripts exist
  const hookFiles = ['permission-hook.js', 'notify-hook.js', 'stop-hook.js'];
  for (const file of hookFiles) {
    const filePath = path.join(HOOKS_DIR, file);
    if (!fs.existsSync(filePath)) {
      console.error(`Error: Hook script not found: ${filePath}`);
      process.exit(1);
    }
  }

  const settings = loadSettings();

  // Initialize hooks object if needed
  if (!settings.hooks || typeof settings.hooks !== 'object') {
    settings.hooks = {};
  }
  const hooks = settings.hooks as Record<string, HookConfig[]>;

  // --- PreToolUse hook (permission) ---
  if (!Array.isArray(hooks.PreToolUse)) {
    hooks.PreToolUse = [];
  }
  // Remove existing notifier hooks
  hooks.PreToolUse = hooks.PreToolUse.filter((h: HookConfig) => !isOurHook(h));
  // Add our hook
  hooks.PreToolUse.push({
    matcher: 'Bash',
    hooks: [{
      type: 'command',
      command: `${nodePath} ${path.join(HOOKS_DIR, 'permission-hook.js')}`,
      timeout: 300,
    }],
  });

  // --- Notification hook ---
  if (!Array.isArray(hooks.Notification)) {
    hooks.Notification = [];
  }
  hooks.Notification = hooks.Notification.filter((h: HookConfig) => !isOurHook(h));
  hooks.Notification.push({
    matcher: '',
    hooks: [{
      type: 'command',
      command: `${nodePath} ${path.join(HOOKS_DIR, 'notify-hook.js')}`,
      timeout: 10,
    }],
  });

  // --- Stop hook ---
  if (!Array.isArray(hooks.Stop)) {
    hooks.Stop = [];
  }
  hooks.Stop = hooks.Stop.filter((h: HookConfig) => !isOurHook(h));
  hooks.Stop.push({
    hooks: [{
      type: 'command',
      command: `${nodePath} ${path.join(HOOKS_DIR, 'stop-hook.js')}`,
      timeout: 10,
    }],
  });

  settings.hooks = hooks;
  saveSettings(settings);

  console.log('Hooks registered successfully!');
  console.log('');
  console.log('Registered hooks:');
  console.log(`  PreToolUse (Bash): ${path.join(HOOKS_DIR, 'permission-hook.js')}`);
  console.log(`  Notification:      ${path.join(HOOKS_DIR, 'notify-hook.js')}`);
  console.log(`  Stop:              ${path.join(HOOKS_DIR, 'stop-hook.js')}`);
  console.log('');
  console.log('Next steps:');
  console.log('  1. Start the notifier app: npm start');
  console.log('  2. Use Claude Code as usual');
  console.log('  3. Permission popups will appear in the menu bar');
}

main();
