# AWS DataSync パフォーマンス最適化ガイド

**作成日**: 2025-01-17
**対象**: パフォーマンスエンジニア、DevOpsチーム
**所要時間**: 実装3-4時間、チューニング継続的
**前提条件**: DataSync設定完了、初回同期実行済み

---

## 📋 目次

1. [概要](#概要)
2. [現状分析とベースライン設定](#現状分析とベースライン設定)
3. [ネットワーク帯域幅最適化](#ネットワーク帯域幅最適化)
4. [DataSync Task設定の最適化](#datasync-task設定の最適化)
5. [並列実行戦略](#並列実行戦略)
6. [ファイルフィルタリング最適化](#ファイルフィルタリング最適化)
7. [スケジューリング最適化](#スケジューリング最適化)
8. [S3マルチパートアップロード設定](#s3マルチパートアップロード設定)
9. [コスト vs パフォーマンストレードオフ](#コスト-vs-パフォーマンストレードオフ)
10. [パフォーマンス監視メトリクス](#パフォーマンス監視メトリクス)
11. [増分同期最適化](#増分同期最適化)
12. [大容量ファイル vs 小容量ファイル最適化](#大容量ファイル-vs-小容量ファイル最適化)
13. [実装チェックリスト](#実装チェックリスト)

---

## 概要

### CISプロジェクトの要件

```
初回同期:
  - データ量: 10TB
  - ファイル数: 5,000,000 (500万)
  - 平均ファイルサイズ: 2MB
  - 最大ファイルサイズ: 1GB
  - ファイル形式: PDF (40%), Office (30%), Images (20%), CAD/SFC (10%)

月次差分同期:
  - データ量: 500GB
  - ファイル数: 100,000
  - 新規ファイル: 80%, 更新ファイル: 20%

ネットワーク環境:
  - 利用可能帯域幅: 1Gbps (実効速度: 700-800Mbps)
  - 接続方式: インターネット経由（HTTPS Port 443）
  - レイテンシ: 10-20ms (オンプレミス → AWS ap-northeast-1)

処理パイプライン:
  S3 → EventBridge → SQS → EC2 Spot Instances
```

### パフォーマンス目標

| フェーズ | 目標転送時間 | 実効スループット | 目標達成率 |
|---------|------------|---------------|-----------|
| **初回同期 (10TB)** | 48時間以内 | 450 Mbps | 高優先度 |
| **月次同期 (500GB)** | 3時間以内 | 350 Mbps | 必須 |
| **緊急手動同期** | 1時間以内 | 600 Mbps | 努力目標 |

### 期待される改善効果

```
最適化前（ベースライン）:
  - 初回同期: 72時間 (3日)
  - 月次同期: 6時間
  - 実効スループット: 250 Mbps

最適化後（目標）:
  - 初回同期: 40時間 (1.67日) → 44%短縮
  - 月次同期: 2.5時間 → 58%短縮
  - 実効スループット: 550 Mbps → 120%向上
```

---

## 現状分析とベースライン設定

### Step 1: 初回転送パフォーマンス測定

#### テスト転送の実施

```bash
# 100GBのサンプルデータで初期パフォーマンス測定
# NAS上に専用テストフォルダを作成
# \\192.168.1.100\FileShare\PerformanceTest\

# テストデータ構成:
# - 大容量ファイル (100MB-1GB): 20個 = 10GB
# - 中容量ファイル (10MB-100MB): 500個 = 30GB
# - 小容量ファイル (100KB-10MB): 10,000個 = 60GB
# 合計: 10,520個, 100GB

# DataSync Task一時設定変更
# Source Location → Subdirectory: /PerformanceTest

# Task手動実行
aws datasync start-task-execution \
  --task-arn arn:aws:datasync:ap-northeast-1:770923989980:task/task-0abc123 \
  --profile AdministratorAccess-770923989980

# 実行ID取得
TASK_EXEC_ARN=$(aws datasync list-task-executions \
  --task-arn arn:aws:datasync:ap-northeast-1:770923989980:task/task-0abc123 \
  --max-results 1 \
  --query 'TaskExecutions[0].TaskExecutionArn' \
  --output text \
  --profile AdministratorAccess-770923989980)

echo "Task Execution ARN: $TASK_EXEC_ARN"
```

#### リアルタイム監視

```bash
# ステータス監視スクリプト
#!/bin/bash

TASK_EXEC_ARN="arn:aws:datasync:ap-northeast-1:770923989980:task/task-0abc123/execution/exec-0xyz789"

while true; do
  STATUS=$(aws datasync describe-task-execution \
    --task-execution-arn $TASK_EXEC_ARN \
    --query 'Status' \
    --output text \
    --profile AdministratorAccess-770923989980)

  if [ "$STATUS" == "SUCCESS" ] || [ "$STATUS" == "ERROR" ]; then
    aws datasync describe-task-execution \
      --task-execution-arn $TASK_EXEC_ARN \
      --profile AdministratorAccess-770923989980
    break
  fi

  echo "$(date '+%Y-%m-%d %H:%M:%S') - Status: $STATUS"
  sleep 30
done
```

#### ベースラインメトリクス記録

```json
{
  "baseline_test": {
    "date": "2025-01-17T14:00:00Z",
    "data_volume_gb": 100,
    "file_count": 10520,
    "results": {
      "duration_seconds": 7200,
      "duration_hours": 2.0,
      "files_transferred": 10520,
      "bytes_transferred": 107374182400,
      "average_throughput_mbps": 119.3,
      "files_per_second": 1.46,
      "bottlenecks_identified": [
        "Small file overhead",
        "Network MTU default (1500)",
        "Agent VM CPU 80% utilization"
      ]
    }
  }
}
```

### Step 2: ボトルネック分析

#### Agent VM リソース使用率

```bash
# DataSync Agent VMにSSH接続（診断用の一時的アクセス）
# Agent VMのIPアドレス: 192.168.1.50

ssh -i datasync-agent-key.pem admin@192.168.1.50

# CPU使用率チェック
top -bn1 | grep "Cpu(s)"
# 期待値: idle > 20% （使用率 < 80%）

# メモリ使用率チェック
free -h
# 期待値: available > 8GB （32GB搭載の場合）

# ネットワークスループット
iftop -i eth0
# 期待値: 送信 > 100 Mbps

# ディスクI/O
iostat -x 5 3
# 期待値: %util < 60%
```

#### ネットワーク帯域幅テスト

```bash
# Agent VMからAWS S3エンドポイントへの帯域幅テスト
# iperf3を使用（事前インストール必要）

# AWS側でEC2インスタンスを一時起動してiperf3サーバーとして使用
# EC2 (ap-northeast-1): t3.large, Security Group: Port 5201 ALLOW

# Agent VM側（クライアント）
iperf3 -c <EC2-Public-IP> -t 60 -P 10
# -t 60: 60秒間テスト
# -P 10: 10並列接続

# 期待される結果:
# [SUM] 0.00-60.00 sec  5.25 GBytes   752 Mbits/sec
# → 実効帯域幅: 750 Mbps (1Gbps物理回線の75%利用率)
```

### Step 3: ファイルタイプ別転送速度分析

```bash
# CloudWatch Logs Insightsクエリ
# ファイルサイズ別の転送速度分析

fields @timestamp, @message
| filter @message like /Transferring:/
| parse @message "Transferring: * (*)" as filename, size
| parse size /(?<size_value>\d+(?:\.\d+)?)\s*(?<size_unit>\w+)/
| stats count() as file_count,
        avg(size_value) as avg_size,
        sum(size_value) as total_size
  by size_unit
| sort total_size desc
```

---

## ネットワーク帯域幅最適化

### 1. MTU（Maximum Transmission Unit）最適化

#### 問題

```
デフォルトMTU: 1500 Bytes
→ 小さなパケットサイズによるオーバーヘッド増加
→ 1GBファイル転送時に約700,000パケット必要
→ パケット処理によるCPU負荷増加
```

#### 解決策: Jumbo Frame有効化

```bash
# Agent VM設定（Linux）
# 現在のMTU確認
ip link show eth0
# 出力例: mtu 1500

# Jumbo Frame有効化 (9000 Bytes)
sudo ip link set eth0 mtu 9000

# 永続化設定 (/etc/network/interfaces)
sudo tee -a /etc/network/interfaces <<EOF
auto eth0
iface eth0 inet dhcp
  mtu 9000
EOF

# ネットワーク再起動
sudo systemctl restart networking

# 確認
ping -M do -s 8972 -c 3 8.8.8.8
# 成功: Jumbo Frame対応
# 失敗: "Packet too large" → 経路上のスイッチ/ルーターがJumbo Frame非対応
```

#### 注意事項

```
Jumbo Frame要件:
  ✅ Agent VM仮想NIC: MTU 9000対応
  ✅ 物理スイッチ: Jumbo Frame対応（L2スイッチ設定必要）
  ✅ NAS: MTU 9000対応
  ❌ インターネット経由の場合: 経路上のMTU制約あり

CISプロジェクト推奨設定:
  - オンプレミス内（Agent ↔ NAS）: MTU 9000
  - インターネット経由（Agent ↔ AWS）: MTU 1500（デフォルト）
  → Agent VMに2つのNIC設定
```

#### 期待される改善効果

```
MTU 1500 → 9000:
  - パケット数: 1/6に削減
  - CPU使用率: 15-20%削減
  - スループット: 10-15%向上（大容量ファイル）
  - 初回10TB転送時間: 72時間 → 63時間（12%短縮）
```

### 2. TCP Window Size最適化

#### 問題

```
デフォルトTCP Window: 64KB
高レイテンシ環境（20ms）:
  - 理論最大スループット = Window Size / RTT
  - 64KB / 0.02s = 3.2 MB/s = 25.6 Mbps
  → 1Gbps回線を全く活用できない
```

#### 解決策: TCP Window Scaling有効化

```bash
# Agent VM設定（Linux）
# 現在の設定確認
sysctl net.ipv4.tcp_window_scaling
# 出力: net.ipv4.tcp_window_scaling = 1 (有効)

# TCP受信バッファ最適化
sudo sysctl -w net.ipv4.tcp_rmem="4096 87380 16777216"
# min: 4KB, default: 85KB, max: 16MB

# TCP送信バッファ最適化
sudo sysctl -w net.ipv4.tcp_wmem="4096 65536 16777216"
# min: 4KB, default: 64KB, max: 16MB

# 永続化 (/etc/sysctl.conf)
sudo tee -a /etc/sysctl.conf <<EOF
net.ipv4.tcp_rmem = 4096 87380 16777216
net.ipv4.tcp_wmem = 4096 65536 16777216
net.core.rmem_max = 16777216
net.core.wmem_max = 16777216
net.ipv4.tcp_congestion_control = bbr
EOF

# 設定適用
sudo sysctl -p
```

#### BBR輻輳制御アルゴリズム

```bash
# BBR（Bottleneck Bandwidth and RTT）有効化
# 従来のCUBICより高レイテンシ環境で効率的

# カーネルモジュール確認
lsmod | grep tcp_bbr

# BBR有効化
sudo modprobe tcp_bbr
echo "tcp_bbr" | sudo tee -a /etc/modules-load.d/modules.conf

# 輻輳制御アルゴリズム変更
sudo sysctl -w net.ipv4.tcp_congestion_control=bbr

# 確認
sysctl net.ipv4.tcp_congestion_control
# 出力: net.ipv4.tcp_congestion_control = bbr
```

#### 期待される改善効果

```
TCP最適化による改善:
  - 高レイテンシ環境でのスループット: 300%向上
  - パケットロス時の回復速度: 2倍高速化
  - 1Gbps回線の利用率: 30% → 75%
  - 初回10TB転送時間: 63時間 → 50時間（21%短縮）
```

### 3. 並列TCP接続数の最適化

#### Agent VMのスペックアップ

```yaml
# DataSync Agent推奨スペック（最適化版）

最小構成（Small Scale）:
  vCPU: 4コア
  Memory: 16GB
  → 並列転送数: 最大8ファイル同時

推奨構成（CISプロジェクト）:
  vCPU: 8コア
  Memory: 32GB
  → 並列転送数: 最大16ファイル同時

高パフォーマンス構成（Large Scale）:
  vCPU: 16コア
  Memory: 64GB
  → 並列転送数: 最大32ファイル同時
```

#### vCPU増強手順（VMware ESXi）

```bash
# 1. Agent VM電源オフ
# vCenter → CIS-DataSync-Agent → Power Off

# 2. VM設定編集
# Edit Settings → CPU: 4 → 8
# Edit Settings → Memory: 16GB → 32GB

# 3. CPU/Memory Reservation設定（重要）
# CPU Reservation: 8000 MHz (1コア=1GHz × 8)
# Memory Reservation: 32768 MB
# → 他VMとのリソース競合を防止

# 4. VM起動
# Power On

# 5. Agent再アクティベーション（必要に応じて）
# AWS Console → DataSync → Agents → Status確認
```

#### 期待される改善効果

```
vCPU 4 → 8コア、Memory 16GB → 32GB:
  - 並列転送数: 8 → 16ファイル同時
  - 小ファイル転送速度: 2倍高速化
  - CPU使用率: 80% → 50%（余裕あり）
  - 初回10TB転送時間: 50時間 → 40時間（20%短縮）
```

---

## DataSync Task設定の最適化

### 1. Transfer Mode最適化

```bash
# AWS CLI設定例

# 初回フルコピー用Task
aws datasync update-task \
  --task-arn arn:aws:datasync:ap-northeast-1:770923989980:task/task-initial-sync \
  --options '{
    "TransferMode": "ALL",
    "VerifyMode": "ONLY_FILES_TRANSFERRED",
    "OverwriteMode": "ALWAYS",
    "PreserveDeletedFiles": "PRESERVE",
    "Atime": "BEST_EFFORT",
    "Mtime": "PRESERVE",
    "Uid": "INT_VALUE",
    "Gid": "INT_VALUE",
    "PreserveDevices": "NONE",
    "PosixPermissions": "PRESERVE"
  }' \
  --profile AdministratorAccess-770923989980

# 月次差分同期用Task
aws datasync update-task \
  --task-arn arn:aws:datasync:ap-northeast-1:770923989980:task/task-monthly-sync \
  --options '{
    "TransferMode": "CHANGED",
    "VerifyMode": "ONLY_FILES_TRANSFERRED",
    "OverwriteMode": "ALWAYS",
    "PreserveDeletedFiles": "REMOVE",
    "Atime": "BEST_EFFORT",
    "Mtime": "PRESERVE"
  }' \
  --profile AdministratorAccess-770923989980
```

#### Transfer Mode詳細

| Mode | 説明 | 用途 | パフォーマンス影響 |
|------|------|------|------------------|
| `ALL` | 全ファイルを転送 | 初回同期のみ | スキャン時間最小 |
| `CHANGED` | 変更されたファイルのみ | 月次差分同期 | スキャン時間増加、転送量95%削減 |

#### Verify Mode最適化

| Mode | 検証内容 | 転送時間への影響 | 推奨用途 |
|------|---------|---------------|---------|
| `ONLY_FILES_TRANSFERRED` | 転送したファイルのみ検証 | +5-10% | **推奨（デフォルト）** |
| `POINT_IN_TIME_CONSISTENT` | 全データ整合性検証 | +30-50% | 重要データのみ |
| `NONE` | 検証なし | 0% | 非推奨 |

#### 期待される改善効果

```
最適化設定による改善:
  - VerifyMode最適化: 転送時間5%短縮
  - PreserveDeletedFiles設定: 不要な削除スキャン回避
  - 月次差分同期: データ転送量95%削減（10TB → 500GB）
```

### 2. Bandwidth Limit動的調整

#### 時間帯別帯域幅制御

```bash
# 深夜帯（無制限）用Task設定
aws datasync update-task \
  --task-arn arn:aws:datasync:ap-northeast-1:770923989980:task/task-0abc123 \
  --options '{"BytesPerSecond": -1}' \
  --profile AdministratorAccess-770923989980
# -1 = 無制限

# 業務時間帯（制限あり）用Override設定
# 手動実行時のみ適用
aws datasync start-task-execution \
  --task-arn arn:aws:datasync:ap-northeast-1:770923989980:task/task-0abc123 \
  --override-options '{"BytesPerSecond": 12500000}' \
  --profile AdministratorAccess-770923989980
# 12,500,000 Bytes/sec = 100 Mbps
```

#### EventBridge + Lambda自動制御（高度な設定）

```javascript
// Lambda関数: DataSync帯域幅動的調整
// EventBridge Ruleで毎時実行

const AWS = require('aws-sdk');
const datasync = new AWS.DataSync();

exports.handler = async (event) => {
  const currentHour = new Date().getHours(); // JST: UTC+9

  // 業務時間帯判定（9:00-18:00）
  const isBusinessHours = currentHour >= 9 && currentHour < 18;

  // 帯域幅設定
  const bandwidthLimit = isBusinessHours
    ? 12500000  // 100 Mbps
    : -1;       // 無制限

  // Task更新
  const params = {
    TaskArn: 'arn:aws:datasync:ap-northeast-1:770923989980:task/task-0abc123',
    Options: {
      BytesPerSecond: bandwidthLimit
    }
  };

  await datasync.updateTask(params).promise();

  console.log(`Bandwidth updated: ${isBusinessHours ? '100 Mbps' : 'Unlimited'}`);

  return {
    statusCode: 200,
    body: JSON.stringify({
      hour: currentHour,
      isBusinessHours,
      bandwidthLimit
    })
  };
};
```

#### 期待される改善効果

```
動的帯域幅制御:
  - 業務時間帯: ネットワーク負荷を最小化（100 Mbps制限）
  - 深夜帯: 最大速度で転送（無制限）
  - 深夜実行時の転送時間: 40時間 → 32時間（20%短縮）
```

---

## 並列実行戦略

### 1. 複数DataSync Task並列実行

#### 問題

```
単一Task実行:
  - 1つのAgent → 1つのTask → 順次転送
  - 10TBを単一フローで処理 → ボトルネック
```

#### 解決策: データセット分割 + 並列Task実行

```yaml
# Task分割戦略

Task 1: Documents転送
  Source: \\NAS\FileShare\Documents\
  Size: 3TB
  Files: 2,000,000
  Avg File Size: 1.5MB

Task 2: Images転送
  Source: \\NAS\FileShare\Images\
  Size: 2TB
  Files: 1,500,000
  Avg File Size: 1.3MB

Task 3: CAD/SFC転送
  Source: \\NAS\FileShare\CAD\
  Size: 4TB
  Files: 500,000
  Avg File Size: 8MB

Task 4: Archives転送
  Source: \\NAS\FileShare\Archives\
  Size: 1TB
  Files: 1,000,000
  Avg File Size: 1MB
```

#### 複数Task並列実行スクリプト

```bash
#!/bin/bash

# 4つのTaskを並列実行

TASK_ARNS=(
  "arn:aws:datasync:ap-northeast-1:770923989980:task/task-documents"
  "arn:aws:datasync:ap-northeast-1:770923989980:task/task-images"
  "arn:aws:datasync:ap-northeast-1:770923989980:task/task-cad"
  "arn:aws:datasync:ap-northeast-1:770923989980:task/task-archives"
)

TASK_EXEC_ARNS=()

# 並列起動
for TASK_ARN in "${TASK_ARNS[@]}"; do
  echo "Starting task: $TASK_ARN"

  EXEC_ARN=$(aws datasync start-task-execution \
    --task-arn "$TASK_ARN" \
    --query 'TaskExecutionArn' \
    --output text \
    --profile AdministratorAccess-770923989980)

  TASK_EXEC_ARNS+=("$EXEC_ARN")
  echo "Task execution started: $EXEC_ARN"
done

# 全Task完了待機
echo "Waiting for all tasks to complete..."

while true; do
  ALL_COMPLETE=true

  for EXEC_ARN in "${TASK_EXEC_ARNS[@]}"; do
    STATUS=$(aws datasync describe-task-execution \
      --task-execution-arn "$EXEC_ARN" \
      --query 'Status' \
      --output text \
      --profile AdministratorAccess-770923989980)

    if [ "$STATUS" != "SUCCESS" ] && [ "$STATUS" != "ERROR" ]; then
      ALL_COMPLETE=false
      echo "$(date '+%Y-%m-%d %H:%M:%S') - Task $EXEC_ARN: $STATUS"
    fi
  done

  if [ "$ALL_COMPLETE" = true ]; then
    echo "All tasks completed!"
    break
  fi

  sleep 60
done

# 結果サマリー
for EXEC_ARN in "${TASK_EXEC_ARNS[@]}"; do
  aws datasync describe-task-execution \
    --task-execution-arn "$EXEC_ARN" \
    --query '{TaskArn:TaskArn, Status:Status, FilesTransferred:FilesTransferred, BytesTransferred:BytesTransferred}' \
    --profile AdministratorAccess-770923989980
done
```

#### 注意事項

```
並列実行の制約:
  ⚠️ 1つのAgent VMで同時実行できるTaskは1つのみ
  ✅ 解決策: 複数のAgent VMを構築

複数Agent構成:
  Agent 1: Task 1 (Documents) + Task 3 (CAD)
  Agent 2: Task 2 (Images) + Task 4 (Archives)

  → 各Agentは1Taskずつ順次実行
  → 全体では2Task同時実行
```

#### 期待される改善効果

```
単一Task vs 4Task並列:
  - 単一Task: 40時間
  - 2Agent × 2Task並列: 24時間（40%短縮）
  - 4Agent × 4Task並列: 12時間（70%短縮）

コスト考慮:
  - Agent VM追加: 4台 → 月額$0（オンプレミスVM、追加コストなし）
  - DataSync料金: データ量ベースのため変わらず
  → コスト増なしでパフォーマンス向上
```

---

## ファイルフィルタリング最適化

### 1. 転送対象ファイルの厳格な制限

#### 除外パターンの最適化

```json
{
  "FilterRules": [
    {
      "FilterType": "EXCLUDE",
      "Value": "/.Trash/*"
    },
    {
      "FilterType": "EXCLUDE",
      "Value": "/.snapshot/*"
    },
    {
      "FilterType": "EXCLUDE",
      "Value": "/**/~$*"
    },
    {
      "FilterType": "EXCLUDE",
      "Value": "/**/.DS_Store"
    },
    {
      "FilterType": "EXCLUDE",
      "Value": "/**/Thumbs.db"
    },
    {
      "FilterType": "EXCLUDE",
      "Value": "/**/*.tmp"
    },
    {
      "FilterType": "EXCLUDE",
      "Value": "/**/*.temp"
    },
    {
      "FilterType": "EXCLUDE",
      "Value": "/Backup/*"
    },
    {
      "FilterType": "EXCLUDE",
      "Value": "/**/*.mp4"
    },
    {
      "FilterType": "EXCLUDE",
      "Value": "/**/*.avi"
    },
    {
      "FilterType": "EXCLUDE",
      "Value": "/**/*.mov"
    },
    {
      "FilterType": "EXCLUDE",
      "Value": "/**/*.mkv"
    },
    {
      "FilterType": "EXCLUDE",
      "Value": "/**/*.iso"
    },
    {
      "FilterType": "EXCLUDE",
      "Value": "/**/*.vmdk"
    }
  ]
}
```

#### AWS CLI設定

```bash
aws datasync update-task \
  --task-arn arn:aws:datasync:ap-northeast-1:770923989980:task/task-0abc123 \
  --excludes '[
    {"FilterType":"EXCLUDE","Value":"/.Trash/*"},
    {"FilterType":"EXCLUDE","Value":"/**/*.mp4"},
    {"FilterType":"EXCLUDE","Value":"/**/*.avi"},
    {"FilterType":"EXCLUDE","Value":"/**/*.mov"},
    {"FilterType":"EXCLUDE","Value":"/Backup/*"},
    {"FilterType":"EXCLUDE","Value":"/**/*.iso"}
  ]' \
  --profile AdministratorAccess-770923989980
```

#### 期待される改善効果

```
フィルタリングによるデータ削減:
  - 動画ファイル: 1.5TB削減
  - バックアップフォルダ: 0.8TB削減
  - 一時ファイル/ゴミ箱: 0.2TB削減
  合計削減: 2.5TB (25%)

転送時間短縮:
  - 初回: 40時間 → 30時間（25%短縮）
  - 月次: 2.5時間 → 2時間（20%短縮）

コスト削減:
  - DataSync料金: $128 → $96（初回）
  - S3ストレージ: $256/月 → $192/月
  年間削減: $800以上
```

### 2. ファイルサイズ制限

```bash
# 非常に大きなファイル（1GB以上）を除外する例
# Task Optionsでは直接設定不可のため、NAS側で事前フィルタリング

# または、S3 Lifecycle Policyで大容量ファイルを自動アーカイブ
aws s3api put-bucket-lifecycle-configuration \
  --bucket cis-filesearch-landing \
  --lifecycle-configuration '{
    "Rules": [
      {
        "Id": "ArchiveLargeFiles",
        "Status": "Enabled",
        "Filter": {
          "And": {
            "Prefix": "LargeFiles/",
            "Tags": []
          }
        },
        "Transitions": [
          {
            "Days": 30,
            "StorageClass": "GLACIER"
          }
        ]
      }
    ]
  }' \
  --profile AdministratorAccess-770923989980
```

---

## スケジューリング最適化

### 1. 最適実行時間の選定

#### ネットワーク負荷分析

```bash
# CloudWatch Logs Insightsクエリ
# 時間帯別ネットワークスループット分析

fields @timestamp, @message
| filter @message like /bytes transferred/
| parse @message /(?<bytes_transferred>\d+) bytes transferred/
| stats sum(bytes_transferred) as total_bytes by bin(1h)
| sort total_bytes desc
```

#### 推奨スケジュール

```yaml
初回フルコピー（10TB）:
  開始日時: 金曜日 18:00（業務終了後）
  終了予定: 日曜日 18:00（30時間後）
  メリット:
    - 週末で業務影響なし
    - 万が一のトラブル時、月曜対応可能

月次差分同期（500GB）:
  開始日時: 毎月1日 深夜2:00
  終了予定: 同日 午前5:00（3時間後）
  Cron: 0 2 1 * ? *
  メリット:
    - 業務開始前（9:00）に完了
    - ネットワーク負荷最小
    - 月初の経理処理と重複回避（月末実行は避ける）

緊急手動同期:
  推奨時間帯: 12:00-13:00（昼休み）または 18:00-19:00（業務後）
  帯域幅制限: 100 Mbps
```

### 2. EventBridge Schedule Expression最適化

```bash
# 月次実行（毎月1日 深夜2:00 JST）
aws events put-rule \
  --name CIS-DataSync-Monthly-Sync \
  --schedule-expression "cron(0 17 L * ? *)" \
  --state ENABLED \
  --description "Monthly DataSync execution (1st day at 02:00 JST = 17:00 UTC previous day)" \
  --profile AdministratorAccess-770923989980

# ターゲット設定（DataSync Task起動）
aws events put-targets \
  --rule CIS-DataSync-Monthly-Sync \
  --targets '[
    {
      "Id": "1",
      "Arn": "arn:aws:datasync:ap-northeast-1:770923989980:task/task-0abc123",
      "RoleArn": "arn:aws:iam::770923989980:role/CIS-EventBridge-DataSync-Role"
    }
  ]' \
  --profile AdministratorAccess-770923989980
```

#### Cron Expression例

```
毎月1日 深夜2:00 JST (17:00 UTC前日):
  cron(0 17 L * ? *)

毎月1日と15日 深夜2:00:
  cron(0 17 1,15 * ? *)

毎週日曜日 深夜3:00:
  cron(0 18 ? * SUN *)

毎日 深夜1:00（テスト用）:
  cron(0 16 * * ? *)
```

---

## S3マルチパートアップロード設定

### 1. マルチパート閾値の最適化

#### DataSync内部動作

```
DataSyncのS3アップロード:
  - 小ファイル（<5MB）: 単一PUT
  - 大ファイル（>=5MB）: マルチパートアップロード

マルチパート設定:
  - パートサイズ: 5MB-5GB（自動調整）
  - 最大パート数: 10,000
  - 並列アップロード: 最大10パート同時
```

#### S3バケット側の設定

```bash
# 不完全マルチパートアップロードの自動削除
aws s3api put-bucket-lifecycle-configuration \
  --bucket cis-filesearch-landing \
  --lifecycle-configuration '{
    "Rules": [
      {
        "Id": "CleanupIncompleteMultipartUploads",
        "Status": "Enabled",
        "Prefix": "",
        "AbortIncompleteMultipartUpload": {
          "DaysAfterInitiation": 7
        }
      }
    ]
  }' \
  --profile AdministratorAccess-770923989980
```

### 2. 大容量ファイル転送最適化

#### 1GB超ファイルの転送戦略

```yaml
ファイルサイズ別転送方式:

  小ファイル（<5MB）:
    方式: 単一PUT
    並列数: 16ファイル同時
    スループット: 10-20 MB/s/ファイル

  中ファイル（5MB-100MB）:
    方式: マルチパート（10パート）
    並列数: 8ファイル同時
    スループット: 30-50 MB/s/ファイル

  大ファイル（100MB-1GB）:
    方式: マルチパート（50パート）
    並列数: 4ファイル同時
    スループット: 60-100 MB/s/ファイル

  超大ファイル（>1GB）:
    方式: マルチパート（200パート）
    並列数: 2ファイル同時
    スループット: 80-150 MB/s/ファイル
```

#### 期待される改善効果

```
マルチパート最適化:
  - 1GBファイル転送時間: 80秒 → 50秒（37%短縮）
  - ネットワーク障害時の再開: 失敗パートのみ再転送（95%削減）
  - S3 PUT Request数: 10,000 → 2,000（80%削減、コスト削減）
```

---

## コスト vs パフォーマンストレードオフ

### 1. パフォーマンスレベル別コスト試算

#### レベル1: 標準構成（ベースライン）

```yaml
Agent VM:
  vCPU: 4コア
  Memory: 16GB
  Network: 1Gbps

DataSync Task:
  並列転送: 8ファイル
  帯域幅制限: 100 Mbps（業務時間）

パフォーマンス:
  初回10TB: 72時間
  月次500GB: 6時間

月額コスト:
  Agent VM: $0（オンプレミス）
  DataSync: $6.40
  S3: $256
  EC2 Spot: $5
  合計: $267.40
```

#### レベル2: 推奨構成（コスト効率最適）

```yaml
Agent VM:
  vCPU: 8コア
  Memory: 32GB
  Network: 1Gbps + Jumbo Frame

DataSync Task:
  並列転送: 16ファイル
  帯域幅制限: なし（深夜）、100 Mbps（業務時間）
  フィルタリング: 動画/バックアップ除外

パフォーマンス:
  初回7.5TB: 30時間（58%短縮）
  月次375GB: 2時間（67%短縮）

月額コスト:
  Agent VM: $0（オンプレミス、リソース増強のみ）
  DataSync: $4.80（25%削減）
  S3: $192（25%削減）
  EC2 Spot: $4
  合計: $200.80（25%削減）

ROI:
  コスト削減: $66.60/月 × 12 = $799.20/年
  時間削減: 初回42時間 + 月次48時間/年 = 90時間/年
  人件費削減: $4,500/年（時給$50想定）
```

#### レベル3: 高パフォーマンス構成

```yaml
Agent VM:
  vCPU: 16コア
  Memory: 64GB
  Network: 10Gbps

DataSync Task:
  並列転送: 32ファイル
  帯域幅制限: なし
  複数Task並列: 4Task同時（4 Agent）

パフォーマンス:
  初回7.5TB: 12時間（83%短縮）
  月次375GB: 1時間（83%短縮）

月額コスト:
  Agent VM: $0（オンプレミス）
  DataSync: $4.80
  S3: $192
  EC2 Spot: $4
  合計: $200.80（変わらず）

追加投資:
  オンプレミスサーバー増強: 一時的投資のみ
  10Gbps NIC: $500/台 × 4 = $2,000（1回限り）

ROI:
  初期投資: $2,000
  回収期間: 5ヶ月（時間削減による人件費削減）
```

### 2. 推奨構成選定

```
CISプロジェクト推奨: レベル2（推奨構成）

選定理由:
  ✅ コスト削減効果が高い（25%削減）
  ✅ パフォーマンス大幅向上（58-67%短縮）
  ✅ 追加投資不要（既存VM増強のみ）
  ✅ 運用負荷増加なし
  ❌ レベル3は過剰投資（月次500GBでは不要）
```

---

## パフォーマンス監視メトリクス

### 1. KPI設定

```yaml
転送速度KPI:
  目標スループット: 450 Mbps（平均）
  最小許容値: 300 Mbps
  アラート閾値: 250 Mbps（15分間継続）

ファイル処理速度:
  目標: 50ファイル/秒
  最小許容値: 30ファイル/秒
  アラート閾値: 20ファイル/秒

Task実行時間:
  初回10TB: 48時間以内
  月次500GB: 3時間以内
  アラート閾値: 各目標の120%超過

エラー率:
  目標: <0.01%（10,000ファイル中1ファイル未満）
  最大許容: <0.1%
  アラート閾値: >0.05%
```

### 2. CloudWatch Dashboard作成

```json
{
  "widgets": [
    {
      "type": "metric",
      "properties": {
        "title": "DataSync Throughput (Mbps)",
        "metrics": [
          ["AWS/DataSync", "BytesTransferred", {"stat": "Sum", "period": 300}]
        ],
        "period": 300,
        "stat": "Sum",
        "region": "ap-northeast-1",
        "yAxis": {
          "left": {
            "min": 0,
            "max": 1000
          }
        }
      }
    },
    {
      "type": "metric",
      "properties": {
        "title": "Files Transferred per Minute",
        "metrics": [
          ["AWS/DataSync", "FilesTransferred", {"stat": "Sum", "period": 60}]
        ],
        "period": 60,
        "stat": "Sum",
        "region": "ap-northeast-1"
      }
    },
    {
      "type": "metric",
      "properties": {
        "title": "Agent CPU Utilization",
        "metrics": [
          ["AWS/DataSync", "AgentCpuUtilization"]
        ],
        "period": 300,
        "stat": "Average",
        "region": "ap-northeast-1",
        "yAxis": {
          "left": {
            "min": 0,
            "max": 100
          }
        }
      }
    }
  ]
}
```

### 3. 自動レポート生成

```python
# Lambda関数: DataSync Performance Report

import boto3
import json
from datetime import datetime, timedelta

cloudwatch = boto3.client('cloudwatch')
ses = boto3.client('ses')

def lambda_handler(event, context):
    # 過去24時間のメトリクス取得
    end_time = datetime.utcnow()
    start_time = end_time - timedelta(hours=24)

    # Throughputメトリクス
    throughput = cloudwatch.get_metric_statistics(
        Namespace='AWS/DataSync',
        MetricName='BytesTransferred',
        Dimensions=[
            {'Name': 'TaskId', 'Value': 'task-0abc123'}
        ],
        StartTime=start_time,
        EndTime=end_time,
        Period=3600,
        Statistics=['Sum']
    )

    # Files Transferredメトリクス
    files = cloudwatch.get_metric_statistics(
        Namespace='AWS/DataSync',
        MetricName='FilesTransferred',
        Dimensions=[
            {'Name': 'TaskId', 'Value': 'task-0abc123'}
        ],
        StartTime=start_time,
        EndTime=end_time,
        Period=3600,
        Statistics=['Sum']
    )

    # レポート生成
    total_bytes = sum([dp['Sum'] for dp in throughput['Datapoints']])
    total_files = sum([dp['Sum'] for dp in files['Datapoints']])
    avg_throughput_mbps = (total_bytes * 8 / 1000000) / 24  # Mbps

    report_html = f"""
    <html>
    <body>
      <h2>DataSync Performance Report - {datetime.now().strftime('%Y-%m-%d')}</h2>
      <table border="1">
        <tr><th>Metric</th><th>Value</th><th>Target</th><th>Status</th></tr>
        <tr>
          <td>Total Data Transferred</td>
          <td>{total_bytes / 1e9:.2f} GB</td>
          <td>-</td>
          <td>✅</td>
        </tr>
        <tr>
          <td>Total Files Transferred</td>
          <td>{int(total_files):,}</td>
          <td>-</td>
          <td>✅</td>
        </tr>
        <tr>
          <td>Average Throughput</td>
          <td>{avg_throughput_mbps:.2f} Mbps</td>
          <td>450 Mbps</td>
          <td>{'✅' if avg_throughput_mbps >= 450 else '⚠️'}</td>
        </tr>
      </table>
    </body>
    </html>
    """

    # メール送信
    ses.send_email(
        Source='noreply@company.com',
        Destination={'ToAddresses': ['devops@company.com']},
        Message={
            'Subject': {'Data': 'DataSync Daily Performance Report'},
            'Body': {'Html': {'Data': report_html}}
        }
    )

    return {'statusCode': 200, 'body': json.dumps('Report sent')}
```

---

## 増分同期最適化

### 1. 変更検出アルゴリズム

#### DataSync内部動作

```yaml
変更検出方法:
  1. ファイルサイズ比較
  2. 最終更新日時（mtime）比較
  3. チェックサム（MD5）比較（オプション）

転送判定:
  新規ファイル: S3に存在しない → 転送
  更新ファイル: サイズorMtimeが異なる → 転送
  未変更ファイル: 全て一致 → スキップ
  削除ファイル: NASに存在しないがS3にある → 削除（設定による）
```

#### 最適化設定

```bash
aws datasync update-task \
  --task-arn arn:aws:datasync:ap-northeast-1:770923989980:task/task-monthly-sync \
  --options '{
    "TransferMode": "CHANGED",
    "VerifyMode": "ONLY_FILES_TRANSFERRED",
    "OverwriteMode": "ALWAYS",
    "Atime": "BEST_EFFORT",
    "Mtime": "PRESERVE"
  }' \
  --profile AdministratorAccess-770923989980
```

### 2. スキャン時間短縮

#### 問題

```
500万ファイルのスキャン:
  - ファイルリスト取得: 30分
  - メタデータ比較: 60分
  合計: 90分（転送前のオーバーヘッド）
```

#### 解決策: メタデータキャッシュ活用

```yaml
DataSync内部キャッシュ:
  - 前回スキャン結果をAgent VMローカルに保存
  - 変更されたディレクトリのみ再スキャン
  - 変更なしディレクトリはキャッシュから読込

キャッシュ有効化（自動）:
  - Transfer Mode: CHANGED設定時に自動有効

期待効果:
  - 2回目以降のスキャン時間: 90分 → 15分（83%短縮）
  - 月次同期の総実行時間: 3時間 → 2.25時間（25%短縮）
```

### 3. 差分転送パフォーマンス測定

```bash
# CloudWatch Logs Insightsクエリ
# 新規 vs 更新ファイル比率分析

fields @timestamp, @message
| filter @message like /File status:/
| parse @message "File status: * - *" as status, filename
| stats count() as file_count by status
| sort file_count desc
```

---

## 大容量ファイル vs 小容量ファイル最適化

### 1. ファイルサイズ分布分析

```sql
-- CloudWatch Logs Insights
fields @timestamp, @message
| filter @message like /Transferring:/
| parse @message "Transferring: * (*)" as filename, size
| parse size /(?<size_value>\d+(?:\.\d+)?)\s*(?<size_unit>\w+)/
| stats count() as file_count,
        sum(size_value) as total_size
  by size_unit
| sort total_size desc
```

#### CISプロジェクト想定分布

```yaml
ファイルサイズ分布:

  <100KB（極小）:
    ファイル数: 1,000,000 (20%)
    データ量: 50GB (0.5%)
    課題: オーバーヘッド大、スループット低

  100KB-10MB（小）:
    ファイル数: 3,000,000 (60%)
    データ量: 4TB (40%)
    課題: 並列処理で改善可能

  10MB-100MB（中）:
    ファイル数: 800,000 (16%)
    データ量: 3TB (30%)
    特性: 最も効率的に転送

  100MB-1GB（大）:
    ファイル数: 200,000 (4%)
    データ量: 3TB (30%)
    特性: マルチパート効果大

  >1GB（超大）:
    ファイル数: 1,000 (<0.1%)
    データ量: 50GB (0.5%)
    課題: 失敗時の再転送コスト大
```

### 2. 最適化戦略

#### 小ファイル最適化（<10MB）

```yaml
問題:
  - TCP接続オーバーヘッド
  - ファイルオープン/クローズのI/Oコスト
  - メタデータ処理のCPUコスト

解決策:
  1. 並列転送数を最大化
     Agent VM: vCPU 8 → 16コア
     並列数: 16 → 32ファイル同時

  2. TCP接続再利用
     Keep-Alive有効化（DataSync自動設定）

  3. ファイルバッチング（将来的な改善案）
     複数小ファイルをtarアーカイブ化
     → S3転送後に展開（Lambda）

期待効果:
  小ファイル転送速度: 10 MB/s → 25 MB/s（150%向上）
  1,000,000ファイル（50GB）: 90分 → 35分（61%短縮）
```

#### 大ファイル最適化（>100MB）

```yaml
問題:
  - 転送失敗時の再開コスト
  - ネットワーク障害リスク
  - メモリ使用量増加

解決策:
  1. マルチパートサイズ最適化
     デフォルト: 5MB/パート
     最適化: 10MB/パート（大ファイル用）

  2. チェックポイント機能活用
     DataSync自動チェックポイント
     失敗時: 最後のパートから再開

  3. S3 Transfer Acceleration（オプション）
     グローバルエッジロケーション経由
     追加料金: $0.04/GB

期待効果:
  大ファイル転送速度: 80 MB/s → 120 MB/s（50%向上）
  1GBファイル: 50秒 → 33秒（34%短縮）
  転送失敗時の再開時間: 100% → 10%（最後のパートのみ）
```

### 3. ファイルサイズ別Task分離（高度な最適化）

```yaml
Task 1: 小ファイル専用（<10MB）
  Source Filter: ファイルサイズ<10MB（手動分類必要）
  並列転送: 32ファイル同時
  Agent VM: 16コア、64GB

Task 2: 大ファイル専用（>10MB）
  Source Filter: ファイルサイズ>=10MB
  並列転送: 8ファイル同時
  Agent VM: 8コア、32GB

メリット:
  - 各Taskがファイルサイズに最適化
  - リソース使用効率向上
  - 総転送時間: 40時間 → 28時間（30%短縮）

デメリット:
  - 設定複雑化
  - Agent VM追加必要

推奨:
  初期はファイルサイズ混在Taskで運用
  パフォーマンス不足時に分離検討
```

---

## 実装チェックリスト

### フェーズ1: ベースライン測定（Week 1）

```
✅ 現状パフォーマンス測定
  ✅ 100GBテスト転送実行
  ✅ 転送時間、スループット記録
  ✅ ボトルネック特定（CPU/Memory/Network）

✅ メトリクス収集
  ✅ CloudWatch Metrics確認
  ✅ CloudWatch Logs分析
  ✅ ファイルサイズ分布分析
```

### フェーズ2: ネットワーク最適化（Week 2）

```
✅ MTU最適化
  ✅ Jumbo Frame設定（オンプレミス内）
  ✅ Agent VM MTU変更
  ✅ ネットワークスイッチ設定確認

✅ TCP最適化
  ✅ TCP Window Size拡大
  ✅ BBR輻輳制御有効化
  ✅ ネットワークバッファ調整

✅ Agent VMリソース増強
  ✅ vCPU: 4 → 8コア
  ✅ Memory: 16GB → 32GB
  ✅ CPU/Memory Reservation設定
```

### フェーズ3: DataSync設定最適化（Week 2-3）

```
✅ Task Options最適化
  ✅ Transfer Mode: CHANGED
  ✅ Verify Mode: ONLY_FILES_TRANSFERRED
  ✅ 帯域幅制限: 深夜無制限、業務時間100 Mbps

✅ フィルタリング設定
  ✅ 動画ファイル除外
  ✅ バックアップフォルダ除外
  ✅ 一時ファイル除外

✅ スケジュール最適化
  ✅ 月次自動実行: 毎月1日 深夜2:00
  ✅ EventBridge Rule設定
```

### フェーズ4: パフォーマンス検証（Week 3）

```
✅ 最適化後テスト
  ✅ 100GBテスト再実行
  ✅ パフォーマンス改善確認
  ✅ 目標スループット達成確認（450 Mbps）

✅ 初回フルコピー実行
  ✅ 10TB転送実行
  ✅ 実行時間記録（目標: 48時間以内）
  ✅ エラー発生確認

✅ 監視設定
  ✅ CloudWatch Alarms設定
  ✅ SNS通知設定
  ✅ Performance Dashboard作成
```

### フェーズ5: 継続的改善（Week 4以降）

```
✅ 月次パフォーマンスレビュー
  ✅ 転送時間トレンド分析
  ✅ ボトルネック再評価
  ✅ コスト効率分析

✅ 追加最適化検討
  ✅ 複数Agent並列実行（必要時）
  ✅ ファイルサイズ別Task分離（必要時）
  ✅ S3 Transfer Acceleration（グローバル展開時）
```

---

## 期待される総合改善効果

### パフォーマンス改善サマリー

```yaml
初回同期（10TB → 7.5TB フィルタリング後）:
  最適化前: 72時間
  最適化後: 30時間
  改善率: 58%短縮

月次同期（500GB → 375GB フィルタリング後）:
  最適化前: 6時間
  最適化後: 2時間
  改善率: 67%短縮

実効スループット:
  最適化前: 250 Mbps
  最適化後: 550 Mbps
  改善率: 120%向上
```

### コスト削減サマリー

```yaml
年間コスト:
  最適化前: $3,209/年
  最適化後: $2,410/年
  削減額: $799/年（25%削減）

内訳:
  - DataSync料金: 25%削減（フィルタリング）
  - S3ストレージ: 25%削減（不要ファイル除外）
  - EC2処理: 20%削減（処理時間短縮）
```

### ROI分析

```yaml
投資:
  オンプレミスVM増強: $0（既存リソース活用）
  設定作業時間: 20時間
  作業コスト: $1,000（時給$50想定）

リターン:
  コスト削減: $799/年
  運用時間削減: 90時間/年 → $4,500/年
  合計リターン: $5,299/年

投資回収期間: 2ヶ月
```

---

## 参考資料

### AWS公式ドキュメント

- [DataSync Performance](https://docs.aws.amazon.com/datasync/latest/userguide/performance.html)
- [DataSync Best Practices](https://docs.aws.amazon.com/datasync/latest/userguide/best-practices.html)
- [Optimizing DataSync Performance](https://aws.amazon.com/blogs/storage/optimizing-datasync-performance/)
- [S3 Multipart Upload Overview](https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpuoverview.html)

### ネットワーク最適化

- [TCP BBR Congestion Control](https://cloud.google.com/blog/products/networking/tcp-bbr-congestion-control-comes-to-gcp-your-internet-just-got-faster)
- [Jumbo Frames for AWS](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/network_mtu.html)
- [TCP Window Scaling](https://www.ietf.org/rfc/rfc1323.txt)

---

**作成者**: CIS Performance Engineering Team
**最終更新**: 2025-01-17
**バージョン**: 1.0
