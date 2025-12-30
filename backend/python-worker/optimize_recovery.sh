#!/bin/bash

# =============================================================================
# DLQ Recovery Optimization Script
# =============================================================================
# このスクリプトはDLQリカバリーを最適化し、処理速度を向上させます
#
# 最適化内容:
# 1. バッチサイズの増加（10 -> 100）
# 2. 並列処理の有効化
# 3. 待機時間の削減
#
# 使用方法:
#   chmod +x optimize_recovery.sh
#   ./optimize_recovery.sh
# =============================================================================

set -e

# ANSI color codes
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}╔════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║         DLQ Recovery Optimization                              ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════════╝${NC}"
echo ""

# 現在のリカバリープロセスをチェック
echo -e "${YELLOW}Checking current recovery process...${NC}"
CURRENT_PROCESS=$(ps aux | grep "recover_dlq_messages.py" | grep -v grep || true)

if [ ! -z "$CURRENT_PROCESS" ]; then
    echo -e "${GREEN}✓ Recovery process is running:${NC}"
    echo "$CURRENT_PROCESS"
    echo ""
    echo -e "${YELLOW}Do you want to restart with optimized settings? (y/n)${NC}"
    read -r RESPONSE
    if [ "$RESPONSE" != "y" ]; then
        echo "Optimization cancelled."
        exit 0
    fi
    echo ""
    echo -e "${YELLOW}Stopping current process...${NC}"
    pkill -f "recover_dlq_messages.py" || true
    sleep 2
fi

# 最適化されたリカバリースクリプトを作成
cat > /tmp/optimized_recover.py << 'EOF'
#!/usr/bin/env python3
"""
最適化されたDLQリカバリースクリプト

改善点:
- バッチサイズを100に増加
- 並列処理の有効化（5スレッド）
- 待機時間の最適化
- 詳細なプログレス表示
"""

import boto3
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime

# Configuration
DLQ_URL = "https://sqs.ap-northeast-1.amazonaws.com/590183743917/file-metadata-queue-dlq.fifo"
MAIN_QUEUE_URL = "https://sqs.ap-northeast-1.amazonaws.com/590183743917/file-metadata-queue.fifo"
REGION = "ap-northeast-1"
BATCH_SIZE = 100  # 10から100に増加
MAX_WORKERS = 5   # 並列スレッド数
WAIT_TIME = 5     # ポーリング待機時間（秒）

# SQS client
sqs = boto3.client('sqs', region_name=REGION)

def get_queue_size(queue_url):
    """キューのメッセージ数を取得"""
    response = sqs.get_queue_attributes(
        QueueUrl=queue_url,
        AttributeNames=['ApproximateNumberOfMessages']
    )
    return int(response['Attributes']['ApproximateNumberOfMessages'])

def process_batch(batch_num, messages):
    """メッセージバッチを処理"""
    try:
        # メインキューに送信するエントリを準備
        entries = []
        for i, msg in enumerate(messages):
            entries.append({
                'Id': f'msg-{batch_num}-{i}',
                'MessageBody': msg['Body'],
                'MessageGroupId': json.loads(msg['Body']).get('file_path', f'group-{batch_num}')
            })

        # メインキューに送信（最大10件ずつ）
        sent_count = 0
        for i in range(0, len(entries), 10):
            batch = entries[i:i+10]
            sqs.send_message_batch(
                QueueUrl=MAIN_QUEUE_URL,
                Entries=batch
            )
            sent_count += len(batch)

        # DLQから削除
        delete_entries = [
            {'Id': f'del-{i}', 'ReceiptHandle': msg['ReceiptHandle']}
            for i, msg in enumerate(messages)
        ]

        for i in range(0, len(delete_entries), 10):
            batch = delete_entries[i:i+10]
            sqs.delete_message_batch(
                QueueUrl=DLQ_URL,
                Entries=batch
            )

        return sent_count
    except Exception as e:
        print(f"❌ Error processing batch {batch_num}: {e}", file=sys.stderr)
        return 0

