# claude-watch

[日本語](README.md)

An Electron app that lives in the macOS menu bar, providing permission confirmation popups and notifications when Claude Code executes tools.

## Screenshots

### Permission Confirmation Popup

Displays a popup with a color-coded danger badge before Claude Code executes a tool.

| Safe Command | Dangerous Command | Critical (with Queue) |
|:---:|:---:|:---:|
| ![SAFE](assets/screenshots/permission-safe.png) | ![HIGH](assets/screenshots/permission-high.png) | ![CRITICAL](assets/screenshots/permission-critical.png) |
| Read-only commands like `git status` | Destructive commands like `rm -rf` | Commands with `sudo`, queue count badge |

### Non-Bash Tools

Supports tools beyond Bash (`Edit`, `Write`, `WebFetch`, `MCP`, etc.).

| Edit Tool |
|:---:|
| ![Edit](assets/screenshots/permission-edit.png) |
| File edit confirmation |

### Notifications

Real-time notifications for task completion and input requests.

| Task Completed | Waiting for Input |
|:---:|:---:|
| ![Stop](assets/screenshots/notification-stop.png) | ![Question](assets/screenshots/notification-question.png) |
| Stop hook completion notice (auto-dismiss after 5s) | Question notice (stays until manually dismissed) |

## Features

- **Permission Popups** — Allow/deny before executing dangerous tools like `Bash`, `Edit`, `Write`
- **settings.json Permission Check** — Respects Claude Code's `permissions` (deny/ask/allow), evaluated in deny → ask → allow order
- **bypassPermissions Support** — Auto-skips all popups when `--dangerously-skip-permissions` or `defaultMode: "bypassPermissions"` is active
- **Danger Badges** — Auto-analyzes commands into 5 levels (safe/low/medium/high/critical) with color coding. Tools matching the ask list are elevated to at least HIGH
- **Bash Command AST Parsing** — Parses commands with tree-sitter-bash for precise per-subcommand permission checks across pipes and chains
- **Task Notifications** — Real-time notifications via Notification / Stop hooks
- **Queuing** — Processes multiple requests sequentially with pending count display (permissions take priority over notifications)
- **Keyboard Shortcuts** — `⌘Enter` to allow, `Esc` to deny (active only while popup is visible)
- **Non-intrusive UI** — Popups appear without stealing focus (`showInactive`). On focus loss, auto-skips to Claude Code's native dialog
- **i18n** — Auto-detects Japanese/English from system locale, with manual switching from the tray menu
- **Dark Mode** — Follows macOS system theme
- **Unix Domain Socket** — No port conflicts, owner-only access (0o700/0o600)
- **Graceful Degradation** — Falls back to Claude Code's native dialog via exit(0) when the app is not running or on error

## Requirements

- macOS
- Node.js 18+
- Claude Code (hooks feature)

## Installation

### Homebrew (Recommended)

```bash
brew install --cask htz/claude-watch/claude-watch
```

### Manual Installation

