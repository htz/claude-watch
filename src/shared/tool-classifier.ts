/**
 * ツール種別分類 + ローカライズ説明生成
 *
 * Bash コマンドを解析し、処理内容を説明する。
 */

import type { TranslationKey } from '@i18n';
import { t } from '@i18n';

interface CommandDescription {
  /** コマンドの短い説明 */
  summary: string;
  /** コマンドの詳細な説明 */
  detail: string;
}

interface DescriptionRule {
  pattern: RegExp;
  describe: (match: RegExpMatchArray, full: string) => CommandDescription;
}

/** safe コマンド名から翻訳キーへのマッピング */
const SAFE_CMD_KEYS: Record<string, TranslationKey> = {
  ls: 'cmd.safe.ls',
  cat: 'cmd.safe.cat',
  head: 'cmd.safe.head',
  tail: 'cmd.safe.tail',
  echo: 'cmd.safe.echo',
  pwd: 'cmd.safe.pwd',
  which: 'cmd.safe.which',
  whoami: 'cmd.safe.whoami',
  date: 'cmd.safe.date',
  env: 'cmd.safe.env',
  printenv: 'cmd.safe.printenv',
};

/** git 読み取りコマンドから翻訳キーへのマッピング */
const GIT_READ_CMD_KEYS: Record<string, TranslationKey> = {
  status: 'cmd.git.status',
  log: 'cmd.git.log',
  diff: 'cmd.git.diff',
  show: 'cmd.git.show',
  branch: 'cmd.git.branch',
  remote: 'cmd.git.remote',
};

/** classifyTool で使用するツール名から翻訳キーへのマッピング */
const TOOL_CLASSIFY_KEYS: Record<string, TranslationKey> = {
  Bash: 'tool.classify.Bash',
  Read: 'tool.classify.Read',
  Write: 'tool.classify.Write',
  Edit: 'tool.classify.Edit',
  Glob: 'tool.classify.Glob',
  Grep: 'tool.classify.Grep',
  WebFetch: 'tool.classify.WebFetch',
  Task: 'tool.classify.Task',
  NotebookEdit: 'tool.classify.NotebookEdit',
};

