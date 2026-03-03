import { beforeAll, describe, expect, it } from 'vitest';
import { setLocale } from '../src/i18n/index';
import { classifyTool, describeCommand, describeToolAction } from '../src/shared/tool-classifier';

describe('describeCommand (ja)', () => {
  beforeAll(() => {
    setLocale('ja');
  });

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

  describe('python/node commands', () => {
    it('should describe python script', () => {
      const result = describeCommand('python script.py');
      expect(result.summary).toContain('Python');
      expect(result.summary).toContain('script.py');
    });

    it('should describe python3 script', () => {
      const result = describeCommand('python3 app.py');
      expect(result.summary).toContain('Python');
      expect(result.summary).toContain('app.py');
    });

    it('should describe node script', () => {
      const result = describeCommand('node index.js');
      expect(result.summary).toContain('Node.js');
      expect(result.summary).toContain('index.js');
    });
  });

  describe('mkdir commands', () => {
    it('should describe mkdir', () => {
      const result = describeCommand('mkdir new-dir');
      expect(result.summary).toContain('new-dir');
    });

    it('should describe mkdir -p', () => {
      const result = describeCommand('mkdir -p deep/nested/dir');
      expect(result.summary).toContain('deep/nested/dir');
    });
  });

  describe('mv commands', () => {
    it('should describe mv', () => {
      const result = describeCommand('mv old.txt new.txt');
      expect(result.summary).toContain('old.txt');
      expect(result.summary).toContain('new.txt');
    });
  });

  describe('cp commands', () => {
    it('should describe cp', () => {
      const result = describeCommand('cp src.txt dst.txt');
      expect(result.summary).toContain('src.txt');
      expect(result.summary).toContain('dst.txt');
    });

    it('should describe cp -r', () => {
      const result = describeCommand('cp -r src/ dst/');
      expect(result.summary).toContain('src/');
    });
  });

  describe('chmod commands', () => {
    it('should describe chmod', () => {
      const result = describeCommand('chmod 755 script.sh');
      expect(result.detail).toContain('755');
    });
  });

  describe('kill commands', () => {
    it('should describe kill', () => {
      const result = describeCommand('kill 1234');
      expect(result.summary).toContain('1234');
    });

    it('should describe pkill', () => {
      const result = describeCommand('pkill node');
      expect(result.summary).toContain('node');
    });

    it('should describe killall', () => {
      const result = describeCommand('killall ruby');
      expect(result.summary).toContain('ruby');
    });
  });

  describe('docker commands', () => {
    it('should describe docker run', () => {
      const result = describeCommand('docker run nginx');
      expect(result.summary).toContain('run');
      expect(result.detail).toContain('docker');
    });

    it('should describe docker rm', () => {
      const result = describeCommand('docker rm container-id');
      expect(result.summary).toContain('rm');
    });
  });

  describe('git reset commands', () => {
    it('should describe git reset (soft)', () => {
      const result = describeCommand('git reset HEAD~1');
      expect(result.summary).toContain('リセット');
    });

    it('should describe git reset --hard', () => {
      const result = describeCommand('git reset --hard HEAD~1');
      expect(result.summary).toContain('強制リセット');
    });
  });

  describe('git checkout commands', () => {
    it('should describe git checkout to existing branch', () => {
      const result = describeCommand('git checkout main');
      expect(result.summary).toContain('main');
    });

    it('should describe git checkout -b for new branch', () => {
      const result = describeCommand('git checkout -b new-feature');
      expect(result.summary).toContain('new-feature');
      expect(result.summary).toContain('作成');
    });
  });

  describe('git read commands', () => {
    it('should describe git diff', () => {
      const result = describeCommand('git diff');
      expect(result.summary).toContain('差分');
    });

    it('should describe git show', () => {
      const result = describeCommand('git show HEAD');
      expect(result.summary).toContain('コミット詳細');
    });

    it('should describe git branch', () => {
      const result = describeCommand('git branch');
      expect(result.summary).toContain('ブランチ');
    });

    it('should describe git remote', () => {
      const result = describeCommand('git remote -v');
      expect(result.summary).toContain('リモート');
    });
  });

  describe('wget commands', () => {
    it('should describe wget with URL', () => {
      const result = describeCommand('wget https://example.com/file.tar.gz');
      expect(result.detail).toContain('example.com');
    });
  });

  describe('git add commands', () => {
    it('should describe git add with files', () => {
      const result = describeCommand('git add file.txt');
      expect(result.summary).toContain('file.txt');
    });

    it('should describe git add without files', () => {
      const result = describeCommand('git add');
      expect(result.summary).toContain('ステージ');
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

    it('should describe head', () => {
      const result = describeCommand('head file.txt');
      expect(result.summary).toContain('先頭');
    });

    it('should describe tail', () => {
      const result = describeCommand('tail file.txt');
      expect(result.summary).toContain('末尾');
    });

    it('should describe echo', () => {
      const result = describeCommand('echo hello world');
      expect(result.summary).toContain('テキスト');
      expect(result.summary).toContain('出力');
    });

    it('should describe which', () => {
      const result = describeCommand('which node');
      expect(result.summary).toContain('パス');
    });

    it('should describe whoami', () => {
      const result = describeCommand('whoami');
      expect(result.summary).toContain('ユーザー');
    });

    it('should describe date', () => {
      const result = describeCommand('date');
      expect(result.summary).toContain('日付');
    });

    it('should describe env', () => {
      const result = describeCommand('env');
      expect(result.summary).toContain('環境変数');
    });

    it('should describe printenv', () => {
      const result = describeCommand('printenv');
      expect(result.summary).toContain('環境変数');
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

  describe('semicolon chained commands', () => {
    it('should describe ; chained commands', () => {
      const result = describeCommand('echo hello; ls');
      expect(result.detail).toContain('順次実行');
    });
  });

  describe('unknown commands', () => {
    it('should provide a default description', () => {
      const result = describeCommand('my-custom-script --flag');
      expect(result.summary).toContain('my-custom-script');
    });
  });

  describe('edge cases', () => {
    it('should handle empty string', () => {
      const result = describeCommand('');
      expect(result.summary).toBeDefined();
      expect(result.detail).toBeDefined();
    });

    it('should handle whitespace-only string', () => {
      const result = describeCommand('   ');
      expect(result.summary).toBeDefined();
    });

    it('should handle commands with leading whitespace', () => {
      const result = describeCommand('  ls -la');
      expect(result.summary).toContain('ファイル一覧');
    });
  });
});

describe('describeCommand (en)', () => {
  beforeAll(() => {
    setLocale('en');
  });

  it('should describe rm in English', () => {
    const result = describeCommand('rm -rf node_modules');
    expect(result.summary).toContain('node_modules');
    expect(result.detail).toContain('force');
  });

  it('should describe git push in English', () => {
    const result = describeCommand('git push origin main');
    expect(result.summary.toLowerCase()).toContain('push');
  });

  it('should describe ls in English', () => {
    const result = describeCommand('ls -la');
    expect(result.summary).toContain('List files');
    expect(result.detail).toContain('read-only');
  });

  it('should describe piped commands in English', () => {
    const result = describeCommand('cat file.txt | grep pattern');
    expect(result.detail).toContain('pipeline');
  });

  it('should describe chained commands in English', () => {
    const result = describeCommand('mkdir test && cd test');
    expect(result.detail).toContain('sequentially');
  });
});

describe('classifyTool (ja)', () => {
  beforeAll(() => {
    setLocale('ja');
  });

  it('should classify known tools', () => {
    expect(classifyTool('Bash')).toBe('シェルコマンド実行');
    expect(classifyTool('Read')).toBe('ファイル読み取り');
    expect(classifyTool('Write')).toBe('ファイル書き込み');
    expect(classifyTool('Edit')).toBe('ファイル編集');
    expect(classifyTool('WebFetch')).toBe('Web アクセス');
    expect(classifyTool('Glob')).toBe('ファイル検索');
    expect(classifyTool('Grep')).toBe('テキスト検索');
    expect(classifyTool('Task')).toBe('エージェント起動');
    expect(classifyTool('NotebookEdit')).toBe('ノートブック編集');
  });

  it('should return tool name for unknown tools', () => {
    expect(classifyTool('CustomTool')).toBe('CustomTool');
  });
});

describe('classifyTool (en)', () => {
  beforeAll(() => {
    setLocale('en');
  });

  it('should classify known tools in English', () => {
    expect(classifyTool('Bash')).toBe('Shell command execution');
    expect(classifyTool('Read')).toBe('File read');
    expect(classifyTool('Write')).toBe('File write');
    expect(classifyTool('Edit')).toBe('File edit');
    expect(classifyTool('WebFetch')).toBe('Web access');
    expect(classifyTool('Glob')).toBe('File search');
    expect(classifyTool('Grep')).toBe('Text search');
    expect(classifyTool('Task')).toBe('Agent launch');
    expect(classifyTool('NotebookEdit')).toBe('Notebook edit');
  });

  it('should return tool name for unknown tools', () => {
    expect(classifyTool('CustomTool')).toBe('CustomTool');
  });
});

describe('describeToolAction (ja)', () => {
  beforeAll(() => {
    setLocale('ja');
  });

  describe('Bash', () => {
    it('should delegate to describeCommand', () => {
      const result = describeToolAction('Bash', { command: 'npm install express' });
      expect(result.displayText).toBe('npm install express');
      expect(result.detail).toContain('express');
    });

    it('should handle empty command', () => {
      const result = describeToolAction('Bash', { command: '' });
      expect(result.displayText).toBe('');
    });
  });

  describe('Edit', () => {
    it('should show file path and diff preview', () => {
      const result = describeToolAction('Edit', {
        file_path: '/src/server.ts',
        old_string: 'const x = 1;',
        new_string: 'const x = 2;',
      });
      expect(result.displayText).toContain('📝');
      expect(result.displayText).toContain('/src/server.ts');
      expect(result.displayText).toContain('- const x = 1;');
      expect(result.displayText).toContain('+ const x = 2;');
      expect(result.detail).toContain('server.ts');
      expect(result.detail).toContain('編集');
    });

    it('should truncate long strings', () => {
      const longStr = 'a'.repeat(300);
      const result = describeToolAction('Edit', {
        file_path: '/src/file.ts',
        old_string: longStr,
        new_string: 'short',
      });
      expect(result.displayText).toContain('…');
      expect(result.displayText.length).toBeLessThan(longStr.length + 100);
    });
  });

  describe('Write', () => {
    it('should show file path and line count', () => {
      const result = describeToolAction('Write', {
        file_path: '/src/new.ts',
        content: 'line1\nline2\nline3',
      });
      expect(result.displayText).toContain('📄');
      expect(result.displayText).toContain('/src/new.ts');
      expect(result.displayText).toContain('3');
      expect(result.detail).toContain('new.ts');
      expect(result.detail).toContain('書き込み');
    });
  });

  describe('Read', () => {
    it('should show file path', () => {
      const result = describeToolAction('Read', { file_path: '/src/file.ts' });
      expect(result.displayText).toContain('📖');
      expect(result.displayText).toContain('/src/file.ts');
      expect(result.detail).toContain('読み取り');
    });
  });

  describe('WebFetch', () => {
    it('should show URL', () => {
      const result = describeToolAction('WebFetch', { url: 'https://example.com' });
      expect(result.displayText).toContain('🌐');
      expect(result.displayText).toContain('https://example.com');
      expect(result.detail).toContain('URL');
    });
  });

  describe('Task', () => {
    it('should show agent label and truncated prompt', () => {
      const result = describeToolAction('Task', { prompt: 'Search for files' });
      expect(result.displayText).toContain('🤖');
      expect(result.detail).toContain('サブエージェント');
      expect(result.detail).toContain('Search for files');
    });

    it('should truncate long prompts', () => {
      const longPrompt = 'x'.repeat(200);
      const result = describeToolAction('Task', { prompt: longPrompt });
      expect(result.detail).toContain('…');
    });
  });

  describe('NotebookEdit', () => {
    it('should show notebook path', () => {
      const result = describeToolAction('NotebookEdit', {
        notebook_path: '/notebooks/analysis.ipynb',
      });
      expect(result.displayText).toContain('📓');
      expect(result.displayText).toContain('/notebooks/analysis.ipynb');
      expect(result.detail).toContain('ノートブック');
    });
  });

  describe('MCP tools', () => {
    it('should parse mcp__server__method format', () => {
      const result = describeToolAction('mcp__github__create_issue', {});
      expect(result.displayText).toContain('🔌');
      expect(result.displayText).toContain('github');
      expect(result.displayText).toContain('create_issue');
      expect(result.detail).toContain('MCP サーバー');
      expect(result.detail).toContain('github');
    });
  });

  describe('unknown tools', () => {
    it('should show tool name with gear icon', () => {
      const result = describeToolAction('CustomTool', {});
      expect(result.displayText).toContain('⚙️');
      expect(result.displayText).toContain('CustomTool');
      expect(result.detail).toContain('ツール');
      expect(result.detail).toContain('CustomTool');
    });
  });

  describe('edge cases', () => {
    it('should handle Bash with missing command key', () => {
      const result = describeToolAction('Bash', {});
      expect(result.displayText).toBe('');
    });

    it('should handle Edit with only file_path', () => {
      const result = describeToolAction('Edit', { file_path: '/src/file.ts' });
      expect(result.displayText).toContain('📝');
      expect(result.displayText).toContain('/src/file.ts');
      expect(result.displayText).not.toContain('- ');
    });

    it('should handle Edit with empty strings', () => {
      const result = describeToolAction('Edit', {
        file_path: '/src/file.ts',
        old_string: '',
        new_string: '',
      });
      expect(result.displayText).toContain('📝');
    });

    it('should handle Write with empty content', () => {
      const result = describeToolAction('Write', { file_path: '/src/empty.ts', content: '' });
      expect(result.displayText).toContain('📄');
      expect(result.displayText).toContain('1');
    });

    it('should handle Write with no content key', () => {
      const result = describeToolAction('Write', { file_path: '/src/empty.ts' });
      expect(result.displayText).toContain('📄');
    });

    it('should handle Read with empty file_path', () => {
      const result = describeToolAction('Read', { file_path: '' });
      expect(result.displayText).toContain('📖');
    });

    it('should handle WebFetch with empty url', () => {
      const result = describeToolAction('WebFetch', { url: '' });
      expect(result.displayText).toContain('🌐');
    });

    it('should handle Task with empty prompt', () => {
      const result = describeToolAction('Task', { prompt: '' });
      expect(result.displayText).toContain('🤖');
    });

    it('should handle NotebookEdit with empty path', () => {
      const result = describeToolAction('NotebookEdit', { notebook_path: '' });
      expect(result.displayText).toContain('📓');
    });

    it('should handle MCP tool with nested underscores in method', () => {
      const result = describeToolAction('mcp__slack__send_message', {});
      expect(result.displayText).toContain('slack');
      expect(result.displayText).toContain('send_message');
    });
  });
});

describe('describeToolAction (en)', () => {
  beforeAll(() => {
    setLocale('en');
  });

  it('should describe Edit in English', () => {
    const result = describeToolAction('Edit', {
      file_path: '/src/server.ts',
      old_string: 'a',
      new_string: 'b',
    });
    expect(result.detail).toContain('Edits');
    expect(result.detail).toContain('server.ts');
  });

  it('should describe Task in English', () => {
    const result = describeToolAction('Task', { prompt: 'Search for files' });
    expect(result.displayText).toContain('Sub-agent');
    expect(result.detail).toContain('sub-agent');
  });

  it('should describe MCP tool in English', () => {
    const result = describeToolAction('mcp__github__create_issue', {});
    expect(result.detail).toContain('MCP server');
    expect(result.detail).toContain('github');
  });
});
