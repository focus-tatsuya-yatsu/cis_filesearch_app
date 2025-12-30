#!/bin/bash
# =============================================================================
# Next.js 開発サーバー管理スクリプト
# =============================================================================
# 目的: 重複プロセスを防ぎ、クリーンな開発環境を提供
# 使い方: ./scripts/dev-manager.sh [start|stop|restart|status]

set -e

# 色定義
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# プロジェクトルート
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOCK_FILE="$PROJECT_ROOT/.next/dev/lock"
PID_FILE="$PROJECT_ROOT/.next/dev/dev-server.pid"

# =============================================================================
# ヘルパー関数
# =============================================================================

print_header() {
  echo -e "${BLUE}========================================${NC}"
  echo -e "${BLUE}  Next.js 開発サーバー管理${NC}"
  echo -e "${BLUE}========================================${NC}"
}

print_success() {
  echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
  echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
  echo -e "${RED}❌ $1${NC}"
}

print_info() {
  echo -e "${BLUE}ℹ️  $1${NC}"
}

# =============================================================================
# プロセス管理関数
# =============================================================================

check_port() {
  local port=$1
  if lsof -ti:$port > /dev/null 2>&1; then
    return 0  # ポート使用中
  else
    return 1  # ポート空き
  fi
}

get_next_processes() {
  ps aux | grep -E "[n]ext dev" | awk '{print $2}' || true
}

stop_all_processes() {
  print_info "すべてのNext.js開発プロセスを停止しています..."

  # 既存のプロセスを取得
  local pids=$(get_next_processes)

  if [ -z "$pids" ]; then
    print_warning "実行中のプロセスが見つかりませんでした"
  else
    echo "$pids" | while read pid; do
      if kill -15 "$pid" 2>/dev/null; then
        print_success "PID $pid を停止しました"
      fi
    done

    # 強制終了が必要な場合
    sleep 2
    local remaining=$(get_next_processes)
    if [ -n "$remaining" ]; then
      print_warning "強制終了を実行します..."
      echo "$remaining" | xargs kill -9 2>/dev/null || true
    fi
  fi

  # ロックファイルとPIDファイルを削除
  [ -f "$LOCK_FILE" ] && rm -f "$LOCK_FILE" && print_success "ロックファイルを削除しました"
  [ -f "$PID_FILE" ] && rm -f "$PID_FILE" && print_success "PIDファイルを削除しました"
}

start_dev_server() {
  print_info "開発サーバーを起動しています..."

  # ポート3000の確認
  if check_port 3000; then
    print_error "ポート3000は既に使用されています"
    print_info "別のプロセスを確認してください: lsof -ti:3000"
    exit 1
  fi

  cd "$PROJECT_ROOT"

  # バックグラウンドで起動
  yarn dev > "$PROJECT_ROOT/.next/dev/dev-server.log" 2>&1 &
  local pid=$!
  echo $pid > "$PID_FILE"

  print_success "開発サーバーを起動しました (PID: $pid)"
  print_info "ログ: $PROJECT_ROOT/.next/dev/dev-server.log"
  print_info "アクセス: http://localhost:3000"
}

show_status() {
  print_header

  # プロセス確認
  local pids=$(get_next_processes)
  if [ -n "$pids" ]; then
    print_success "実行中のプロセス:"
    echo "$pids" | while read pid; do
      echo "  - PID: $pid"
      ps -p $pid -o comm=,etime= 2>/dev/null | sed 's/^/    /' || true
    done
  else
    print_warning "実行中のプロセスはありません"
  fi

  # ポート確認
  echo ""
  print_info "ポート使用状況:"
  for port in 3000 3001 3002; do
    if check_port $port; then
      echo "  - ポート $port: 使用中"
    else
      echo "  - ポート $port: 空き"
    fi
  done

  # ロックファイル確認
  echo ""
  if [ -f "$LOCK_FILE" ]; then
    print_warning "ロックファイルが存在します: $LOCK_FILE"
  else
    print_success "ロックファイルはありません"
  fi
}

# =============================================================================
# メイン処理
# =============================================================================

case "${1:-status}" in
  start)
    print_header
    start_dev_server
    ;;

  stop)
    print_header
    stop_all_processes
    print_success "すべてのプロセスを停止しました"
    ;;

  restart)
    print_header
    stop_all_processes
    sleep 2
    start_dev_server
    ;;

  status)
    show_status
    ;;

  clean)
    print_header
    print_warning "クリーンアップを実行します（.nextフォルダを削除）"
    read -p "続行しますか? (y/N): " confirm
    if [[ "$confirm" =~ ^[Yy]$ ]]; then
      stop_all_processes
      rm -rf "$PROJECT_ROOT/.next"
      print_success "クリーンアップが完了しました"
      print_info "次回起動時に再ビルドされます"
    else
      print_warning "キャンセルされました"
    fi
    ;;

  *)
    echo "使い方: $0 {start|stop|restart|status|clean}"
    echo ""
    echo "コマンド:"
    echo "  start   - 開発サーバーを起動"
    echo "  stop    - すべてのプロセスを停止"
    echo "  restart - 再起動"
    echo "  status  - 現在の状態を表示"
    echo "  clean   - .nextフォルダを削除してクリーンアップ"
    exit 1
    ;;
esac
