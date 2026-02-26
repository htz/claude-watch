# claude-watch

macOS メニューバー常駐の Electron アプリ。Claude Code のフックシステムと連携し、ツール実行時のパーミッション確認ポップアップとタスク通知を提供する。

## 技術スタック

- **Runtime**: Electron 33 + Node.js
- **言語**: TypeScript (strict), フックスクリプトのみ CommonJS (.js)
- **ビルド**: Electron Forge + Webpack
- **テスト**: Vitest
- **IPC**: Unix ドメインソケット (`~/.claude-watch/watch.sock`)

## ディレクトリ構成

```
src/
├── main/           # Electron メインプロセス (main.ts, server.ts, tray.ts, preload.ts)
├── renderer/       # UI (index.html, renderer.ts, style.css)
├── shared/         # メイン/レンダラー/テスト共有 (types.ts, constants.ts, danger-level.ts, tool-classifier.ts)
└── hooks/          # Claude Code フックスクリプト (CommonJS .js)
scripts/            # セットアップ・ユーティリティ
test/               # Vitest テスト
```

## コマンド

```bash
npm start           # 開発モードで起動
npm test            # テスト実行
npm run setup       # フック登録 (対話式)
npm run setup -- --all    # 全フック一括登録
npm run setup -- --remove # 全フック削除
npm run package     # パッケージング
npm run make        # DMG/ZIP 作成
```

## アーキテクチャ要点

### フックスクリプト (`src/hooks/*.js`)
- Claude Code の `settings.json` から呼び出される **外部プロセス**
- Electron のバンドルには含まれず、Node.js で直接実行される
- そのため **CommonJS (.js)** で記述し、外部依存なし (Node.js 標準モジュールのみ)
- `permission-hook.js`: PreToolUse — ポップアップでユーザー応答を待つ (最大5分)
- `notify-hook.js`: Notification — 通知を送信して即座に終了
- `stop-hook.js`: Stop — タスク完了通知を送信して即座に終了

### パーミッションフックの権限チェック (`permission-hook.js`)
- `settings.json` の `permissions` (allow/deny/ask) を尊重し、Claude 本体と同じ判断を行う
- **設定ファイルの読み込み** (全てマージ):
  1. `~/.claude/settings.json` (グローバル) — allow/deny/ask 全て
  2. `<project>/.claude/settings.json` (プロジェクト、Git 管理) — deny/ask のみ (allow はセキュリティ上無視)
  3. `<project>/.claude/settings.local.json` (プロジェクトローカル、Git 非管理) — allow/deny/ask 全て
- **判定フロー** (deny → ask → allow の順、Claude 本体と同じ):
  - `deny` リストにマッチ → 即座に `permissionDecision: 'deny'` (ポップアップなし)
  - `ask` リストにマッチ → ノーティファイアのポップアップを表示 (危険度は最低 HIGH に引き上げ)
  - `allow` リストにマッチ → `exit(0)` で Claude 本体にフォールスルー (ポップアップなし)
  - 未登録 → ノーティファイアのポップアップを表示
- Bash コマンドは `Bash(git:*)` 形式、非 Bash ツールは `Edit` / `mcp__notion__*` 形式で照合

### サーバー (`src/main/server.ts`)
- Unix ドメインソケットで HTTP リクエストを受け付ける
- `GET /health` — ヘルスチェック
- `POST /permission` — パーミッション要求 (同期: ユーザー応答まで保持)
- `POST /notification` — 通知 (非同期: 即座にレスポンス)

### 危険度分析 (`src/shared/danger-level.ts`)
- 5段階: SAFE / LOW / MEDIUM / HIGH / CRITICAL
- パイプ (`|`) やチェーン (`&&`, `;`) は最も高い危険度を採用
- ツール種別ごとの危険度マッピングあり (Edit=MEDIUM, WebFetch=HIGH 等)

### ツール分類 (`src/shared/tool-classifier.ts`)
- Bash コマンド、Edit、Write、WebFetch、Task、NotebookEdit、MCP ツールを分類
- 日本語で概要・詳細説明を生成

### Webpack パスエイリアス
- `@shared` → `src/shared` (webpack.main.config.ts, webpack.renderer.config.ts, vitest.config.ts で定義)

## コーディング規約

- **日本語**: UI テキスト、ツール説明、コメントは日本語
- **型安全**: `strict: true`、any 禁止
- **フックスクリプト**: CommonJS + 外部依存なし + 必ず exit code 0 (エラー時もフォールバック)
- **テスト**: `danger-level`、`tool-classifier`、`permission-hook` はパターン追加時に必ずテストも追加
- **shared/ の変更**: メインプロセス・フックスクリプト・テストに影響するため慎重に
