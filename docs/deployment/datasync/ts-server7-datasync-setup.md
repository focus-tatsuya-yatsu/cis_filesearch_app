# ts-server7 DataSync セットアップガイド

## 概要

ts-server7（構造カテゴリ、3.60TB）のDataSyncタスク作成手順書です。
既存の3サーバー（ts-server3, ts-server5, ts-server6）と同様のパターンでAWSコンソールから設定します。

---

## サーバー情報

| 項目 | 値 |
|------|-----|
| **サーバー名** | ts-server7 |
| **IPアドレス** | 192.168.1.218 |
| **ドライブレター** | S: |
| **カテゴリ** | 構造（structure） |
| **容量** | 3.60TB |
| **S3プレフィックス** | `documents/structure/ts-server7/` |

---

## 事前チェックリスト

### Phase 1: 事前準備・確認

- [ ] **NAS接続テスト**
  ```powershell
  # DataSync Agent VMまたはスキャンPCから実行
  Test-NetConnection -ComputerName 192.168.1.218 -Port 445

  # 共有にアクセス可能か確認
  # エクスプローラーで \\192.168.1.218 にアクセス
  ```

- [ ] **共有名の確認**
  ```powershell
  # 共有名を確認（管理者権限必要）
  net view \\192.168.1.218
  ```
  > **注**: 既存サーバーと同じパターン（例: FileShare）の可能性が高い

- [ ] **認証情報の確認**
  - ユーザー名: 既存サーバーと同一（確認必要）
  - パスワード: Secrets Managerに保存済み（確認必要）
  - ドメイン: WORKGROUP または 既存と同一

- [ ] **DataSync Agent 状態確認**
  ```bash
  aws datasync list-agents --region ap-northeast-1
  # → Status: ONLINE であることを確認
  ```

---

## AWS DataSync設定手順

### Step 1: SMB Location 作成

1. **AWSコンソールにログイン**
   - https://ap-northeast-1.console.aws.amazon.com/datasync/

2. **Locations → Create location**

3. **設定内容**:
   ```yaml
   Location type: Server Message Block (SMB)

   Agent configuration:
     Agents: CIS-DataSync-Agent-Production

   SMB configuration:
     SMB Server: 192.168.1.218
     Share name: [確認した共有名を入力]
     # 例: FileShare, Documents, etc.

     Subdirectory: /
     # 特定フォルダのみの場合は /FolderName

   User settings:
     User: [既存サーバーと同一のユーザー名]
     Password: [Secrets Managerから取得またはAWSコンソールで直接入力]
     Domain: WORKGROUP  # または既存と同一

   Mount options:
     SMB version: Automatic (SMB3推奨)

   Tags:
     - Key: Name, Value: cis-filesearch-nas-location-ts-server7
     - Key: Project, Value: cis-filesearch
     - Key: Server, Value: ts-server7
     - Key: Category, Value: structure
   ```

4. **Create location** をクリック

5. **Location ARN を記録**
   ```
   arn:aws:datasync:ap-northeast-1:ACCOUNT_ID:location/loc-xxxxxxxxxxxxxxxxx
   ```

---

### Step 2: S3 Location 確認

既存のS3 Locationを使用します（新規作成不要）。

1. **DataSync → Locations** で既存のS3 Locationを確認

2. **確認内容**:
   ```yaml
   Location URI: s3://cis-filesearch-s3-landing/
   # または
   Location URI: s3://cis-filesearch-landing/
   ```

3. **Subdirectory設定**:
   - Task側で `documents/structure/ts-server7/` を指定する

---

### Step 3: DataSync Task 作成

1. **DataSync → Tasks → Create task**

2. **Source configuration**:
   ```yaml
   Source location type: Choose an existing location
   Existing location: [Step 1で作成したLocation]
   # cis-filesearch-nas-location-ts-server7
   ```

3. **Destination configuration**:
   ```yaml
   Destination location type: Choose an existing location
   Existing location: cis-filesearch-s3-location

   # 重要: フォルダ設定
   Destination folder: documents/structure/ts-server7
   ```