const RULES: DescriptionRule[] = [
  // rm
  {
    pattern: /^rm\s+(.+)$/,
    describe: (_match, full) => {
      const recursive = /-([\w]*r[\w]*)/.test(full) || /-[\w]*R/.test(full);
      const force = /-([\w]*f[\w]*)/.test(full);
      const targets = full
        .replace(/^rm\s+/, '')
        .replace(/-[\w]+\s*/g, '')
        .trim();
      if (recursive && force) {
        return {
          summary: t('cmd.rm.forceRecursive.summary', { targets }),
          detail: t('cmd.rm.forceRecursive.detail', { targets }),
        };
      }
      if (recursive) {
        return {
          summary: t('cmd.rm.recursive.summary', { targets }),
          detail: t('cmd.rm.recursive.detail', { targets }),
        };
      }
      return {
        summary: t('cmd.rm.simple.summary', { targets }),
        detail: t('cmd.rm.simple.detail', { targets }),
      };
    },
  },
  // git push
  {
    pattern: /^git\s+push\s*(.*)?$/,
    describe: (match) => {
      const args = (match[1] || '').trim();
      const force = /--force|-f/.test(args);
      const target = args.replace(/--force|-f/g, '').trim() || t('cmd.git.push.defaultRemote');
      if (force) {
        return {
          summary: t('cmd.git.push.force.summary', { target }),
          detail: t('cmd.git.push.force.detail', { target }),
        };
      }
      return {
        summary: t('cmd.git.push.summary', { target }),
        detail: t('cmd.git.push.detail', { target }),
      };
    },
  },
  // git commit
  {
    pattern: /^git\s+commit\b(.*)$/,
    describe: (match) => {
      const args = match[1].trim();
      const amend = /--amend/.test(args);
      if (amend) {
        return {
          summary: t('cmd.git.commit.amend.summary'),
          detail: t('cmd.git.commit.amend.detail'),
        };
      }
      return {
        summary: t('cmd.git.commit.summary'),
        detail: t('cmd.git.commit.detail'),
      };
    },
  },
  // git reset
  {
    pattern: /^git\s+reset\s+(.+)$/,
    describe: (_match, full) => {
      const hard = /--hard/.test(full);
      if (hard) {
        return {
          summary: t('cmd.git.reset.hard.summary'),
          detail: t('cmd.git.reset.hard.detail'),
        };
      }
      return {
        summary: t('cmd.git.reset.summary'),
        detail: t('cmd.git.reset.detail'),
      };
    },
  },
  // git checkout / switch / branch -d
  {
    pattern: /^git\s+checkout\s+(-b\s+)?(.+)$/,
    describe: (match) => {
      const newBranch = match[1];
      const target = match[2].trim();
      if (newBranch) {
        return {
          summary: t('cmd.git.checkout.newBranch.summary', { target }),
          detail: t('cmd.git.checkout.newBranch.detail', { target }),
        };
      }
      return {
        summary: t('cmd.git.checkout.summary', { target }),
        detail: t('cmd.git.checkout.detail', { target }),
      };
    },
  },
  // npm install / ci
  {
    pattern: /^npm\s+(install|ci|i)\b(.*)$/,
    describe: (match) => {
      const sub = match[1];
      const args = (match[2] || '').trim();
      const pkg = args.replace(/-[\w-]+(=\S+)?/g, '').trim();
      if (sub === 'ci') {
        return {
          summary: t('cmd.npm.ci.summary'),
          detail: t('cmd.npm.ci.detail'),
        };
      }
      if (pkg) {
        return {
          summary: t('cmd.npm.installPkg.summary', { pkg }),
          detail: t('cmd.npm.installPkg.detail', { pkg }),
        };
      }
      return {
        summary: t('cmd.npm.install.summary'),
        detail: t('cmd.npm.install.detail'),
      };
    },
  },
  // npm run / test / build
  {
    pattern: /^npm\s+(run\s+|)([\w:.-]+)(.*)$/,
    describe: (match) => {
      const script = match[2];
      return {
        summary: t('cmd.npm.run.summary', { script }),
        detail: t('cmd.npm.run.detail', { script }),
      };
    },
  },
  // curl / wget
  {
    pattern: /^(curl|wget)\s+(.+)$/,
    describe: (match) => {
      const cmd = match[1];
      const args = match[2];
      const urlMatch = args.match(/(https?:\/\/[^\s"']+)/);
      const url = urlMatch ? urlMatch[1] : t('cmd.fetch.defaultUrl');
      const piped = /\|\s*(bash|sh|zsh)/.test(args);
      if (piped) {
        return {
          summary: t('cmd.fetch.piped.summary', { url }),
          detail: t('cmd.fetch.piped.detail', { cmd, url }),
        };
      }
      return {
        summary: t('cmd.fetch.summary', { url }),
        detail: t('cmd.fetch.detail', { cmd, url }),
      };
    },
  },
  // sudo
  {
    pattern: /^sudo\s+(.+)$/,
    describe: (match) => {
      const innerCmd = match[1].trim();
      const inner = describeCommand(innerCmd);
      return {
        summary: t('cmd.sudo.summary', { inner: inner.summary }),
        detail: t('cmd.sudo.detail', { innerDetail: inner.detail }),
      };
    },
  },
  // python / node
  {
    pattern: /^(python3?|node)\s+(.+)$/,
    describe: (match) => {
      const runtime = match[1];
      const script = match[2].split(/\s/)[0];
      const runtimeName = runtime.startsWith('python') ? 'Python' : 'Node.js';
      return {
        summary: t('cmd.runtime.summary', { runtime: runtimeName, script }),
        detail: t('cmd.runtime.detail', { runtime: runtimeName, script }),
      };
    },
  },
  // mkdir
  {
    pattern: /^mkdir\s+(.+)$/,
    describe: (match) => {
      const dir = match[1].replace(/-p\s*/, '').trim();
      return {
        summary: t('cmd.mkdir.summary', { dir }),
        detail: t('cmd.mkdir.detail', { dir }),
      };
    },
  },
  // mv
  {
    pattern: /^mv\s+(.+)\s+(.+)$/,
    describe: (match) => {
      const src = match[1].trim();
      const dst = match[2].trim();
      return {
        summary: t('cmd.mv.summary', { src, dst }),
        detail: t('cmd.mv.detail', { src, dst }),
      };
    },
  },
  // cp
  {
    pattern: /^cp\s+(.+)\s+(.+)$/,
    describe: (match) => {
      const src = match[1].replace(/-[a-zA-Z]+\s*/g, '').trim();
      const dst = match[2].trim();
      return {
        summary: t('cmd.cp.summary', { src, dst }),
        detail: t('cmd.cp.detail', { src, dst }),
      };
    },
  },
  // chmod
  {
    pattern: /^chmod\s+(.+)$/,
    describe: (match) => {
      const args = match[1].trim();
      return {
        summary: t('cmd.chmod.summary'),
        detail: t('cmd.chmod.detail', { args }),
      };
    },
  },
  // kill / pkill
  {
    pattern: /^(kill|pkill|killall)\s+(.+)$/,
    describe: (match) => {
      const cmd = match[1];
      const target = match[2].trim();
      return {
        summary: t('cmd.kill.summary', { target }),
        detail: t('cmd.kill.detail', { cmd, target }),
      };
    },
  },
  // docker
  {
    pattern: /^docker\s+(.+)$/,
    describe: (match) => {
      const subcommand = match[1].split(/\s/)[0];
      return {
        summary: t('cmd.docker.summary', { subcommand }),
        detail: t('cmd.docker.detail', { args: match[1].trim() }),
      };
    },
  },
  // ls / cat / head / tail / echo / pwd
  {
    pattern: /^(ls|cat|head|tail|echo|pwd|which|whoami|date|env|printenv)\b(.*)$/,
    describe: (match) => {
      const cmd = match[1];
      const key = SAFE_CMD_KEYS[cmd];
      const description = key ? t(key) : undefined;
      const summary = description || t('cmd.safe.fallback', { cmd });
      const detail = description ? t('cmd.safe.detail', { description }) : t('cmd.safe.detailFallback', { cmd });
      return { summary, detail };
    },
  },
  // git status / log / diff / show
  {
    pattern: /^git\s+(status|log|diff|show|branch|remote)\b(.*)$/,
    describe: (match) => {
      const sub = match[1];
      const key = GIT_READ_CMD_KEYS[sub];
      const description = key ? t(key) : undefined;
      const summary = description || t('cmd.git.read.fallback', { sub });
      const detail = description
        ? t('cmd.git.read.detail', { description })
        : t('cmd.git.read.detailFallback', { sub });
      return { summary, detail };
    },
  },
  // git add
  {
    pattern: /^git\s+add\b(.*)$/,
    describe: (match) => {
      const files = (match[1] || '').trim();
      return {
        summary: files ? t('cmd.git.add.summaryWithFiles', { files }) : t('cmd.git.add.summary'),
        detail: t('cmd.git.add.detail', { files: files || t('cmd.git.add.defaultTarget') }),
      };
    },
  },
];

/**
 * コマンド文字列を解析して説明を生成する
 */
export function describeCommand(command: string): CommandDescription {
  const trimmed = command.trim();

  // パイプで繋がれたコマンドの場合、全体を説明
  if (/\|/.test(trimmed) && !/\|\|/.test(trimmed)) {
    const parts = trimmed.split(/\s*\|\s*/);
    if (parts.length >= 2) {
      const descriptions = parts.map((p) => describeCommand(p).summary);
      const joined = descriptions.join(t('cmd.pipe.separator'));
      return {
        summary: joined,
        detail: t('cmd.pipe.detail', { descriptions: joined }),
      };
    }
  }

  // && や ; で繋がれたコマンドの場合
  if (/&&|;/.test(trimmed)) {
    const parts = trimmed.split(/\s*(?:&&|;)\s*/);
    if (parts.length >= 2) {
      const descriptions = parts.map((p) => describeCommand(p).summary);
      return {
        summary: descriptions.join(t('cmd.chain.separator')),
        detail: t('cmd.chain.detail', { descriptions: descriptions.join(t('cmd.pipe.separator')) }),
      };
    }
  }

  for (const rule of RULES) {
    const match = trimmed.match(rule.pattern);
    if (match) {
      return rule.describe(match, trimmed);
    }
  }

  // マッチしなかった場合のデフォルト
  const firstWord = trimmed.split(/\s/)[0];
  return {
    summary: t('cmd.default.summary', { cmd: firstWord }),
    detail: t('cmd.default.detail', { command: trimmed }),
  };
}

/**
 * ツール名に基づく分類
 */
export function classifyTool(toolName: string): string {
  const key = TOOL_CLASSIFY_KEYS[toolName];
  return key ? t(key) : toolName;
}

export interface ToolActionDescription {
  /** コードブロック表示用テキスト */
  displayText: string;
  /** 説明文 */
  detail: string;
}

/** ファイルパスからファイル名を取得 */
function basename(filePath: string): string {
  const parts = filePath.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || filePath;
}

/** Edit ツールの差分プレビューを生成（長い場合は truncate） */
function editPreview(toolInput: Record<string, unknown>): string {
  const filePath = (toolInput.file_path as string) || '';
  const oldStr = (toolInput.old_string as string) || '';
  const newStr = (toolInput.new_string as string) || '';
  const MAX = 200;

  let preview = `📝 ${filePath}`;
  if (oldStr || newStr) {
    const truncOld = oldStr.length > MAX ? `${oldStr.slice(0, MAX)}…` : oldStr;
    const truncNew = newStr.length > MAX ? `${newStr.slice(0, MAX)}…` : newStr;
    preview += `\n- ${truncOld}\n+ ${truncNew}`;
  }
  return preview;
}

/** MCP ツール名からサーバー名とメソッド名を抽出 */
function parseMcpToolName(toolName: string): { server: string; method: string } | null {
  // mcp__ServerName__methodName
  const match = toolName.match(/^mcp__([^_]+)__(.+)$/);
  if (match) return { server: match[1], method: match[2] };
  return null;
}

/**
 * ツール種別に対応した説明・表示テキストを生成
 */
export function describeToolAction(toolName: string, toolInput: Record<string, unknown>): ToolActionDescription {
  switch (toolName) {
    case 'Bash': {
      const command = (toolInput.command as string) || '';
      const { detail } = describeCommand(command);
      return { displayText: command, detail };
    }

    case 'Edit': {
      const filePath = (toolInput.file_path as string) || '';
      return {
        displayText: editPreview(toolInput),
        detail: t('tool.action.edit.detail', { name: basename(filePath) }),
      };
    }

    case 'Write': {
      const filePath = (toolInput.file_path as string) || '';
      const content = (toolInput.content as string) || '';
      const lineCount = content.split('\n').length;
      return {
        displayText: t('tool.action.write.display', { path: filePath, lines: lineCount }),
        detail: t('tool.action.write.detail', { name: basename(filePath) }),
      };
    }

    case 'Read': {
      const filePath = (toolInput.file_path as string) || '';
      return {
        displayText: `📖 ${filePath}`,
        detail: t('tool.action.read.detail'),
      };
    }

    case 'WebFetch': {
      const url = (toolInput.url as string) || '';
      return {
        displayText: `🌐 ${url}`,
        detail: t('tool.action.webfetch.detail'),
      };
    }

    case 'Task': {
      const prompt = (toolInput.prompt as string) || '';
      const truncated = prompt.length > 100 ? `${prompt.slice(0, 100)}…` : prompt;
      return {
        displayText: t('tool.action.task.display'),
        detail: t('tool.action.task.detail', { prompt: truncated }),
      };
    }

    case 'NotebookEdit': {
      const filePath = (toolInput.notebook_path as string) || '';
      return {
        displayText: `📓 ${filePath}`,
        detail: t('tool.action.notebook.detail'),
      };
    }

    default: {
      // MCP ツール: mcp__ServerName__methodName
      const mcp = parseMcpToolName(toolName);
      if (mcp) {
        return {
          displayText: `🔌 ${mcp.server}: ${mcp.method}`,
          detail: t('tool.action.mcp.detail', { server: mcp.server, method: mcp.method }),
        };
      }

      // 未知のツール
      return {
        displayText: `⚙️ ${toolName}`,
        detail: t('tool.action.unknown.detail', { name: toolName }),
      };
    }
  }
}
