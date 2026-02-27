# claude-watch

macOS メニューバー常駐の Electron アプリ。Claude Code のフックシステムと連携し、ツール実行時のパーミッション確認ポップアップとタスク通知を提供する。

## 技術スタック

- **Runtime**: Electron 33 + Node.js
- **言語**: TypeScript (strict), フックスクリプトのみ CommonJS (.js)
- **ビルド**: Electron Forge + Webpack
- **テスト**: Vitest
- **パーサー**: web-tree-sitter + tree-sitter-bash (WASM, ABI 15)
- **IPC**: Unix ドメインソケット (`~/.claude-watch/watch.sock`)

## ディレクトリ構成

```
src/
├── main/           # Electron メインプロセス (main.ts, server.ts, tray.ts, preload.ts)
├── renderer/       # UI (index.html, renderer.ts, style.css)
├── shared/         # メイン/レンダラー/テスト共有 (types.ts, constants.ts, danger-level.ts, tool-classifier.ts)
└── hooks/          # Claude Code フックスクリプト (CommonJS .js)
scripts/            # セットアップ・ユーティリティ (setup.ts, copy-wasm.js)
vendor/             # tree-sitter-bash.wasm (ABI 15, v0.25.1 公式リリース)
assets/             # アプリアイコン (icon.icns, IconTemplate*.png)
test/               # Vitest テスト
```

## コマンド

```bash
npm install         # 依存インストール (postinstall で WASM コピーも実行)
npm start           # 開発モードで起動
npm test            # テスト実行
npm run build       # TypeScript 型チェック (noEmit)
npm run setup       # フック登録 (対話式)
npm run setup -- --all    # 全フック一括登録
npm run setup -- --remove # 全フック削除
npm run package     # パッケージング (.app 生成)
npm run make        # DMG/ZIP 作成
```

## アーキテクチャ要点

### フックスクリプト (`src/hooks/*.js`)
- Claude Code の `settings.json` から呼び出される **外部プロセス**
- Electron のバンドルには含まれず、Node.js で直接実行される
- **CommonJS (.js)** で記述、外部依存は `web-tree-sitter` (WASM) のみ (`permission-hook.js`)
- `permission-hook.js`: PreToolUse — ポップアップでユーザー応答を待つ (最大5分)
- `notify-hook.js`: Notification — 通知を送信して即座に終了
- `stop-hook.js`: Stop — タスク完了通知を送信して即座に終了

### パーミッションフックのコマンド解析 (`permission-hook.js`)
- **tree-sitter-bash (WASM)** で Bash コマンドを AST にパースし、全 `command` ノードを抽出
- 配列定義 (`files=(...)`)、ヒアドキュメント、制御構造を正しく認識しコマンドと区別
- `vendor/tree-sitter-bash.wasm` — tree-sitter-bash v0.25.1 公式リリース (ABI 15)
- `scripts/copy-wasm.js` (postinstall) で `vendor/` → `node_modules/web-tree-sitter/` にコピー
- tree-sitter 初期化失敗時は graceful degradation (入力全体を1コマンドとして扱う)
- AST ノード型の扱い:
  - `command` → コマンドとして抽出
  - `variable_assignment` + `array` → コマンドではない (スキップ)
  - `declaration_command` (export/local/declare) → コマンドではない (内部の `$()` のみ再帰走査)
  - `command_substitution` → 内部のコマンドを再帰的に抽出
  - 動的コマンド名 (`$cmd`, `${cmd}`) → `hasUnresolvable: true`

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
- Unix ドメインソケット (`~/.claude-watch/watch.sock`) で HTTP リクエストを受け付ける
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

### Electron パッケージング (`forge.config.ts`)
- `LSUIElement: true` — Dock に表示しないメニューバーアプリ
- `extraResource`: `./src/hooks`, `./assets`, `./node_modules/web-tree-sitter` をバンドル
- Makers: ZIP (darwin) + DMG

## コーディング規約

- **日本語**: UI テキスト、ツール説明、コメントは日本語
- **型安全**: `strict: true`、any 禁止
- **フックスクリプト**: CommonJS + 必ず exit code 0 (エラー時もフォールバック)
  - `permission-hook.js` のみ `web-tree-sitter` に依存 (WASM)
  - `notify-hook.js`, `stop-hook.js` は Node.js 標準モジュールのみ
- **テスト**: `danger-level`、`tool-classifier`、`permission-hook` はパターン追加時に必ずテストも追加
- **shared/ の変更**: メインプロセス・フックスクリプト・テストに影響するため慎重に

## リリース手順

1. `package.json` の `version` を更新
2. バージョンバンプをコミット: `chore: bump version to X.Y.Z`
3. タグを作成して push:
   ```bash
   git tag vX.Y.Z
   git push origin main --tags
   ```
4. GitHub Actions (`.github/workflows/release.yml`) が `v*` タグ push をトリガーに自動実行:
   - テスト → arm64 ビルド → GitHub Release 作成 (ZIP + SHA256)
   - `TAP_GITHUB_TOKEN` シークレットが設定されていれば Homebrew tap (`htz/homebrew-claude-watch`) も自動更新

## tree-sitter-bash WASM の更新手順

tree-sitter-bash の新しいバージョンがリリースされた場合:

1. GitHub Releases からダウンロード:
   ```bash
   gh release download vX.Y.Z --repo tree-sitter/tree-sitter-bash -p 'tree-sitter-bash.wasm'
   ```
2. `vendor/tree-sitter-bash.wasm` を差し替え
3. `web-tree-sitter` のバージョンと **ABI 互換性**を確認 (WASM と web-tree-sitter のメジャーバージョンが一致すること)
4. `npm install` で postinstall が WASM をコピーし、`npm test` で動作確認
