#!/bin/bash
# テストスクリプト: 危険度別のポップアップ送信
# Usage:
#   ./scripts/test-popup.sh              # メニュー表示
#   ./scripts/test-popup.sh safe         # SAFE レベル送信
#   ./scripts/test-popup.sh multi        # 3件同時送信
#   ./scripts/test-popup.sh notify       # 通知送信

HOST="http://127.0.0.1:19400"

send_permission() {
  local cmd="$1"
  local desc="$2"
  local cwd="$3"
  curl -s -X POST "$HOST/permission" \
    -H 'Content-Type: application/json' \
    -d "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"$cmd\",\"description\":\"$desc\"},\"session_cwd\":\"$cwd\"}"
}

send_notification() {
  local msg="$1"
  local title="${2:-通知}"
  local type="${3:-info}"
  local cwd="${4:-$(pwd)}"
  curl -s -X POST "$HOST/notification" \
    -H 'Content-Type: application/json' \
    -d "{\"message\":\"$msg\",\"title\":\"$title\",\"type\":\"$type\",\"session_cwd\":\"$cwd\"}"
}

case "${1:-menu}" in
  health)
    curl -s "$HOST/health" | python3 -m json.tool
    ;;
  safe)
    echo "=== SAFE: ls -la ==="
    send_permission "ls -la" "List files" "/Users/masashi.nishiwaki/work/claude-code-notifier"
    echo
    ;;
  low)
    echo "=== LOW: npm test ==="
    send_permission "npm test" "Run tests" "/Users/masashi.nishiwaki/work/claude-code-notifier"
    echo
    ;;
  medium)
    echo "=== MEDIUM: npm install express ==="
    send_permission "npm install express" "Install express" "/Users/masashi.nishiwaki/work/hacomono-app"
    echo
    ;;
  high)
    echo "=== HIGH: rm -rf node_modules ==="
    send_permission "rm -rf node_modules" "Remove node_modules" "/Users/masashi.nishiwaki/work/hacomono"
    echo
    ;;
  critical)
    echo "=== CRITICAL: sudo rm -rf / ==="
    send_permission "sudo rm -rf /" "Dangerous system command" "/Users/masashi.nishiwaki/work/haconiwa"
    echo
    ;;
  all)
    echo "=== 全レベル順番にテスト ==="
    for level in safe low medium high critical; do
      echo ""
      "$0" "$level"
      echo "--- 次のレベルへ (Enter で続行) ---"
      read
    done
    ;;
  multi)
    echo "=== 3件同時送信 ==="
    send_permission "ls -la" "List files" "/Users/masashi.nishiwaki/work/claude-code-notifier" &
    send_permission "npm install" "Install deps" "/Users/masashi.nishiwaki/work/hacomono" &
    send_permission "rm -rf /tmp/test" "Delete temp" "/Users/masashi.nishiwaki/work/haconiwa" &
    wait
    echo
    ;;
  notify)
    echo "=== 通知: 完了 ==="
    send_notification "タスクが完了しました" "完了" "stop" "/Users/masashi.nishiwaki/work/claude-code-notifier"
    echo
    ;;
  notify-info)
    echo "=== 通知: 情報 ==="
    send_notification "Claude is waiting for your input" "入力待ち" "question" "/Users/masashi.nishiwaki/work/hacomono-app"
    echo
    ;;
  long)
    echo "=== LONG: 長いコマンド ==="
    send_permission "find /usr/local/lib/node_modules -name '*.js' -exec grep -l 'require' {} \\; | xargs sed -i '' 's/require/import/g' && npm run build && npm run test -- --coverage --reporter=verbose --bail && echo 'done'" "Search all JS files in node_modules for require statements, replace them with import, then run build and tests with verbose coverage reporting" "/Users/masashi.nishiwaki/work/claude-code-notifier"
    echo
    ;;
  menu|*)
    echo "Claude Code Notifier テストスクリプト"
    echo ""
    echo "Usage: $0 <command>"
    echo ""
    echo "Commands:"
    echo "  health      ヘルスチェック"
    echo "  safe        SAFE レベル (ls -la)"
    echo "  low         LOW レベル (npm test)"
    echo "  medium      MEDIUM レベル (npm install)"
    echo "  high        HIGH レベル (rm -rf node_modules)"
    echo "  critical    CRITICAL レベル (sudo rm -rf /)"
    echo "  all         全レベル順番にテスト"
    echo "  multi       3件同時送信"
    echo "  notify      完了通知"
    echo "  notify-info 入力待ち通知"
    echo "  long        長いコマンド (スクロール確認)"
    ;;
esac
