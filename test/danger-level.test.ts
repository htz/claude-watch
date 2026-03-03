import { beforeAll, describe, expect, it } from 'vitest';
import { setLocale } from '../src/i18n/index';
import {
  analyzeCommand,
  analyzeDangerLevel,
  analyzeToolDanger,
  elevateToMinimum,
  getDangerInfo,
} from '../src/shared/danger-level';

describe('analyzeDangerLevel', () => {
  describe('SAFE commands', () => {
    it.each([
      'ls',
      'ls -la',
      'cat file.txt',
      'head -n 10 file.txt',
      'tail -f log.txt',
      'pwd',
      'git status',
      'git log --oneline',
      'git diff HEAD',
      'git show HEAD',
      'git branch',
      'git branch -v',
      'git remote -v',
      'echo hello',
      'which node',
      'whoami',
      'date',
      'env',
      'printenv',
      'npm list',
      'npm ls',
      'npm view express',
      'npm info react',
      'npm outdated',
    ])('should classify "%s" as SAFE', (cmd) => {
      expect(analyzeDangerLevel(cmd)).toBe('SAFE');
    });
  });

  describe('LOW commands', () => {
    it.each([
      'npm test',
      'npm run test',
      'yarn test',
      'pnpm test',
      'vitest',
      'jest',
      'pytest',
      'npm run build',
      'npm run lint',
      'git add .',
      'git add file.txt',
      'git checkout -b feature',
      'git switch main',
      'find . -name "*.ts"',
      'grep -r pattern .',
      'rg pattern',
      'tree',
      'wc -l file.txt',
      'diff a.txt b.txt',
    ])('should classify "%s" as LOW', (cmd) => {
      expect(analyzeDangerLevel(cmd)).toBe('LOW');
    });
  });

  describe('MEDIUM commands', () => {
    it.each([
      'npm install',
      'npm install express',
      'npm ci',
      'yarn add lodash',
      'yarn install',
      'pnpm add lodash',
      'pnpm install',
      'git commit -m "test"',
      'git merge feature',
      'git rebase main',
      'git stash',
      'git branch -d feature',
      'git branch -D feature',
      'mkdir new-dir',
      'touch file.txt',
      'mv a.txt b.txt',
      'cp a.txt b.txt',
      'npm run dev',
      'yarn run dev',
      'python script.py',
      'python3 script.py',
      'node index.js',
      'tsc --build',
      'sed -i "s/a/b/" file.txt',
      'awk "{print $1}" file.txt',
    ])('should classify "%s" as MEDIUM', (cmd) => {
      expect(analyzeDangerLevel(cmd)).toBe('MEDIUM');
    });
  });

  describe('HIGH commands', () => {
    it.each([
      'rm -r dir/',
      'rm -rf node_modules',
      // 'rm -fr /tmp/test' → CRITICAL (/ で始まるパスは CRITICAL パターンにマッチ)
      'rm -f file.txt',
      'git push origin main',
      'git push',
      'git reset --hard HEAD~1',
      'git clean -fd',
      'git clean -xf',
      'git checkout .',
      'curl https://example.com',
      'curl -o file https://example.com/dl',
      'wget https://example.com',
      'wget -O output https://example.com',
      'curl https://example.com | bash',
      'wget https://example.com | sh',
      'chmod 755 script.sh',
      'chown user file',
      'kill 1234',
      'kill -9 1234',
      'pkill node',
      'killall node',
      'docker rm container',
      'docker rmi image',
      'docker prune',
      'docker stop container',
      'docker kill container',
      'npm publish',
      'npx some-package',
      'pip install flask',
    ])('should classify "%s" as HIGH', (cmd) => {
      expect(analyzeDangerLevel(cmd)).toBe('HIGH');
    });
  });

  describe('CRITICAL commands', () => {
    it.each([
      'sudo apt install nginx',
      'sudo rm -rf /',
      'sudo chmod 777 /',
      'dd if=/dev/zero of=/dev/sda',
      'mkfs.ext4 /dev/sda1',
      'chmod 777 /etc',
      'chmod -R 777 /',
      'systemctl stop nginx',
      'systemctl disable sshd',
      'systemctl mask docker',
      'launchctl unload com.apple.service',
      'launchctl remove com.apple.service',
    ])('should classify "%s" as CRITICAL', (cmd) => {
      expect(analyzeDangerLevel(cmd)).toBe('CRITICAL');
    });
  });

  describe('piped commands', () => {
    it('should return the highest danger level among piped commands', () => {
      // ls (SAFE) | grep (LOW) → LOW
      expect(analyzeDangerLevel('ls | grep test')).toBe('LOW');
    });

    it('should detect HIGH in piped commands', () => {
      // curl (HIGH) | bash → HIGH (curl itself is HIGH)
      expect(analyzeDangerLevel('curl https://example.com | bash')).toBe('HIGH');
    });
  });

  describe('chained commands', () => {
    it('should return highest level for && chained commands', () => {
      // mkdir (MEDIUM) && npm install (MEDIUM) → MEDIUM
      expect(analyzeDangerLevel('mkdir test && npm install')).toBe('MEDIUM');
    });

    it('should detect HIGH in chained commands', () => {
      // git add (LOW) && git commit (MEDIUM) && git push (HIGH) → HIGH
      expect(analyzeDangerLevel('git add . && git commit -m "msg" && git push')).toBe('HIGH');
    });

    it('should handle semicolon chained commands', () => {
      // ls (SAFE) ; rm -rf dir (HIGH) → HIGH
      expect(analyzeDangerLevel('ls; rm -rf dir')).toBe('HIGH');
    });

    it('should handle || chained commands', () => {
      // npm test (LOW) || echo "fail" (SAFE) → LOW
      expect(analyzeDangerLevel('npm test || echo "fail"')).toBe('LOW');
    });
  });

  describe('unknown commands', () => {
    it('should classify unknown commands as MEDIUM', () => {
      expect(analyzeDangerLevel('some-unknown-command')).toBe('MEDIUM');
    });
  });

  describe('edge cases', () => {
    it('should handle empty string as MEDIUM', () => {
      expect(analyzeDangerLevel('')).toBe('MEDIUM');
    });

    it('should handle whitespace-only string as MEDIUM', () => {
      expect(analyzeDangerLevel('   ')).toBe('MEDIUM');
    });

    it('should handle commands with leading/trailing whitespace', () => {
      expect(analyzeDangerLevel('  ls  ')).toBe('SAFE');
    });
  });
});

