/**
 * ツール種別分類 + 日本語説明生成
 *
 * Bash コマンドを解析し、処理内容を日本語で説明する。
 */

interface CommandDescription {
  /** コマンドの短い日本語説明 */
  summary: string;
  /** コマンドの詳細な日本語説明 */
  detail: string;
}

interface DescriptionRule {
  pattern: RegExp;
  describe: (match: RegExpMatchArray, full: string) => CommandDescription;
}

const RULES: DescriptionRule[] = [
  // rm
  {
    pattern: /^rm\s+(.+)$/,
    describe: (_match, full) => {
      const recursive = /-([\w]*r[\w]*)/.test(full) || /-[\w]*R/.test(full);
      const force = /-([\w]*f[\w]*)/.test(full);
      const targets = full.replace(/^rm\s+/, '').replace(/-[\w]+\s*/g, '').trim();
      if (recursive && force) {
        return {
          summary: `${targets} を強制的に再帰削除`,
          detail: `${targets} とその中身を再帰的に強制削除します。この操作は元に戻せません。`,
        };
      }
      if (recursive) {
        return {
          summary: `${targets} を再帰削除`,
          detail: `${targets} ディレクトリとその中身を再帰的に削除します。`,
        };
      }
      return {
        summary: `${targets} を削除`,
        detail: `ファイル ${targets} を削除します。`,
      };
    },
  },
  // git push
  {
    pattern: /^git\s+push\s*(.*)?$/,
    describe: (match) => {
      const args = (match[1] || '').trim();
      const force = /--force|-f/.test(args);
      const target = args.replace(/--force|-f/g, '').trim() || 'デフォルトのリモート';
      if (force) {
        return {
          summary: `${target} に強制プッシュ`,
          detail: `ローカルの変更をリモートリポジトリ (${target}) に強制プッシュします。リモートの履歴が上書きされます。`,
        };
      }
      return {
        summary: `${target} にプッシュ`,
        detail: `ローカルの変更をリモートリポジトリ (${target}) にプッシュします。`,
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
          summary: '直前のコミットを修正',
          detail: '直前のコミットを修正 (amend) します。コミットメッセージや内容が変更されます。',
        };
      }
      return {
        summary: '変更をコミット',
        detail: 'ステージ済みの変更を新しいコミットとして記録します。',
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
          summary: '変更を強制リセット',
          detail: 'ワーキングディレクトリとインデックスを指定のコミットに強制リセットします。未コミットの変更は失われます。',
        };
      }
      return {
        summary: '変更をリセット',
        detail: 'インデックスを指定のコミットにリセットします。ワーキングディレクトリの変更は保持されます。',
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
          summary: `新しいブランチ ${target} を作成`,
          detail: `新しいブランチ ${target} を作成して切り替えます。`,
        };
      }
      return {
        summary: `${target} に切り替え`,
        detail: `ブランチまたはコミット ${target} に切り替えます。`,
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
          summary: 'クリーンインストール実行',
          detail: 'node_modules を削除し、package-lock.json に従って依存関係をクリーンインストールします。',
        };
      }
      if (pkg) {
        return {
          summary: `${pkg} をインストール`,
          detail: `npm パッケージ ${pkg} をインストールします。`,
        };
      }
      return {
        summary: '依存関係をインストール',
        detail: 'package.json に記載された依存関係をインストールします。',
      };
    },
  },
  // npm run / test / build
  {
    pattern: /^npm\s+(run\s+|)([\w:.-]+)(.*)$/,
    describe: (match) => {
      const script = match[2];
      return {
        summary: `npm スクリプト "${script}" を実行`,
        detail: `package.json の scripts に定義された "${script}" を実行します。`,
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
      const url = urlMatch ? urlMatch[1] : '指定された URL';
      const piped = /\|\s*(bash|sh|zsh)/.test(args);
      if (piped) {
        return {
          summary: `${url} からスクリプトをダウンロード・実行`,
          detail: `${cmd} で ${url} からスクリプトをダウンロードし、シェルで直接実行します。信頼できないソースからの実行は危険です。`,
        };
      }
      return {
        summary: `${url} にアクセス`,
        detail: `${cmd} で ${url} にネットワークリクエストを送信します。`,
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
        summary: `管理者権限で: ${inner.summary}`,
        detail: `管理者権限 (sudo) で以下を実行します: ${inner.detail} システム設定が変更される可能性があります。`,
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
        summary: `${runtimeName} で ${script} を実行`,
        detail: `${runtimeName} ランタイムでスクリプト ${script} を実行します。`,
      };
    },
  },
  // mkdir
  {
    pattern: /^mkdir\s+(.+)$/,
    describe: (match) => {
      const dir = match[1].replace(/-p\s*/, '').trim();
      return {
        summary: `ディレクトリ ${dir} を作成`,
        detail: `ディレクトリ ${dir} を作成します。`,
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
        summary: `${src} を ${dst} に移動/名前変更`,
        detail: `${src} を ${dst} に移動または名前変更します。`,
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
        summary: `${src} を ${dst} にコピー`,
        detail: `${src} を ${dst} にコピーします。`,
      };
    },
  },
  // chmod
  {
    pattern: /^chmod\s+(.+)$/,
    describe: (match) => {
      const args = match[1].trim();
      return {
        summary: 'ファイルの権限を変更',
        detail: `ファイルまたはディレクトリの権限を変更します: chmod ${args}`,
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
        summary: `プロセス ${target} を終了`,
        detail: `${cmd} コマンドでプロセス ${target} を終了します。`,
      };
    },
  },
  // docker
  {
    pattern: /^docker\s+(.+)$/,
    describe: (match) => {
      const subcommand = match[1].split(/\s/)[0];
      return {
        summary: `Docker ${subcommand} を実行`,
        detail: `Docker コマンド "docker ${match[1].trim()}" を実行します。`,
      };
    },
  },
  // ls / cat / head / tail / echo / pwd
  {
    pattern: /^(ls|cat|head|tail|echo|pwd|which|whoami|date|env|printenv)\b(.*)$/,
    describe: (match) => {
      const cmd = match[1];
      const cmdNames: Record<string, string> = {
        ls: 'ファイル一覧を表示',
        cat: 'ファイル内容を表示',
        head: 'ファイル先頭を表示',
        tail: 'ファイル末尾を表示',
        echo: 'テキストを出力',
        pwd: '現在のディレクトリを表示',
        which: 'コマンドのパスを表示',
        whoami: '現在のユーザーを表示',
        date: '日付を表示',
        env: '環境変数を表示',
        printenv: '環境変数を表示',
      };
      return {
        summary: cmdNames[cmd] || `${cmd} を実行`,
        detail: `${cmdNames[cmd] || cmd + ' コマンドを実行'}します。読み取り専用の安全なコマンドです。`,
      };
    },
  },
  // git status / log / diff / show
  {
    pattern: /^git\s+(status|log|diff|show|branch|remote)\b(.*)$/,
    describe: (match) => {
      const sub = match[1];
      const cmdNames: Record<string, string> = {
        status: 'Git の状態を確認',
        log: 'コミット履歴を表示',
        diff: '差分を表示',
        show: 'コミット詳細を表示',
        branch: 'ブランチ一覧を表示',
        remote: 'リモート情報を表示',
      };
      return {
        summary: cmdNames[sub] || `git ${sub} を実行`,
        detail: `${cmdNames[sub] || 'git ' + sub + ' コマンドを実行'}します。`,
      };
    },
  },
  // git add
  {
    pattern: /^git\s+add\b(.*)$/,
    describe: (match) => {
      const files = (match[1] || '').trim();
      return {
        summary: `変更をステージ${files ? `: ${files}` : ''}`,
        detail: `${files || 'ファイル'} の変更をステージングエリアに追加します。`,
      };
    },
  },
];

