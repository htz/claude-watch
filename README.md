# claude-watch

Claude Code のツール実行時に macOS メニューバーからパーミッション確認ポップアップと通知を表示する Electron アプリ。

![macOS menu bar](assets/IconTemplate@2x.png)

## 特徴

- **パーミッションポップアップ** — `Bash`, `Edit`, `Write` など危険なツール実行前に許可/拒否を選択
- **settings.json 権限チェック** — Claude Code の `permissions` (allow/deny/ask) を尊重し、allow 済みツールはポップアップをスキップ
- **危険度バッジ** — コマンドを自動分析し、5段階 (安全/低/中/高/危険) で色分け表示
- **タスク通知** — Notification / Stop フックによるリアルタイム通知
- **キューイング** — 複数リクエストを順番に処理、待機件数を表示
- **キーボードショートカット** — Enter で許可、Esc で拒否
- **ダークモード対応** — macOS のシステムテーマに追従
- **Unix ドメインソケット** — ポート競合なし、セキュアな IPC

## 必要環境

- macOS
- Node.js 18+
- Claude Code (hooks 機能)

## インストール

### Homebrew (推奨)

```bash
brew install --cask htz/claude-watch/claude-watch
```

### 手動インストール

1. [GitHub Releases](https://github.com/htz/claude-watch/releases) から最新の ZIP をダウンロード
2. 展開して Gatekeeper 属性を除去し、Applications に配置:

```bash
xattr -cr "Claude Watch.app"
mv "Claude Watch.app" /Applications/
```

### フック登録

インストール後、セットアップスクリプトで Claude Code のフックを登録します:

```bash
# 全フック一括登録
node "/Applications/Claude Watch.app/Contents/Resources/hooks/setup.js" --all

# 対話式 (フック種類・対象ツールを個別選択)
node "/Applications/Claude Watch.app/Contents/Resources/hooks/setup.js"

# フック削除
node "/Applications/Claude Watch.app/Contents/Resources/hooks/setup.js" --remove
```

登録後、Claude Watch を起動してください:

```bash
open -a "Claude Watch"
```

## 開発向けセットアップ

ソースコードから開発する場合:

```bash
# 依存パッケージのインストール
npm install

# フックの登録 (対話式メニュー)
npm run setup
```

### セットアップオプション

```bash
# 対話式: フック種類と対象ツールを選択
npm run setup

# 全フック・全ツールを一括登録
npm run setup -- --all

# 全フックを削除
npm run setup -- --remove
```

対話式メニューでは、登録するフックと PreToolUse の対象ツールを個別に選択できます:

```
=== フック選択 ===
  [1] PreToolUse (パーミッション確認ポップアップ) [Y/n]: Y
  [2] Notification (タスク通知)                   [Y/n]: Y
  [3] Stop (タスク完了通知)                       [Y/n]: n

=== PreToolUse 対象ツール ===
  [1] Bash              [Y/n]: Y
  [2] Edit              [Y/n]: Y
  [3] Write             [Y/n]: Y
  [4] WebFetch          [Y/n]: n
  [5] NotebookEdit      [Y/n]: n
  [6] Task              [Y/n]: Y
  [7] MCP tools (mcp__) [Y/n]: Y
```

## 使い方

```bash
# アプリを起動 (メニューバーに常駐)
npm start

# Claude Code を通常通り使用
# → ツール実行時にポップアップが表示される
```

## 仕組み

```
Claude Code  ──hook──▶  permission-hook.js  ──HTTP──▶  Electron App
                              │                             │
                         settings.json                ポップアップ表示
                         権限チェック                       │
                              │                       ユーザー応答
                         deny → 即拒否                      │
                         allow → フォールスルー              │
                         ask/未登録 ──────────────▶  ポップアップへ
                                                           │
Claude Code  ◀─────────  allow / deny / skip  ◀────────────┘
```

1. Claude Code がツールを実行しようとすると、`settings.json` に登録されたフックスクリプトが起動
2. フックスクリプトが `settings.json` の `permissions` (allow/deny/ask) を確認:
   - **deny** リストにマッチ → ポップアップなしで即座に拒否
   - **allow** リストにマッチ → ポップアップなしで Claude 本体の許可処理にフォールスルー
   - **ask** リストまたは未登録 → 次のステップへ
3. Unix ドメインソケット経由で Electron アプリにリクエスト送信
4. メニューバーからポップアップが表示され、ユーザーが許可/拒否を選択
5. 応答がフックスクリプト経由で Claude Code に返却される

### 設定ファイルの読み込み

フックスクリプトは以下の設定ファイルを全てマージして権限チェックを行います:

| 優先順 | パス | 用途 |
|---|---|---|
| 1 | `~/.claude/settings.json` | グローバル設定 |
| 2 | `<project>/.claude/settings.json` | プロジェクト設定 (Git 管理) |
| 3 | `<project>/.claude/settings.local.json` | プロジェクトローカル設定 |

これにより、Claude Code 本体の権限設定と一貫した動作を実現します。

## 開発

```bash
# テスト実行
npm test

# テスト (ウォッチモード)
npm run test:watch

# 手動テスト用スクリプト
./scripts/test-popup.sh safe      # 安全なコマンド
./scripts/test-popup.sh danger    # 危険なコマンド
./scripts/test-popup.sh multi     # 複数同時送信
./scripts/test-popup.sh notify    # 通知送信
```

## パッケージング

```bash
# .app バンドル作成
npm run package

# DMG/ZIP 作成
npm run make
```

## ライセンス

MIT