4. **Task settings**:
   ```yaml
   Task name: CIS-NAS-to-S3-Sync-ts-server7

   Data transfer configuration:
     Verify data: Verify only the data transferred

   Transfer mode: Transfer only data that has changed
   # ← 差分転送（CHANGED）

   Overwrite files: Always

   Preserve deleted files: Remove (unchecked)
   # ← NASで削除されたファイルはS3からも削除

   Keep deleted files: No
   ```

5. **Bandwidth settings**:
   ```yaml
   Bandwidth limit: Use available
   # 初回: 制限なし
   # 業務時間中: 100 Mbps に制限（オプション）

   # Mbps to bytes/sec: 100 Mbps = 12,500,000 bytes/sec
   ```

6. **Filtering configuration**:
   ```yaml
   Exclude patterns:
     /**/*.mp4
     /**/*.avi
     /**/*.mov
     /**/*.wmv
     /**/*.iso
     /**/*.bak
     /**/~$*
     /**/.DS_Store
     /**/Thumbs.db
     /Backup/*
     /.Trash/*
     /**/System Volume Information/*
     /**/$RECYCLE.BIN/*

   Include patterns: (空のまま - 全ファイル対象)
   ```

7. **Scheduling**:
   ```yaml
   Schedule: Not scheduled
   # 初回は手動実行

   # または月次スケジュール設定:
   Schedule expression: cron(0 2 1 * ? *)
   # 毎月1日 02:00 AM (UTC) = 11:00 AM (JST)
   ```

8. **Logging**:
   ```yaml
   CloudWatch log group: /aws/datasync/cis-filesearch
   Log level: TRANSFER
   # 転送したファイルのログを記録
   ```

9. **Tags**:
   ```yaml
   - Key: Name, Value: CIS-NAS-to-S3-Sync-ts-server7
   - Key: Project, Value: cis-filesearch
   - Key: Server, Value: ts-server7
   - Key: Category, Value: structure
   - Key: DataSize, Value: 3.60TB
   ```

10. **Create task** をクリック

---

### Step 4: テスト実行

#### 4.1 小規模テスト（推奨）

1. **Task → Edit task**

2. **一時的にInclude patternを設定**:
   ```yaml
   Include patterns: /TestFolder/*
   # 100ファイル程度の小さいフォルダを指定
   ```

3. **Start → Start with defaults**

4. **監視**:
   - Execution status: SUCCESS を確認
   - Files transferred: 数を確認
   - Data transferred: サイズを確認
   - Errors: 0 を確認

5. **S3確認**:
   ```bash
   aws s3 ls s3://cis-filesearch-s3-landing/documents/structure/ts-server7/ --recursive | head -20
   ```

6. **テスト完了後、Include patternを削除**

---

### Step 5: 初回フルコピー実行

#### 5.1 実行前確認

```bash
# SQSキュー確認（ファイル処理用）
aws sqs get-queue-attributes \
  --queue-url https://sqs.ap-northeast-1.amazonaws.com/ACCOUNT_ID/cis-filesearch-queue.fifo \
  --attribute-names ApproximateNumberOfMessages

# EC2 Auto Scaling確認
aws autoscaling describe-auto-scaling-groups \
  --auto-scaling-group-names CIS-FileProcessor-ASG \
  --query 'AutoScalingGroups[0].DesiredCapacity'
```

#### 5.2 推奨スケジュール

| 項目 | 値 |
|------|-----|
| **データサイズ** | 3.60TB |
| **帯域（制限なし）** | 最大 500 Mbps |
| **帯域（100Mbps制限時）** | 100 Mbps |
| **推定時間（制限なし）** | 16-20時間 |
| **推定時間（100Mbps）** | 36-40時間 |
| **推奨開始** | 金曜日 18:00 |
| **完了見込み** | 日曜日 06:00-10:00 |

#### 5.3 実行

1. **Task → Start → Start with defaults**

2. **または帯域制限付きで実行**:
   ```yaml
   Start with overriding settings:
     Bandwidth limit: 12500000 bytes/sec (100 Mbps)
   ```

---

### Step 6: 監視

#### CloudWatch Dashboardで確認

```
DataSync → Task → [Task名] → Monitoring
```