1. Download the latest ZIP from [GitHub Releases](https://github.com/htz/claude-watch/releases)
2. Extract, remove the Gatekeeper quarantine attribute, and move to Applications:

```bash
xattr -cr "Claude Watch.app"
mv "Claude Watch.app" /Applications/
```

### Hook Registration

After installation, register Claude Code hooks using the setup script:

```bash
# Register all hooks at once
node "/Applications/Claude Watch.app/Contents/Resources/hooks/setup.js" --all

# Interactive (select hook types and target tools individually)
node "/Applications/Claude Watch.app/Contents/Resources/hooks/setup.js"

# Remove all hooks
node "/Applications/Claude Watch.app/Contents/Resources/hooks/setup.js" --remove
```

Then launch Claude Watch:

```bash
open -a "Claude Watch"
```

## Development Setup

To develop from source:

```bash
# Install dependencies
npm install

# Register hooks (interactive menu)
npm run setup
```

### Setup Options

```bash
# Interactive: select hook types and target tools
npm run setup

# Register all hooks and tools at once
npm run setup -- --all

# Remove all hooks
npm run setup -- --remove
```

The interactive menu lets you select which hooks to register and which tools to target for PreToolUse:

```
=== Hook Selection ===
  [1] PreToolUse (permission confirmation popup) [Y/n]: Y
  [2] Notification (task notifications)          [Y/n]: Y
  [3] Stop (task completion notification)        [Y/n]: n

=== PreToolUse Target Tools ===
  [1] Bash              [Y/n]: Y
  [2] Edit              [Y/n]: Y
  [3] Write             [Y/n]: Y
  [4] WebFetch          [Y/n]: n
  [5] NotebookEdit      [Y/n]: n
  [6] Task              [Y/n]: Y
  [7] MCP tools (mcp__) [Y/n]: Y
```

## Usage

```bash
# Launch the app (resides in the menu bar)
npm start

# Use Claude Code as usual
# → Popups appear when tools are executed
```

### Popup Controls

| Action | Permission | Notification |
|---|---|---|
| `⌘Enter` | Allow | Dismiss |
| `Esc` | Deny | Dismiss |
| × button | Skip (delegate to Claude Code) | Dismiss |
| Focus loss | Skip (delegate to Claude Code) | — |

- **Allow** — Permits the tool execution
- **Deny** — Rejects the tool execution
- **Skip** — Falls back to Claude Code's native dialog without going through Claude Watch

### Timeouts

- Permission: auto-denied after **5 minutes** with no response
- Notification (`info`/`stop`): auto-dismissed after **5 seconds**
- Notification (`question`): stays visible until manually dismissed

## How It Works

```
Claude Code  ──hook──▶  permission-hook.js  ──HTTP──▶  Electron App
                              │                             │
                         Read/Glob/Grep               Popup display
                         → auto-skip                  (with danger badge)
                              │                             │
                         bypassPermissions            User response
                         → skip all                        │
                              │                             │
                         settings.json                     │
                         permission check                  │
                              │                             │
                         deny → reject immediately         │
                         ask  → show popup ────────▶       │
                         allow → fall through               │
                         unlisted → show popup ────▶       │
                              │                             │
                         command injection detected         │
                         → notify + fall through            │
                                                           │
Claude Code  ◀─────────  allow / deny / skip  ◀────────────┘
```

1. When Claude Code attempts to execute a tool, the hook script registered in `settings.json` is invoked
2. **Read-only tool skip** — `Read`, `Glob`, `Grep` are immediately skipped as safe (exit 0)
3. **bypassPermissions check** — Skips all popups and falls through to Claude Code when any of the following apply:
   - Claude Code was launched with `--dangerously-skip-permissions` (detected via stdin `permission_mode`)
   - `permissions.defaultMode: "bypassPermissions"` is configured
4. `settings.json` `permissions` (deny/ask/allow) are evaluated in **deny → ask → allow** order:
   - **deny** list match → immediately rejected without popup (even with bypassPermissions)
   - **ask** list match → shows popup (danger level elevated to at least HIGH)
   - **allow** list match → falls through to Claude Code's native permission handling (no popup)
   - **unlisted** → shows popup
5. **Bash command detailed check** — Parsed into AST with tree-sitter-bash, extracting individual subcommands:
   - All subcommands match allow → auto-allowed (no popup)
   - Partial match → unmatched commands shown as chips in popup
   - Command injection detected (`$()`, `` ` ` ``, `>()`, `$var`, etc.) → sends notification and delegates to Claude Code
6. Request sent to the Electron app via Unix domain socket
7. Popup appears from the menu bar; user selects allow/deny/skip
8. Response is returned to Claude Code through the hook script

### Danger Level Assessment

#### Bash Commands

Commands are classified into 5 levels by pattern matching. For piped (`|`) or chained (`&&`, `;`) commands, the highest danger level is adopted:

| Level | Color | Representative Patterns |
|---|---|---|
| SAFE | Green | `ls`, `cat`, `echo`, `git status`, `git log`, `git diff` |
| LOW | Green | `npm test`, `git add`, `grep`, `find` |
| MEDIUM | Yellow | `npm install`, `git commit`, `mkdir`, `cp`, `mv`, `node`, unknown commands |
| HIGH | Orange | `rm -rf`, `git push`, `curl`, `chmod`, `kill`, `docker rm` |
| CRITICAL | Red | `sudo`, `rm -rf /`, `dd of=`, `mkfs`, `chmod 777 /` |

#### Non-Bash Tools

Fixed danger levels assigned per tool type:

| Level | Tools |
|---|---|
| SAFE | `Read`, `Glob`, `Grep` (popup is skipped entirely) |
| LOW | `Task` |
| MEDIUM | `Edit`, `Write`, `NotebookEdit`, MCP tools, unknown tools |
| HIGH | `WebFetch` |

### Settings File Loading

The hook script merges the following settings files for permission checks (same as Claude Code):

| Priority | Path | Applied Lists | bypassPermissions |
|---|---|---|---|
| 1 | `~/.claude/settings.json` | all of allow / deny / ask | Respected |
| 2 | `<project>/.claude/settings.json` | all of allow / deny / ask | Ignored* |
| 3 | `<project>/.claude/settings.local.json` | all of allow / deny / ask | Respected |

\* `bypassPermissions` from Git-tracked project settings is ignored as a safeguard against malicious repositories.

The deny → ask → allow evaluation order ensures that deny always takes highest priority.

### Pattern Syntax

Patterns used in `permissions` allow/deny/ask lists:

| Pattern | Description | Example |
|---|---|---|
| `Bash(cmd)` | Exact match (prefix match) | `Bash(git status)` → matches `git status` |
| `Bash(cmd:*)` | Prefix match | `Bash(git:*)` → matches all commands starting with `git` |
| `Bash(pattern*)` | Wildcard | `Bash(npm run *)` → matches `npm run build`, etc. |
| `Edit` | Exact tool name match | `Edit` → matches the Edit tool |
| `mcp__*` | Wildcard | `mcp__notion__*` → matches all Notion MCP methods |

Bash patterns are matched after stripping leading environment variable assignments (`NODE_ENV=test npm test` → `npm test`).

### Queue Priority

When permission requests and notifications occur simultaneously:

1. **Permission requests** — Highest priority. Notifications wait until all are processed
2. **Notifications** — Displayed in FIFO order after the permission queue is empty

## Development

```bash
# Run tests
npm test

# Watch mode
npm run test:watch

# Manual test scripts
./scripts/test-popup.sh safe         # SAFE level (ls -la)
./scripts/test-popup.sh high         # HIGH level (rm -rf)
./scripts/test-popup.sh critical     # CRITICAL level (sudo rm -rf /)
./scripts/test-popup.sh multi        # 3 simultaneous requests
./scripts/test-popup.sh notify       # Completion notification
./scripts/test-popup.sh notify-info  # Input waiting notification
./scripts/test-popup.sh edit         # Edit tool
./scripts/test-popup.sh webfetch     # WebFetch tool
./scripts/test-popup.sh mcp          # MCP tool
```

## Packaging

```bash
# Build .app bundle
npm run package

# Create DMG/ZIP
npm run make
```

## License

MIT
