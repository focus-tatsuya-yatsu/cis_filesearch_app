# AWS DataSync Location & Task 設定ガイド

**作成日**: 2025-01-17
**対象**: Week 2 Day 6-7
**所要時間**: 2-3時間
**前提条件**: DataSync Agent起動済み、NAS接続情報取得済み、S3バケット作成済み

---

## 📋 目次

1. [概要](#概要)
2. [DataSync Location（Source）設定 - SMB](#datasync-locationsource設定---smb)
3. [DataSync Location（Source）設定 - NFS](#datasync-locationsource設定---nfs)
4. [DataSync Location（Destination）設定 - S3](#datasync-locationdestination設定---s3)
5. [DataSync Task設定](#datasync-task設定)
6. [フィルタリングルール設定](#フィルタリングルール設定)
7. [スケジュール設定](#スケジュール設定)
8. [テスト実行](#テスト実行)
9. [トラブルシューティング](#トラブルシューティング)

---

## 概要

### DataSync Location とは

**Location**は、データ転送の「ソース」と「デスティネーション」を定義するエンドポイントです。

```
┌──────────────────────────────────────────────────────────────┐
│  DataSync Architecture                                        │
│                                                                │
│  ┌────────────────┐       ┌────────────┐       ┌───────────┐ │
│  │   Location     │       │  DataSync  │       │ Location  │ │
│  │   (Source)     │──────▶│    Task    │──────▶│(Destination)│
│  │                │       │            │       │           │ │
│  │  SMB/NFS       │       │  - Filter  │       │  S3       │ │
│  │  on NAS        │       │  - Schedule│       │  Bucket   │ │
│  │                │       │  - Options │       │           │ │
│  └────────────────┘       └────────────┘       └───────────┘ │
│        │                                             │         │
│        │                                             │         │
│   Agent ARN                                     IAM Role      │
│   SMB/NFS Path                                  Bucket ARN    │
│   Credentials                                   Prefix        │
└──────────────────────────────────────────────────────────────┘
```

### 設定フロー

```
Step 1: Source Location作成（NAS - SMB/NFS）
   ↓
Step 2: Destination Location作成（S3）
   ↓
Step 3: DataSync Task作成（Source → Destination）
   ↓
Step 4: Task Options設定（転送モード、フィルタ、帯域幅）
   ↓
Step 5: スケジュール設定（月次自動実行）
   ↓
Step 6: テスト実行（100ファイル程度）
```

---

## DataSync Location（Source）設定 - SMB

### Step 1: AWS Console → DataSync

```
1. AWSマネジメントコンソール → DataSync
2. リージョン: Asia Pacific (Tokyo) ap-northeast-1
3. 左側メニュー: 「Locations」をクリック
4. 「Create location」ボタンをクリック
```

### Step 2: Location Type選択

```
Location type: Server Message Block (SMB)
```

### Step 3: Agent選択

```
Agents:
  ✅ Select existing agents

Agent:
  選択: CIS-DataSync-Agent-NAS01
  ARN: arn:aws:datasync:ap-northeast-1:770923989980:agent/agent-0abc12345def67890

✅ Status: ONLINE であることを確認
```

### Step 4: SMB Server設定

```
SMB server:
  Server hostname: 192.168.1.100
  または
  Server hostname: nas01.company.local (FQDNの場合)

Share name: /FileShare
  例: \\192.168.1.100\FileShare の場合は「FileShare」と入力
  注意: バックスラッシュや先頭スラッシュは不要

Subdirectory (Optional): /
  または
  Subdirectory: /Documents/ProjectFiles
  （特定フォルダ以下のみ同期したい場合）
```

### Step 5: User Authentication

```
User: datasync_user

Domain: COMPANY
  注意: ワークグループの場合は「WORKGROUP」と入力

Password: ********
  注意: AWS Secrets Managerに保存されている場合は、そちらを参照
```

#### AWS Secrets Managerの使用（推奨）

```
「Use AWS Secrets Manager」にチェック

Secret name: CIS/DataSync/NAS01/SMB-Credentials

Secrets Managerに事前登録:
  aws secretsmanager create-secret \
    --name CIS/DataSync/NAS01/SMB-Credentials \
    --secret-string '{
      "username": "datasync_user",
      "password": "YourSecurePassword123!",
      "domain": "COMPANY"
    }' \
    --region ap-northeast-1 \
    --profile AdministratorAccess-770923989980
```

### Step 6: Additional Settings

```
SMB version: Automatic (推奨)
  または
  SMB version: SMB3 (セキュリティ重視の場合)

Security:
  ✅ Enable SMB signing (データ改ざん防止)
```

### Step 7: Tags（オプション）

```
Tags:
  - Key: Project,     Value: CIS-FileSearch
  - Key: Component,   Value: DataSync-Source
  - Key: NAS,         Value: NAS01
  - Key: Protocol,    Value: SMB
```

### Step 8: Location作成

```
「Create location」ボタンをクリック

✅ 成功メッセージ:
  "Location loc-0abc123def456 has been created successfully."

Location ARNをメモ:
  arn:aws:datasync:ap-northeast-1:770923989980:location/loc-0abc123def456
```

---

## DataSync Location（Source）設定 - NFS

### Step 1-3: Location Type選択まで同じ

```
Location type: Network File System (NFS)

Agent: CIS-DataSync-Agent-NAS01
```

### Step 4: NFS Server設定

```
NFS server:
  Server hostname: 192.168.1.100

Export path: /volume1/shared
  注意: NAS側で設定したExportパスと完全一致すること

Subdirectory (Optional): /
  または
  Subdirectory: /ProjectFiles
```

### Step 5: Mount Options

```
NFS version: Automatic (推奨)
  または
  NFS version: NFSv4.1 (最新・高性能)

Mount options (Advanced):
  デフォルト:
    rsize=1048576,wsize=1048576,hard,timeo=600,retrans=2

  高速化カスタマイズ（10Gbps回線の場合）:
    rsize=4194304,wsize=4194304,hard,timeo=600,retrans=2,nordirplus
```

### Step 6: Tags & 作成

```
Tags: （SMBと同様）

「Create location」ボタンをクリック
```

---

## DataSync Location（Destination）設定 - S3

### Step 1: Location Type選択

```
AWS Console → DataSync → Locations → Create location

Location type: Amazon S3
```

### Step 2: S3 Bucket選択

```
S3 bucket:
  選択: cis-filesearch-landing

  または検索:
    arn:aws:s3:::cis-filesearch-landing
```

### Step 3: Folder（プレフィックス）設定

```
Folder: /
  （バケットのルートに保存）

または

Folder: /datasync-import/
  （特定プレフィックス以下に保存）

注意: NASのディレクトリ構造はこのプレフィックス以下に再現される
  例: NAS上の /Documents/report.pdf
    → S3: s3://cis-filesearch-landing/datasync-import/Documents/report.pdf
```

### Step 4: S3 Storage Class

```
S3 storage class: Intelligent-Tiering (推奨)

理由:
  - アクセス頻度に応じて自動的にストレージクラスを最適化
  - 初回アップロード後、90日間アクセスなしでArchive Accessへ自動移行
  - コスト削減効果: 約60%

その他選択肢:
  - Standard: 頻繁にアクセスする場合（最も高コスト）
  - Standard-IA: 低頻度アクセス（Intelligent-Tieringの方が柔軟）
  - Glacier: アーカイブ用（検索システムには不適）
```

### Step 5: IAM Role

```
IAM role: Choose an existing role

Role: CIS-DataSync-Task-Execution-Role
  ARN: arn:aws:iam::770923989980:role/CIS-DataSync-Task-Execution-Role

このRoleには以下の権限が必要:
  - s3:PutObject
  - s3:GetObject
  - s3:DeleteObject
  - s3:GetBucketLocation
  - s3:ListBucket
  - s3:ListBucketMultipartUploads
  - s3:AbortMultipartUpload
```

### Step 6: Tags & 作成

```
Tags:
  - Key: Project,     Value: CIS-FileSearch
  - Key: Component,   Value: DataSync-Destination
  - Key: Service,     Value: S3

「Create location」ボタンをクリック

✅ S3 Location ARNをメモ:
  arn:aws:datasync:ap-northeast-1:770923989980:location/loc-0def456abc789
```

---

## DataSync Task設定

### Step 1: Task作成開始

```
AWS Console → DataSync → Tasks → Create task
```

### Step 2: Source Location選択

```
Source location type: Choose an existing location

Source location:
  選択: SMB Location または NFS Location
  ARN: arn:aws:datasync:ap-northeast-1:770923989980:location/loc-0abc123def456

✅ Status: Available であることを確認
```

### Step 3: Destination Location選択

```
Destination location type: Choose an existing location

Destination location:
  選択: S3 Location
  ARN: arn:aws:datasync:ap-northeast-1:770923989980:location/loc-0def456abc789
```

### Step 4: Task名とタグ

```
Task name: CIS-NAS01-to-S3-Monthly-Sync

Description (Optional):
  Monthly data synchronization from on-premises NAS01 to S3 landing bucket.
  Transfers new and modified files only (incremental mode).

Tags:
  - Key: Project,     Value: CIS-FileSearch
  - Key: Component,   Value: DataSync-Task
  - Key: Schedule,    Value: Monthly
  - Key: NAS,         Value: NAS01
```

### Step 5: Task Settings（重要）

#### Data Transfer Configuration

```
Transfer mode: Transfer only data that has changed (推奨)
  理由: 月次実行のため、変更されたファイルのみ転送してコスト削減

  その他選択肢:
    - Transfer all data: 初回フルコピー時のみ使用
    - Transfer only data and metadata that has changed: メタデータ変更も検出
```

#### Verify Data

```
Verify data integrity: Verify only the data transferred (推奨)

検証方法:
  - 転送前: チェックサム計算（MD5）
  - 転送後: チェックサム再計算・比較
  - 不一致時: 自動再転送

その他選択肢:
  - Verify all data in the destination: 全データ検証（時間かかる）
  - Don't verify: 検証なし（非推奨）
```

#### Overwrite Files

```
Overwrite files in destination: Always (推奨)

理由:
  - NASで更新されたファイルは必ずS3にも反映
  - タイムスタンプが新しいファイルで上書き

その他選択肢:
  - Never: 既存ファイルは上書きしない（差分検出不可）
```

#### Deleted Files

```
Keep deleted files: Remove files in destination if deleted in source (推奨)

理由:
  - NASで削除されたファイルはS3からも削除
  - S3とNASの完全同期を維持

注意:
  - S3バージョニング有効化により、削除マーカーとして保存される
  - 誤削除時も復元可能
```

#### File Permissions

```
Preserve file permissions (POSIX): Yes (推奨)

保持されるメタデータ:
  - User ID (UID)
  - Group ID (GID)
  - File permissions (0644, 0755 etc.)
  - Modification time (mtime)
  - Access time (atime)

S3への保存形式:
  - x-amz-meta-uid: 1001
  - x-amz-meta-gid: 1001
  - x-amz-meta-permissions: 0644
  - x-amz-meta-mtime: 2025-01-15T10:30:00Z
```

#### Bandwidth

```
Bandwidth limit: 100 Mbps

理由:
  - 業務時間帯の手動実行時、業務に影響を与えない
  - 月次自動実行（深夜）は無制限に設定

設定方法（深夜無制限にする場合）:
  - Taskスケジュール設定で、深夜2:00実行時は無制限
  - 手動実行時は100Mbps制限
```

---

## フィルタリングルール設定

### Include/Exclude Patterns

```
「Configure additional settings」を展開

File filters:
  「Add filter」ボタンをクリック
```

#### 除外するファイル/フォルダの例

```
Filter 1 - Excludeパターン（ゴミ箱）:
  Filter type: Exclude
  Pattern: /.Trash/*
  説明: NASのゴミ箱フォルダを除外

Filter 2 - Excludeパターン（一時ファイル）:
  Filter type: Exclude
  Pattern: /**/~$*
  説明: Microsoft Officeの一時ファイル（~$report.docx など）

Filter 3 - Excludeパターン（バックアップフォルダ）:
  Filter type: Exclude
  Pattern: /Backup/*
  説明: バックアップ専用フォルダを除外

Filter 4 - Excludeパターン（隠しファイル）:
  Filter type: Exclude
  Pattern: /**/.*
  説明: .DS_Store, .Thumbs.db などの隠しファイル

Filter 5 - Excludeパターン（大容量動画ファイル）:
  Filter type: Exclude
  Pattern: /**/*.mp4
  Pattern: /**/*.avi
  Pattern: /**/*.mov
  説明: 動画ファイルは検索対象外のため除外（コスト削減）
```

#### 特定ファイルのみを含める例

```
Filter 6 - Includeパターン（ドキュメント）:
  Filter type: Include
  Pattern: /**/*.pdf
  Pattern: /**/*.docx
  Pattern: /**/*.xlsx
  Pattern: /**/*.pptx

Filter 7 - Includeパターン（画像）:
  Filter type: Include
  Pattern: /**/*.jpg
  Pattern: /**/*.png
  Pattern: /**/*.tiff

Filter 8 - Includeパターン（CAD/SFC）:
  Filter type: Include
  Pattern: /**/*.sfc
  Pattern: /**/*.dwg
  Pattern: /**/*.dxf
```

### フィルタの優先順位

```
処理順序:
  1. Excludeパターンが先に評価される
  2. その後、Includeパターンが評価される

例:
  Exclude: /**/*.mp4
  Include: /Important/**/*.mp4

  → /Important/ フォルダの.mp4ファイルは転送される
  → それ以外の.mp4ファイルは除外される
```

---

## スケジュール設定

### Step 1: Task Execution Scheduling

```
Task execution schedule: Schedule task execution (推奨)

Schedule type: Rate-based schedule
```

### Step 2: Frequency設定（月次）

```
Frequency: Monthly

Day of month: 1
  （毎月1日に実行）

Time: 02:00 (深夜2:00)
  理由: 業務時間外、ネットワーク負荷が低い時間帯

Timezone: Asia/Tokyo (UTC+9)
```

### Step 3: Cron Expression（高度なスケジュール）

```
より柔軟なスケジュールを設定したい場合:

Schedule type: Cron expression

Cron expression: 0 2 1 * ? *

説明:
  0    : 分（0分）
  2    : 時（2時）
  1    : 日（毎月1日）
  *    : 月（毎月）
  ?    : 曜日（指定なし）
  *    : 年（毎年）

例:
  - 毎月1日と15日の深夜2:00: 0 2 1,15 * ? *
  - 毎週日曜日の深夜3:00: 0 3 ? * SUN *
  - 毎日深夜1:00（初回テスト用）: 0 1 * * ? *
```

### Step 4: Task Logging

```
CloudWatch log group: Automatic (推奨)
  → /aws/datasync が自動作成される

Log level: Basic (推奨)
  記録内容:
    - Task開始/終了時刻
    - 転送ファイル数
    - 転送データ量
    - エラー情報

  その他選択肢:
    - Transfer: 全転送ファイルの詳細ログ（大量ログ、コスト増）
    - Off: ログなし（非推奨）
```

---

## テスト実行

### Step 1: 小規模テスト（100ファイル程度）

#### テスト用フォルダ作成

```
NAS上に以下のテストフォルダを作成:
  \\192.168.1.100\FileShare\DataSyncTest\

テストファイルを配置:
  - PDFファイル × 30個
  - Officeファイル × 30個
  - 画像ファイル × 30個
  - SFCファイル × 10個

合計: 約1GB
```

#### Task設定を一時変更

```
1. DataSync Task → CIS-NAS01-to-S3-Monthly-Sync → Edit

2. Source Location → Subdirectory を変更:
   Before: /
   After: /DataSyncTest

3. 「Save」をクリック
```

#### 手動実行

```
AWS Console → DataSync → Tasks → CIS-NAS01-to-S3-Monthly-Sync

「Start with overrides」ボタンをクリック

Overrides (Optional):
  ✅ Override bandwidth limit: Unlimited (テストなので制限なし)

「Start」ボタンをクリック
```

#### 実行状況の監視

```
Task execution status:
  - Launching: Task起動中
  - Preparing: ソースファイルリストを取得中
  - Transferring: ファイル転送中
  - Verifying: データ整合性検証中
  - Success: 完了

期待される実行時間（100ファイル、1GB）:
  - 1Gbps回線: 約5-10分
  - 100Mbps回線: 約15-30分
```

#### 実行結果の確認

```
Task execution details:
  Files transferred: 100
  Data transferred: 1.02 GB
  Files verified: 100
  Duration: 8 minutes 34 seconds
  Average throughput: 2.0 MB/s

✅ 全ファイルが正常に転送されたことを確認
```

### Step 2: S3バケット確認

```bash
# AWS CLIでS3バケット内容を確認
aws s3 ls s3://cis-filesearch-landing/DataSyncTest/ --recursive \
  --profile AdministratorAccess-770923989980

# 期待される出力:
2025-01-17 14:30:00    1048576 DataSyncTest/Documents/report001.pdf
2025-01-17 14:30:05     524288 DataSyncTest/Documents/report002.pdf
2025-01-17 14:30:10    2097152 DataSyncTest/Images/photo001.jpg
...

# ファイル数カウント
aws s3 ls s3://cis-filesearch-landing/DataSyncTest/ --recursive | wc -l

# 期待される出力: 100
```

### Step 3: メタデータ確認

```bash
# 特定ファイルのメタデータを確認
aws s3api head-object \
  --bucket cis-filesearch-landing \
  --key DataSyncTest/Documents/report001.pdf \
  --profile AdministratorAccess-770923989980

# 期待される出力:
{
  "LastModified": "2025-01-17T05:30:00+00:00",
  "ContentLength": 1048576,
  "ETag": "\"abc123def456...\"",
  "ContentType": "application/pdf",
  "ServerSideEncryption": "AES256",
  "Metadata": {
    "mtime": "1705467000",
    "uid": "1001",
    "gid": "1001",
    "permissions": "0644"
  }
}

✅ メタデータ（mtime, uid, gid, permissions）が保持されていることを確認
```

### Step 4: テスト設定を元に戻す

```
1. DataSync Task → Edit
2. Source Location → Subdirectory: / (ルートに戻す)
3. 「Save」をクリック
```

---

## CloudWatch Logs確認

### Log Groupへのアクセス

```
AWS Console → CloudWatch → Logs → Log groups

Log group name: /aws/datasync
```

### Log Stream確認

```
Log stream name: task-0abc123def456-exec-0xyz789

ログ内容（抜粋）:
  2025-01-17T14:25:00 [INFO] Task execution started
  2025-01-17T14:26:30 [INFO] Preparing source location: 100 files found
  2025-01-17T14:27:00 [INFO] Transferring: report001.pdf (1.0 MB)
  2025-01-17T14:27:05 [INFO] Transferring: report002.pdf (512 KB)
  ...
  2025-01-17T14:33:00 [INFO] Verifying data integrity: 100/100 files verified
  2025-01-17T14:33:34 [INFO] Task execution completed successfully
  2025-01-17T14:33:34 [SUMMARY] Files transferred: 100, Data: 1.02 GB, Duration: 8m 34s
```

---

## トラブルシューティング

### Issue 1: Task Execution Failed - "Unable to list source files"

**原因**:
```
- NASへの接続エラー
- 認証情報（ユーザー名/パスワード）が間違っている
- Subdirectoryのパスが間違っている
```

**対処法**:
```
1. Source Locationの設定を再確認
   → SMB Share名、NFS Export Pathが正しいか

2. Agent VMから手動接続テスト:
   SMBの場合:
     smbclient -L //192.168.1.100 -U datasync_user

   NFSの場合:
     showmount -e 192.168.1.100

3. CloudWatch Logsで詳細エラーを確認
```

### Issue 2: Task Execution Failed - "Access denied to S3 bucket"

**原因**:
```
- IAM RoleにS3バケットへのアクセス権限がない
- S3バケットポリシーでDataSync Roleが拒否されている
```

**対処法**:
```
1. IAM Role確認:
   aws iam get-role-policy \
     --role-name CIS-DataSync-Task-Execution-Role \
     --policy-name DataSyncS3Access \
     --profile AdministratorAccess-770923989980

2. S3バケットポリシー確認:
   aws s3api get-bucket-policy \
     --bucket cis-filesearch-landing \
     --profile AdministratorAccess-770923989980

3. 必要な権限が含まれているか確認:
   - s3:PutObject
   - s3:GetObject
   - s3:ListBucket
```

### Issue 3: 転送速度が遅い（期待値の10%以下）

**原因**:
```
- Agent VMのリソース不足（CPU/メモリ）
- ネットワーク帯域幅の制限
- 小さなファイルが大量にある
```

**対処法**:
```
1. Agent VMのリソース増強:
   - vCPU: 4 → 8コア
   - Memory: 16GB → 32GB

2. Bandwidth Limitを確認:
   → 100Mbps制限がある場合は、深夜実行時は無制限に

3. 小ファイルの並列転送数を増やす:
   → Agentのスペックアップで自動的に並列数が増加

4. ネットワーク調査:
   → Agent VMからインターネット速度テスト
   → speedtest-cli --secure
```

### Issue 4: フィルタリングルールが適用されない

**原因**:
```
- パターンの記述ミス
- ワイルドカードの誤用
```

**対処法**:
```
正しいパターン:
  ✅ /**/*.mp4       （全ての.mp4ファイル）
  ✅ /Backup/*       （Backupフォルダ以下全て）
  ✅ /**/~$*         （全ての~$で始まるファイル）

間違ったパターン:
  ❌ *.mp4           （ルート直下の.mp4のみ）
  ❌ Backup/         （スラッシュで終わる）
  ❌ /Backup/**      （DataSync独自のパターンと異なる）
```

---

## 完了確認チェックリスト

```
Location作成:
  ✅ Source Location (SMB/NFS) 作成完了
  ✅ Destination Location (S3) 作成完了
  ✅ 両LocationのStatus: Available

Task作成:
  ✅ DataSync Task作成完了
  ✅ Task名: CIS-NAS01-to-S3-Monthly-Sync
  ✅ Transfer mode: Transfer only data that has changed

Task Settings:
  ✅ Verify data integrity: Verify only the data transferred
  ✅ Overwrite files: Always
  ✅ Keep deleted files: Remove files in destination
  ✅ Preserve file permissions: Yes

フィルタリング:
  ✅ Excludeパターン設定完了（ゴミ箱、一時ファイル等）
  ✅ 動画ファイル除外（コスト削減）

スケジュール:
  ✅ 月次実行設定（毎月1日 深夜2:00）
  ✅ CloudWatch Logs有効化

テスト実行:
  ✅ 小規模テスト（100ファイル）成功
  ✅ S3バケットにファイル転送確認
  ✅ メタデータ保持確認
  ✅ CloudWatch Logsでログ確認
```

---

## 次のステップ

Location & Task設定が完了したら、次のガイドへ進んでください:

```
✅ 05-datasync-location-task-configuration-guide.md ← 現在
⏳ 06-datasync-full-sync-execution-guide.md ← 次のステップ
   → 初回フルコピー（10TB、500万ファイル）の実行
```

---

## 参考資料

- [Creating a source location for SMB](https://docs.aws.amazon.com/datasync/latest/userguide/create-smb-location.html)
- [Creating a source location for NFS](https://docs.aws.amazon.com/datasync/latest/userguide/create-nfs-location.html)
- [Creating a destination location for Amazon S3](https://docs.aws.amazon.com/datasync/latest/userguide/create-s3-location.html)
- [Creating a task in AWS DataSync](https://docs.aws.amazon.com/datasync/latest/userguide/create-task.html)
- [Filtering the data transferred by DataSync](https://docs.aws.amazon.com/datasync/latest/userguide/filtering.html)

---

**作成者**: CIS DevOps Team
**最終更新**: 2025-01-17