/**
 * コマンド文字列を解析して日本語説明を生成する
 */
export function describeCommand(command: string): CommandDescription {
  const trimmed = command.trim();

  // パイプで繋がれたコマンドの場合、全体を説明
  if (/\|/.test(trimmed) && !/\|\|/.test(trimmed)) {
    const parts = trimmed.split(/\s*\|\s*/);
    if (parts.length >= 2) {
      const descriptions = parts.map(p => describeCommand(p).summary);
      return {
        summary: descriptions.join(' → '),
        detail: `パイプラインで複数のコマンドを連結して実行します: ${descriptions.join(' → ')}`,
      };
    }
  }

  // && や ; で繋がれたコマンドの場合
  if (/&&|;/.test(trimmed)) {
    const parts = trimmed.split(/\s*(?:&&|;)\s*/);
    if (parts.length >= 2) {
      const descriptions = parts.map(p => describeCommand(p).summary);
      return {
        summary: descriptions.join('、その後 '),
        detail: `複数のコマンドを順次実行します: ${descriptions.join(' → ')}`,
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
    summary: `${firstWord} コマンドを実行`,
    detail: `コマンド "${trimmed}" を実行します。`,
  };
}

/**
 * ツール名に基づく分類
 */
export function classifyTool(toolName: string): string {
  const classifications: Record<string, string> = {
    Bash: 'シェルコマンド実行',
    Read: 'ファイル読み取り',
    Write: 'ファイル書き込み',
    Edit: 'ファイル編集',
    Glob: 'ファイル検索',
    Grep: 'テキスト検索',
    WebFetch: 'Web アクセス',
    Task: 'エージェント起動',
    NotebookEdit: 'ノートブック編集',
  };
  return classifications[toolName] || toolName;
}
