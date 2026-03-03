import { describe, expect, it } from 'vitest';

const {
  isOurHook,
  buildMatcher,
  removeOurHooks,
  registerHook,
  TOOL_OPTIONS,
  HOOK_DEFS,
} = require('../src/hooks/setup');

describe('setup.js', () => {
  describe('isOurHook', () => {
    it('should detect our hook by command containing "claude-watch"', () => {
      const hookConfig = {
        hooks: [{ type: 'command', command: '/usr/local/bin/node "/path/to/claude-watch/hooks/permission-hook.js"' }],
      };
      expect(isOurHook(hookConfig)).toBe(true);
    });

    it('should not detect unrelated hooks', () => {
      const hookConfig = {
        hooks: [{ type: 'command', command: 'node /some/other/hook.js' }],
      };
      expect(isOurHook(hookConfig)).toBe(false);
    });

    it('should handle hooks with multiple entries', () => {
      const hookConfig = {
        hooks: [
          { type: 'command', command: 'node /other/hook.js' },
          { type: 'command', command: 'node /path/claude-watch/hooks/notify-hook.js' },
        ],
      };
      expect(isOurHook(hookConfig)).toBe(true);
    });

    it('should handle hooks with no command string', () => {
      const hookConfig = {
        hooks: [{ type: 'url', url: 'https://example.com' }],
      };
      expect(isOurHook(hookConfig)).toBe(false);
    });

    it('should handle hooks with empty array', () => {
      const hookConfig = { hooks: [] };
      expect(isOurHook(hookConfig)).toBe(false);
    });
  });

  describe('buildMatcher', () => {
    it('should build regex pattern from single tool', () => {
      const result = buildMatcher([{ name: 'Bash' }]);
      expect(result).toBe('^(Bash)$');
    });

    it('should build regex pattern from multiple tools', () => {
      const result = buildMatcher([{ name: 'Bash' }, { name: 'Edit' }, { name: 'Write' }]);
      expect(result).toBe('^(Bash|Edit|Write)$');
    });

    it('should handle all TOOL_OPTIONS', () => {
      const result = buildMatcher(TOOL_OPTIONS);
      expect(result).toMatch(/^\^\(/);
      expect(result).toMatch(/\)\$$/);
      expect(result).toContain('Bash');
      expect(result).toContain('Edit');
      expect(result).toContain('mcp__.+');
    });

    it('should produce valid regex', () => {
      const result = buildMatcher(TOOL_OPTIONS);
      const regex = new RegExp(result);
      expect(regex.test('Bash')).toBe(true);
      expect(regex.test('Edit')).toBe(true);
      expect(regex.test('mcp__github__create_issue')).toBe(true);
      expect(regex.test('Read')).toBe(false);
      expect(regex.test('')).toBe(false);
    });
  });

  describe('removeOurHooks', () => {
    it('should remove our hooks from specified keys', () => {
      const hooks = {
        PreToolUse: [
          { hooks: [{ type: 'command', command: 'node /path/claude-watch/hooks/permission-hook.js' }] },
          { hooks: [{ type: 'command', command: 'node /other/hook.js' }] },
        ],
      };
      removeOurHooks(hooks, ['PreToolUse']);
      expect(hooks.PreToolUse).toHaveLength(1);
      expect(hooks.PreToolUse[0].hooks[0].command).toContain('/other/hook.js');
    });

    it('should delete key if all hooks are removed', () => {
      const hooks = {
        Notification: [{ hooks: [{ type: 'command', command: 'node /path/claude-watch/hooks/notify-hook.js' }] }],
      };
      removeOurHooks(hooks, ['Notification']);
      expect(hooks.Notification).toBeUndefined();
    });

    it('should not affect other keys', () => {
      const hooks = {
        PreToolUse: [{ hooks: [{ type: 'command', command: 'node /path/claude-watch/hooks/permission-hook.js' }] }],
        Stop: [{ hooks: [{ type: 'command', command: 'node /other/stop.js' }] }],
      };
      removeOurHooks(hooks, ['PreToolUse']);
      expect(hooks.PreToolUse).toBeUndefined();
      expect(hooks.Stop).toHaveLength(1);
    });

    it('should handle missing keys gracefully', () => {
      const hooks = {};
      expect(() => removeOurHooks(hooks, ['PreToolUse', 'Notification'])).not.toThrow();
    });

    it('should handle non-array values gracefully', () => {
      const hooks = { PreToolUse: 'invalid' };
      expect(() => removeOurHooks(hooks, ['PreToolUse'])).not.toThrow();
    });
  });

  describe('registerHook', () => {
    it('should register a hook with matcher', () => {
      const hooks: Record<string, unknown[]> = {};
      const def = HOOK_DEFS.find((d: { key: string }) => d.key === 'PreToolUse');
      registerHook(hooks, def, '/usr/local/bin/node', '^(Bash|Edit)$');

      expect(hooks.PreToolUse).toHaveLength(1);
      const entry = hooks.PreToolUse[0] as Record<string, unknown>;
      expect(entry.matcher).toBe('^(Bash|Edit)$');
      expect((entry.hooks as { command: string }[])[0].command).toContain('permission-hook.js');
      expect((entry.hooks as { timeout: number }[])[0].timeout).toBe(300);
    });

    it('should register a hook without matcher', () => {
      const hooks: Record<string, unknown[]> = {};
      const def = HOOK_DEFS.find((d: { key: string }) => d.key === 'Notification');
      registerHook(hooks, def, '/usr/local/bin/node', undefined);

      expect(hooks.Notification).toHaveLength(1);
      const entry = hooks.Notification[0] as Record<string, unknown>;
      expect(entry.matcher).toBeUndefined();
      expect((entry.hooks as { command: string }[])[0].command).toContain('notify-hook.js');
    });

    it('should replace existing our hook when re-registering', () => {
      const hooks: Record<string, unknown[]> = {
        Stop: [{ hooks: [{ type: 'command', command: 'node /path/claude-watch/hooks/stop-hook.js' }] }],
      };
      const def = HOOK_DEFS.find((d: { key: string }) => d.key === 'Stop');
      registerHook(hooks, def, '/usr/local/bin/node', undefined);

      expect(hooks.Stop).toHaveLength(1);
      expect((hooks.Stop[0] as Record<string, unknown>).hooks).toBeDefined();
    });

    it('should preserve third-party hooks when registering', () => {
      const hooks: Record<string, unknown[]> = {
        PreToolUse: [{ hooks: [{ type: 'command', command: 'node /third-party/hook.js' }] }],
      };
      const def = HOOK_DEFS.find((d: { key: string }) => d.key === 'PreToolUse');
      registerHook(hooks, def, '/usr/local/bin/node', '^(Bash)$');

      expect(hooks.PreToolUse).toHaveLength(2);
    });

    it('should create hooks array if key does not exist', () => {
      const hooks: Record<string, unknown[]> = {};
      const def = HOOK_DEFS.find((d: { key: string }) => d.key === 'Stop');
      registerHook(hooks, def, '/usr/local/bin/node', undefined);

      expect(Array.isArray(hooks.Stop)).toBe(true);
      expect(hooks.Stop).toHaveLength(1);
    });
  });

  describe('HOOK_DEFS', () => {
    it('should define all three hook types', () => {
      const keys = HOOK_DEFS.map((d: { key: string }) => d.key);
      expect(keys).toContain('PreToolUse');
      expect(keys).toContain('Notification');
      expect(keys).toContain('Stop');
    });

    it('should have correct file names', () => {
      const fileMap: Record<string, string> = {};
      for (const def of HOOK_DEFS) {
        fileMap[def.key] = def.file;
      }
      expect(fileMap.PreToolUse).toBe('permission-hook.js');
      expect(fileMap.Notification).toBe('notify-hook.js');
      expect(fileMap.Stop).toBe('stop-hook.js');
    });

    it('should set needsMatcher only for PreToolUse', () => {
      for (const def of HOOK_DEFS) {
        if (def.key === 'PreToolUse') {
          expect(def.needsMatcher).toBe(true);
        } else {
          expect(def.needsMatcher).toBe(false);
        }
      }
    });

    it('should have appropriate timeouts', () => {
      for (const def of HOOK_DEFS) {
        if (def.key === 'PreToolUse') {
          expect(def.timeout).toBe(300);
        } else {
          expect(def.timeout).toBe(10);
        }
      }
    });
  });

  describe('TOOL_OPTIONS', () => {
    it('should include standard tool names', () => {
      const names = TOOL_OPTIONS.map((o: { name: string }) => o.name);
      expect(names).toContain('Bash');
      expect(names).toContain('Edit');
      expect(names).toContain('Write');
      expect(names).toContain('WebFetch');
      expect(names).toContain('NotebookEdit');
      expect(names).toContain('Task');
    });

    it('should include MCP regex pattern', () => {
      const names = TOOL_OPTIONS.map((o: { name: string }) => o.name);
      expect(names).toContain('mcp__.+');
    });
  });
});