def main():
    print(f"🚀 Starting optimized DLQ recovery at {datetime.now().strftime('%H:%M:%S')}")
    print(f"📊 Configuration: Batch size={BATCH_SIZE}, Workers={MAX_WORKERS}")
    print("")

    # 初期カウント
    initial_count = get_queue_size(DLQ_URL)
    print(f"📝 Initial DLQ messages: {initial_count:,}")
    print("")

    if initial_count == 0:
        print("✅ No messages to recover")
        return

    total_processed = 0
    batch_num = 0
    start_time = time.time()

    while True:
        # メッセージを受信
        response = sqs.receive_message(
            QueueUrl=DLQ_URL,
            MaxNumberOfMessages=10,  # SQSの最大値
            WaitTimeSeconds=WAIT_TIME,
            AttributeNames=['All']
        )

        messages = response.get('Messages', [])

        if not messages:
            remaining = get_queue_size(DLQ_URL)
            if remaining == 0:
                print("\n✅ All messages recovered!")
                break
            else:
                print(f"⏳ Waiting for messages... ({remaining:,} remaining)")
                time.sleep(2)
                continue

        # バッチを収集（BATCH_SIZEまで）
        all_messages = messages
        while len(all_messages) < BATCH_SIZE:
            response = sqs.receive_message(
                QueueUrl=DLQ_URL,
                MaxNumberOfMessages=min(10, BATCH_SIZE - len(all_messages)),
                WaitTimeSeconds=1
            )
            new_messages = response.get('Messages', [])
            if not new_messages:
                break
            all_messages.extend(new_messages)

        # 並列処理
        batch_num += 1
        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
            # メッセージを小さいバッチに分割（SQSの制限に対応）
            chunks = [all_messages[i:i+10] for i in range(0, len(all_messages), 10)]
            futures = [
                executor.submit(process_batch, f"{batch_num}-{i}", chunk)
                for i, chunk in enumerate(chunks)
            ]

            # 結果を収集
            for future in as_completed(futures):
                count = future.result()
                total_processed += count

        # 進捗表示
        elapsed = time.time() - start_time
        rate = total_processed / elapsed if elapsed > 0 else 0
        remaining = get_queue_size(DLQ_URL)
        progress = (total_processed / initial_count * 100) if initial_count > 0 else 0
        eta_seconds = (remaining / rate) if rate > 0 else 0
        eta_minutes = int(eta_seconds / 60)

        print(f"📦 Batch {batch_num}: Processed {len(all_messages):,} messages")
        print(f"   Total: {total_processed:,}/{initial_count:,} ({progress:.1f}%)")
        print(f"   Rate: {rate:.2f} msg/sec")
        print(f"   Remaining: {remaining:,}")
        print(f"   ETA: ~{eta_minutes} minutes")
        print("")

    # 最終統計
    total_time = time.time() - start_time
    avg_rate = total_processed / total_time if total_time > 0 else 0

    print("=" * 60)
    print(f"🎉 Recovery completed!")
    print(f"   Total processed: {total_processed:,} messages")
    print(f"   Total time: {int(total_time/60)}m {int(total_time%60)}s")
    print(f"   Average rate: {avg_rate:.2f} msg/sec")
    print("=" * 60)

if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print("\n⚠️  Recovery interrupted by user")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ Fatal error: {e}", file=sys.stderr)
        sys.exit(1)
EOF

chmod +x /tmp/optimized_recover.py

echo -e "${GREEN}✓ Optimized recovery script created${NC}"
echo ""

# スクリプトを実行
echo -e "${YELLOW}Starting optimized recovery...${NC}"
echo -e "${BLUE}Note: This will run in the foreground. Press Ctrl+C to stop.${NC}"
echo ""

sleep 2

python3 /tmp/optimized_recover.py
