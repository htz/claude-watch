import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// permission-hook.js は CommonJS なので require で読み込む
const {
  parsePermissionList,
  mergePermissionLists,
  findProjectRoot,
  loadPermissionSettings,
  matchesCommandPattern,
  matchesToolPattern,
} = require('../src/hooks/permission-hook');

const SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');

// ---------------------------------------------------------------------------
// matchesCommandPattern
// ---------------------------------------------------------------------------
describe('matchesCommandPattern', () => {
  describe('prefix match (pattern:*)', () => {
    const patterns = ['git:*', 'npm:*', 'cat:*'];

    it.each([
      ['git status', true],
      ['git commit -m "msg"', true],
      ['git', true],
      ['npm test', true],
      ['npm run build', true],
      ['cat file.txt', true],
      ['gitx status', false],
      ['npx something', false],
      ['category list', false],
    ])('"%s" → %s', (command, expected) => {
      expect(matchesCommandPattern(command, patterns)).toBe(expected);
    });
  });

  describe('glob match', () => {
    const patterns = ['docker compose *'];

    it.each([
      ['docker compose up', true],
      ['docker compose down -v', true],
      ['docker compose', false],
      ['docker run something', false],
    ])('"%s" → %s', (command, expected) => {
      expect(matchesCommandPattern(command, patterns)).toBe(expected);
    });
  });

  describe('exact match', () => {
    const patterns = ['git status', 'pwd'];

    it.each([
      ['git status', true],
      ['git status --short', true],
      ['pwd', true],
      ['git commit', false],
      ['pwdx', false],
    ])('"%s" → %s', (command, expected) => {
      expect(matchesCommandPattern(command, patterns)).toBe(expected);
    });
  });

  describe('empty patterns', () => {
    it('should return false for any command', () => {
      expect(matchesCommandPattern('ls', [])).toBe(false);
      expect(matchesCommandPattern('git status', [])).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// matchesToolPattern
// ---------------------------------------------------------------------------
describe('matchesToolPattern', () => {
  describe('exact match', () => {
    const patterns = ['Edit', 'Write', 'WebFetch', 'Task'];

    it.each([
      ['Edit', true],
      ['Write', true],
      ['WebFetch', true],
      ['Task', true],
      ['Bash', false],
      ['Read', false],
      ['EditFile', false],
    ])('"%s" → %s', (toolName, expected) => {
      expect(matchesToolPattern(toolName, patterns)).toBe(expected);
    });
  });

  describe('wildcard match', () => {
    const patterns = ['mcp__notion__*', 'mcp__playwright__*'];

    it.each([
      ['mcp__notion__search', true],
      ['mcp__notion__create_page', true],
      ['mcp__playwright__browser_click', true],
      ['mcp__playwright__browser_snapshot', true],
      ['mcp__github__create_issue', false],
      ['mcp__slack__post_message', false],
      ['Edit', false],
    ])('"%s" → %s', (toolName, expected) => {
      expect(matchesToolPattern(toolName, patterns)).toBe(expected);
    });
  });

  describe('mixed patterns', () => {
    const patterns = ['Edit', 'Write', 'mcp__notion__*'];

    it('should match exact and wildcard', () => {
      expect(matchesToolPattern('Edit', patterns)).toBe(true);
      expect(matchesToolPattern('mcp__notion__search', patterns)).toBe(true);
      expect(matchesToolPattern('Bash', patterns)).toBe(false);
    });
  });

  describe('empty patterns', () => {
    it('should return false for any tool', () => {
      expect(matchesToolPattern('Edit', [])).toBe(false);
      expect(matchesToolPattern('mcp__notion__search', [])).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// parsePermissionList
// ---------------------------------------------------------------------------
describe('parsePermissionList', () => {
  it('should separate Bash patterns and tool patterns', () => {
    const result = parsePermissionList([
      'Bash(git:*)',
      'Bash(npm test)',
      'Edit',
      'Write',
      'mcp__notion__*',
    ]);
    expect(result.bashPatterns).toEqual(['git:*', 'npm test']);
    expect(result.toolPatterns).toEqual(['Edit', 'Write', 'mcp__notion__*']);
  });

  it('should return empty arrays for undefined input', () => {
    const result = parsePermissionList(undefined);
    expect(result.bashPatterns).toEqual([]);
    expect(result.toolPatterns).toEqual([]);
  });

  it('should return empty arrays for non-array input', () => {
    const result = parsePermissionList('not an array');
    expect(result.bashPatterns).toEqual([]);
    expect(result.toolPatterns).toEqual([]);
  });

  it('should skip non-string entries', () => {
    const result = parsePermissionList(['Edit', 123, null, 'Bash(ls:*)']);
    expect(result.bashPatterns).toEqual(['ls:*']);
    expect(result.toolPatterns).toEqual(['Edit']);
  });
});

// ---------------------------------------------------------------------------
// mergePermissionLists
// ---------------------------------------------------------------------------
describe('mergePermissionLists', () => {
  it('should concatenate bash and tool patterns', () => {
    const a = { bashPatterns: ['git:*'], toolPatterns: ['Edit'] };
    const b = { bashPatterns: ['npm:*'], toolPatterns: ['Write', 'mcp__x__*'] };
    const result = mergePermissionLists(a, b);
    expect(result.bashPatterns).toEqual(['git:*', 'npm:*']);
    expect(result.toolPatterns).toEqual(['Edit', 'Write', 'mcp__x__*']);
  });

  it('should handle empty lists', () => {
    const empty = { bashPatterns: [], toolPatterns: [] };
    const a = { bashPatterns: ['git:*'], toolPatterns: ['Edit'] };
    expect(mergePermissionLists(empty, a)).toEqual(a);
    expect(mergePermissionLists(a, empty)).toEqual(a);
  });
});

// ---------------------------------------------------------------------------
// findProjectRoot
// ---------------------------------------------------------------------------
describe('findProjectRoot', () => {
  let existsSyncSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    existsSyncSpy = vi.spyOn(fs, 'existsSync');
  });

  afterEach(() => {
    existsSyncSpy.mockRestore();
  });

  it('should find project root when .claude/ exists in cwd', () => {
    existsSyncSpy.mockImplementation((p: string) => {
      return p === path.join('/home/user/project', '.claude');
    });
    expect(findProjectRoot('/home/user/project')).toBe('/home/user/project');
  });

  it('should walk up to find project root', () => {
    existsSyncSpy.mockImplementation((p: string) => {
      return p === path.join('/home/user/project', '.claude');
    });
    expect(findProjectRoot('/home/user/project/src/deep')).toBe('/home/user/project');
  });

  it('should return null when no .claude/ directory is found', () => {
    existsSyncSpy.mockReturnValue(false);
    expect(findProjectRoot('/home/user/project')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// loadPermissionSettings
// ---------------------------------------------------------------------------
describe('loadPermissionSettings', () => {
  let readFileSyncSpy: ReturnType<typeof vi.spyOn>;
  let existsSyncSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    readFileSyncSpy = vi.spyOn(fs, 'readFileSync');
    existsSyncSpy = vi.spyOn(fs, 'existsSync');
  });

  afterEach(() => {
    readFileSyncSpy.mockRestore();
    existsSyncSpy.mockRestore();
  });

  it('should load global settings only when no project root', () => {
    existsSyncSpy.mockReturnValue(false); // no .claude/ found
    readFileSyncSpy.mockImplementation((filePath: string) => {
      if (filePath === SETTINGS_PATH) {
        return JSON.stringify({
          permissions: {
            allow: ['Bash(git:*)', 'Edit'],
            deny: ['Bash(rm -rf /:*)'],
          },
        });
      }
      throw new Error('ENOENT');
    });

    const result = loadPermissionSettings('/tmp/no-project');

    expect(result.allow.bashPatterns).toEqual(['git:*']);
    expect(result.allow.toolPatterns).toEqual(['Edit']);
    expect(result.deny.bashPatterns).toEqual(['rm -rf /:*']);
    expect(result.ask.bashPatterns).toEqual([]);
  });

  it('should merge global and project settings', () => {
    const projectRoot = '/home/user/project';
    existsSyncSpy.mockImplementation((p: string) => {
      return p === path.join(projectRoot, '.claude');
    });

    readFileSyncSpy.mockImplementation((filePath: string) => {
      if (filePath === SETTINGS_PATH) {
        return JSON.stringify({
          permissions: {
            allow: ['Bash(git:*)', 'Edit'],
            deny: ['Bash(rm -rf /:*)'],
          },
        });
      }
      if (filePath === path.join(projectRoot, '.claude', 'settings.json')) {
        return JSON.stringify({
          permissions: {
            allow: ['Bash(npm:*)'],
            deny: ['Bash(sudo:*)'],
          },
        });
      }
      throw new Error('ENOENT');
    });

    const result = loadPermissionSettings(projectRoot);

    // プロジェクト設定の allow は無視される（セキュリティ対策）
    expect(result.allow.bashPatterns).toEqual(['git:*']);
    expect(result.allow.toolPatterns).toEqual(['Edit']);
    expect(result.deny.bashPatterns).toEqual(['rm -rf /:*', 'sudo:*']);
  });

  it('should merge all three settings files', () => {
    const projectRoot = '/home/user/project';
    existsSyncSpy.mockImplementation((p: string) => {
      return p === path.join(projectRoot, '.claude');
    });

    readFileSyncSpy.mockImplementation((filePath: string) => {
      if (filePath === SETTINGS_PATH) {
        return JSON.stringify({
          permissions: { allow: ['Bash(git:*)'] },
        });
      }
      if (filePath === path.join(projectRoot, '.claude', 'settings.json')) {
        return JSON.stringify({
          permissions: { allow: ['Edit'], deny: ['Bash(sudo:*)'] },
        });
      }
      if (filePath === path.join(projectRoot, '.claude', 'settings.local.json')) {
        return JSON.stringify({
          permissions: { allow: ['Bash(npm:*)'], ask: ['Bash(docker:*)'] },
        });
      }
      throw new Error('ENOENT');
    });

    const result = loadPermissionSettings(projectRoot);

    // プロジェクト設定の allow は無視される（セキュリティ対策）
    expect(result.allow.bashPatterns).toEqual(['git:*']);
    expect(result.allow.toolPatterns).toEqual([]);
    expect(result.deny.bashPatterns).toEqual(['sudo:*']);
    expect(result.ask.bashPatterns).toEqual(['docker:*']);
  });

  it('should return empty structures when all files are missing', () => {
    existsSyncSpy.mockReturnValue(false);
    readFileSyncSpy.mockImplementation(() => {
      throw new Error('ENOENT');
    });

    const result = loadPermissionSettings('/tmp/no-project');
    expect(result.allow.bashPatterns).toEqual([]);
    expect(result.allow.toolPatterns).toEqual([]);
    expect(result.deny.bashPatterns).toEqual([]);
    expect(result.deny.toolPatterns).toEqual([]);
    expect(result.ask.bashPatterns).toEqual([]);
    expect(result.ask.toolPatterns).toEqual([]);
  });

  it('should handle project settings with non-Bash deny entries', () => {
    const projectRoot = '/home/user/project';
    existsSyncSpy.mockImplementation((p: string) => {
      return p === path.join(projectRoot, '.claude');
    });

    readFileSyncSpy.mockImplementation((filePath: string) => {
      if (filePath === SETTINGS_PATH) {
        return JSON.stringify({ permissions: {} });
      }
      if (filePath === path.join(projectRoot, '.claude', 'settings.json')) {
        return JSON.stringify({
          permissions: { deny: ['WebFetch', 'mcp__dangerous__*'] },
        });
      }
      throw new Error('ENOENT');
    });

    const result = loadPermissionSettings(projectRoot);
    expect(result.deny.toolPatterns).toEqual(['WebFetch', 'mcp__dangerous__*']);
  });
});