**主要メトリクス**:
- BytesTransferred: 転送済みバイト数
- FilesTransferred: 転送済みファイル数
- FilesSkipped: スキップされたファイル
- FilesFailed: 失敗したファイル（0であるべき）

#### CLI監視

```bash
# タスク実行状況確認
aws datasync describe-task-execution \
  --task-execution-arn arn:aws:datasync:ap-northeast-1:ACCOUNT_ID:task/task-xxx/execution/exec-xxx

# リアルタイム進捗（実行中のみ）
watch -n 30 'aws datasync describe-task-execution --task-execution-arn <ARN> --query "Status"'
```

---

### Step 7: 完了確認

1. **DataSyncステータス確認**
   ```bash
   # Task execution status: SUCCESS
   aws datasync describe-task-execution \
     --task-execution-arn <EXECUTION_ARN> \
     --query '{Status:Status,BytesTransferred:BytesTransferred,FilesTransferred:FilesTransferred}'
   ```

2. **S3ファイル確認**
   ```bash
   # ファイル数確認
   aws s3 ls s3://cis-filesearch-s3-landing/documents/structure/ts-server7/ --recursive | wc -l

   # サイズ確認
   aws s3 ls s3://cis-filesearch-s3-landing/documents/structure/ts-server7/ --recursive --summarize | tail -2
   ```

3. **フロントエンド検索テスト**
   - 検索画面で ts-server7 のファイルが表示されることを確認
   - カテゴリ「構造」でフィルタリングして確認

---

## 月次スケジュール設定

初回同期完了後、月次自動実行を設定します。

1. **Task → Edit task → Scheduling**

2. **設定**:
   ```yaml
   Schedule: Scheduled
   Frequency: Monthly
   Day: 1
   Time: 02:00 (UTC) = 11:00 (JST)

   # cron式: cron(0 2 1 * ? *)
   ```

3. **Update task**

---

## トラブルシューティング

### NAS接続エラー

```
Error: Failed to access SMB share
```

**対処**:
1. Agent VMからNASへの接続確認
   ```bash
   # Agent VMで実行
   smbclient -L //192.168.1.218 -U username
   ```
2. 認証情報の再確認
3. ファイアウォール設定確認（Port 445）

### 転送速度が遅い

**対処**:
1. 帯域制限を解除して再実行
2. Agent VMのリソース確認（CPU/メモリ）
3. ネットワーク帯域確認

### ファイルがスキップされる

**対処**:
1. Exclude patternの確認
2. ファイルパーミッション確認
3. ファイル名の文字コード確認（日本語ファイル名）

---

## コスト見積もり

| 項目 | 計算 | コスト |
|------|------|--------|
| DataSync転送（初回） | 3.60TB × $0.0125/GB | $46.08 |
| S3ストレージ（月額） | 3.60TB × $0.023/GB | $82.94 |
| **初回合計** | | **約$130** |

**月次運用**:
- 差分転送のため、通常 $1-5/月 程度

---

## 完了チェックリスト

### 設定完了
- [ ] SMB Location 作成完了
- [ ] DataSync Task 作成完了
- [ ] Exclude pattern 設定完了
- [ ] CloudWatch Logs 設定完了
- [ ] Tags 設定完了

### テスト完了
- [ ] 小規模テスト実行成功
- [ ] S3にファイル到達確認
- [ ] エラーなし

### 本番実行完了
- [ ] 初回フルコピー開始
- [ ] 初回フルコピー完了
- [ ] ファイル数・サイズ検証
- [ ] フロントエンド検索確認

### 運用設定完了
- [ ] 月次スケジュール設定
- [ ] CloudWatchアラート確認

---

## 関連リソース

- **DataSyncセットアップガイド**: [11-datasync-complete-setup-guide.md](./11-datasync-complete-setup-guide.md)
- **既存Location/Task**: AWSコンソールで確認
  - ts-server3 Location & Task
  - ts-server5 Location & Task
  - ts-server6 Location & Task
- **トラブルシューティング**: [06-datasync-monitoring-optimization-guide.md](./06-datasync-monitoring-optimization-guide.md)

---

**作成日**: 2026-01-27
**作成者**: CIS File Search DevOps
**対象バージョン**: DataSync Agent 1.x
