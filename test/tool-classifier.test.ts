import { describe, it, expect } from 'vitest';
import { describeCommand, classifyTool } from '../src/shared/tool-classifier';

describe('describeCommand', () => {
  describe('rm commands', () => {
    it('should describe rm -rf with targets', () => {
      const result = describeCommand('rm -rf node_modules');
      expect(result.summary).toContain('node_modules');
      expect(result.detail).toContain('再帰');
      expect(result.detail).toContain('強制');
    });

    it('should describe rm -r', () => {
      const result = describeCommand('rm -r dist');
      expect(result.summary).toContain('dist');
      expect(result.detail).toContain('再帰');
    });

    it('should describe simple rm', () => {
      const result = describeCommand('rm file.txt');
      expect(result.summary).toContain('file.txt');
      expect(result.detail).toContain('削除');
    });
  });

  describe('git commands', () => {
    it('should describe git push', () => {
      const result = describeCommand('git push origin main');
      expect(result.summary).toContain('プッシュ');
      expect(result.detail).toContain('リモート');
    });

    it('should describe git push --force', () => {
      const result = describeCommand('git push --force origin main');
      expect(result.summary).toContain('強制');
      expect(result.detail).toContain('上書き');
    });

    it('should describe git commit', () => {
      const result = describeCommand('git commit -m "test"');
      expect(result.summary).toContain('コミット');
    });

    it('should describe git commit --amend', () => {
      const result = describeCommand('git commit --amend');
      expect(result.summary).toContain('修正');
    });

    it('should describe git status', () => {
      const result = describeCommand('git status');
      expect(result.summary).toContain('状態');
    });

    it('should describe git log', () => {
      const result = describeCommand('git log');
      expect(result.summary).toContain('履歴');
    });

    it('should describe git add', () => {
      const result = describeCommand('git add .');
      expect(result.summary).toContain('ステージ');
    });

    it('should describe git reset --hard', () => {
      const result = describeCommand('git reset --hard HEAD~1');
      expect(result.summary).toContain('強制リセット');
      expect(result.detail).toContain('失われ');
    });

    it('should describe git checkout -b', () => {
      const result = describeCommand('git checkout -b feature-branch');
      expect(result.summary).toContain('作成');
      expect(result.summary).toContain('feature-branch');
    });
  });

  describe('npm commands', () => {
    it('should describe npm install', () => {
      const result = describeCommand('npm install');
      expect(result.summary).toContain('依存関係');
    });

    it('should describe npm install with package', () => {
      const result = describeCommand('npm install express');
      expect(result.summary).toContain('express');
    });

    it('should describe npm ci', () => {
      const result = describeCommand('npm ci');
      expect(result.summary).toContain('クリーン');
    });

    it('should describe npm run scripts', () => {
      const result = describeCommand('npm run dev');
      expect(result.summary).toContain('dev');
      expect(result.detail).toContain('scripts');
    });

    it('should describe npm test', () => {
      const result = describeCommand('npm test');
      expect(result.summary).toContain('test');
    });
  });

  describe('curl/wget commands', () => {
    it('should describe curl with URL', () => {
      const result = describeCommand('curl https://example.com/api');
      expect(result.detail).toContain('example.com');
    });

    it('should describe curl piped to bash', () => {
      const result = describeCommand('curl https://example.com/install.sh | bash');
      // Pipe is split into separate commands, so it uses the pipe description
      expect(result.detail).toContain('パイプライン');
    });
  });

  describe('sudo commands', () => {
    it('should describe sudo with inner command', () => {
      const result = describeCommand('sudo apt install nginx');
      expect(result.summary).toContain('管理者権限');
      expect(result.detail).toContain('sudo');
    });
  });

  describe('safe commands', () => {
    it('should describe ls', () => {
      const result = describeCommand('ls -la');
      expect(result.summary).toContain('ファイル一覧');
    });

    it('should describe cat', () => {
      const result = describeCommand('cat file.txt');
      expect(result.summary).toContain('ファイル内容');
    });

    it('should describe pwd', () => {
      const result = describeCommand('pwd');
      expect(result.summary).toContain('ディレクトリ');
    });
  });

  describe('piped commands', () => {
    it('should describe piped commands', () => {
      const result = describeCommand('cat file.txt | grep pattern');
      expect(result.detail).toContain('パイプライン');
    });
  });

  describe('chained commands', () => {
    it('should describe && chained commands', () => {
      const result = describeCommand('mkdir test && cd test');
      expect(result.detail).toContain('順次実行');
    });
  });

  describe('unknown commands', () => {
    it('should provide a default description', () => {
      const result = describeCommand('my-custom-script --flag');
      expect(result.summary).toContain('my-custom-script');
    });
  });
});

describe('classifyTool', () => {
  it('should classify known tools', () => {
    expect(classifyTool('Bash')).toBe('シェルコマンド実行');
    expect(classifyTool('Read')).toBe('ファイル読み取り');
    expect(classifyTool('Write')).toBe('ファイル書き込み');
    expect(classifyTool('Edit')).toBe('ファイル編集');
    expect(classifyTool('WebFetch')).toBe('Web アクセス');
  });

  it('should return tool name for unknown tools', () => {
    expect(classifyTool('CustomTool')).toBe('CustomTool');
  });
});
