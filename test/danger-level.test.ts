import { describe, it, expect } from 'vitest';
import { analyzeDangerLevel, analyzeCommand } from '../src/shared/danger-level';

describe('analyzeDangerLevel', () => {
  describe('SAFE commands', () => {
    it.each([
      'ls',
      'ls -la',
      'cat file.txt',
      'pwd',
      'git status',
      'git log --oneline',
      'git diff HEAD',
      'echo hello',
      'which node',
      'whoami',
    ])('should classify "%s" as SAFE', (cmd) => {
      expect(analyzeDangerLevel(cmd)).toBe('SAFE');
    });
  });

  describe('LOW commands', () => {
    it.each([
      'npm test',
      'npm run test',
      'yarn test',
      'vitest',
      'jest',
      'npm run build',
      'npm run lint',
      'git add .',
      'git checkout -b feature',
      'find . -name "*.ts"',
      'grep -r pattern .',
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
      'git commit -m "test"',
      'git merge feature',
      'git rebase main',
      'mkdir new-dir',
      'touch file.txt',
      'mv a.txt b.txt',
      'cp a.txt b.txt',
      'npm run dev',
      'python script.py',
      'node index.js',
      'tsc --build',
    ])('should classify "%s" as MEDIUM', (cmd) => {
      expect(analyzeDangerLevel(cmd)).toBe('MEDIUM');
    });
  });

  describe('HIGH commands', () => {
    it.each([
      'rm -r dir/',
      'rm -rf node_modules',
      'rm -f file.txt',
      'git push origin main',
      'git reset --hard HEAD~1',
      'git clean -fd',
      'curl https://example.com',
      'wget https://example.com',
      'chmod 755 script.sh',
      'chown user file',
      'kill 1234',
      'pkill node',
      'docker rm container',
      'npm publish',
      'npx some-package',
    ])('should classify "%s" as HIGH', (cmd) => {
      expect(analyzeDangerLevel(cmd)).toBe('HIGH');
    });
  });

  describe('CRITICAL commands', () => {
    it.each([
      'sudo apt install nginx',
      'sudo rm -rf /',
      'dd if=/dev/zero of=/dev/sda',
      'mkfs.ext4 /dev/sda1',
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
  });

  describe('unknown commands', () => {
    it('should classify unknown commands as MEDIUM', () => {
      expect(analyzeDangerLevel('some-unknown-command')).toBe('MEDIUM');
    });
  });
});

describe('analyzeCommand', () => {
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