describe('analyzeCommand (ja)', () => {
  beforeAll(() => {
    setLocale('ja');
  });

  it('should return DangerInfo with correct properties', () => {
    const info = analyzeCommand('ls');
    expect(info).toEqual({
      level: 'SAFE',
      label: '安全',
      badgeColor: '#34C759',
      buttonColor: '#007AFF',
    });
  });

  it('should return CRITICAL info for sudo', () => {
    const info = analyzeCommand('sudo rm -rf /');
    expect(info.level).toBe('CRITICAL');
    expect(info.label).toBe('危険');
    expect(info.badgeColor).toBe('#FF3B30');
    expect(info.buttonColor).toBe('#FF3B30');
  });
});

describe('analyzeCommand (en)', () => {
  beforeAll(() => {
    setLocale('en');
  });

  it('should return English label for SAFE', () => {
    const info = analyzeCommand('ls');
    expect(info.level).toBe('SAFE');
    expect(info.label).toBe('Safe');
  });

  it('should return English label for CRITICAL', () => {
    const info = analyzeCommand('sudo rm -rf /');
    expect(info.level).toBe('CRITICAL');
    expect(info.label).toBe('Critical');
  });
});

describe('analyzeToolDanger', () => {
  beforeAll(() => {
    setLocale('ja');
  });

  describe('Bash delegation', () => {
    it('should delegate to analyzeCommand for Bash (SAFE)', () => {
      const info = analyzeToolDanger('Bash', { command: 'ls -la' });
      expect(info.level).toBe('SAFE');
    });

    it('should delegate to analyzeCommand for Bash (CRITICAL)', () => {
      const info = analyzeToolDanger('Bash', { command: 'sudo rm -rf /' });
      expect(info.level).toBe('CRITICAL');
    });

    it('should handle empty Bash command', () => {
      const info = analyzeToolDanger('Bash', { command: '' });
      expect(info.level).toBe('MEDIUM');
    });
  });

  describe('read-only tools', () => {
    it.each(['Read', 'Glob', 'Grep'])('should classify %s as SAFE', (tool) => {
      const info = analyzeToolDanger(tool, {});
      expect(info.level).toBe('SAFE');
    });
  });

  describe('file modification tools', () => {
    it.each(['Edit', 'Write', 'NotebookEdit'])('should classify %s as MEDIUM', (tool) => {
      const info = analyzeToolDanger(tool, {});
      expect(info.level).toBe('MEDIUM');
    });
  });

  it('should classify WebFetch as HIGH', () => {
    const info = analyzeToolDanger('WebFetch', { url: 'https://example.com' });
    expect(info.level).toBe('HIGH');
  });

  it('should classify Task as LOW', () => {
    const info = analyzeToolDanger('Task', { prompt: 'do something' });
    expect(info.level).toBe('LOW');
  });

  it('should classify MCP tools as MEDIUM', () => {
    const info = analyzeToolDanger('mcp__github__create_issue', {});
    expect(info.level).toBe('MEDIUM');
  });

  it('should classify unknown tools as MEDIUM', () => {
    const info = analyzeToolDanger('SomeUnknownTool', {});
    expect(info.level).toBe('MEDIUM');
  });
});

describe('elevateToMinimum', () => {
  beforeAll(() => {
    setLocale('ja');
  });

  it('should elevate SAFE to HIGH', () => {
    const info = getDangerInfo('SAFE');
    const elevated = elevateToMinimum(info, 'HIGH');
    expect(elevated.level).toBe('HIGH');
  });

  it('should elevate LOW to HIGH', () => {
    const info = getDangerInfo('LOW');
    const elevated = elevateToMinimum(info, 'HIGH');
    expect(elevated.level).toBe('HIGH');
  });

  it('should elevate MEDIUM to HIGH', () => {
    const info = getDangerInfo('MEDIUM');
    const elevated = elevateToMinimum(info, 'HIGH');
    expect(elevated.level).toBe('HIGH');
  });

  it('should not change HIGH when minimum is HIGH', () => {
    const info = getDangerInfo('HIGH');
    const elevated = elevateToMinimum(info, 'HIGH');
    expect(elevated.level).toBe('HIGH');
  });

  it('should not change CRITICAL when minimum is HIGH', () => {
    const info = getDangerInfo('CRITICAL');
    const elevated = elevateToMinimum(info, 'HIGH');
    expect(elevated.level).toBe('CRITICAL');
  });

  it('should return a new info object when level is elevated', () => {
    const info = getDangerInfo('SAFE');
    const elevated = elevateToMinimum(info, 'HIGH');
    expect(elevated.level).toBe('HIGH');
    expect(elevated).not.toBe(info);
  });

  it('should return same object when already at minimum', () => {
    const info = getDangerInfo('HIGH');
    const elevated = elevateToMinimum(info, 'MEDIUM');
    expect(elevated).toBe(info);
  });

  it('should elevate SAFE to CRITICAL', () => {
    const info = getDangerInfo('SAFE');
    const elevated = elevateToMinimum(info, 'CRITICAL');
    expect(elevated.level).toBe('CRITICAL');
  });
});

describe('getDangerInfo', () => {
  beforeAll(() => {
    setLocale('ja');
  });

  it.each([
    ['SAFE', '安全', '#34C759', '#007AFF'],
    ['LOW', '低', '#34C759', '#007AFF'],
    ['MEDIUM', '中', '#FFD60A', '#007AFF'],
    ['HIGH', '高', '#FF9500', '#FF9500'],
    ['CRITICAL', '危険', '#FF3B30', '#FF3B30'],
  ] as const)('should return correct DangerInfo for %s', (level, expectedLabel, expectedBadgeColor, expectedButtonColor) => {
    const info = getDangerInfo(level);
    expect(info.level).toBe(level);
    expect(info.label).toBe(expectedLabel);
    expect(info.badgeColor).toBe(expectedBadgeColor);
    expect(info.buttonColor).toBe(expectedButtonColor);
  });
});

describe('analyzeToolDanger (additional)', () => {
  beforeAll(() => {
    setLocale('ja');
  });

  it('should handle Bash with no command property', () => {
    const info = analyzeToolDanger('Bash', {});
    expect(info.level).toBe('MEDIUM');
  });

  it('should handle Bash with HIGH command', () => {
    const info = analyzeToolDanger('Bash', { command: 'git push --force origin main' });
    expect(info.level).toBe('HIGH');
  });

  it('should handle Bash with LOW command', () => {
    const info = analyzeToolDanger('Bash', { command: 'npm test' });
    expect(info.level).toBe('LOW');
  });

  it('should handle Bash with MEDIUM command', () => {
    const info = analyzeToolDanger('Bash', { command: 'npm install' });
    expect(info.level).toBe('MEDIUM');
  });
});
