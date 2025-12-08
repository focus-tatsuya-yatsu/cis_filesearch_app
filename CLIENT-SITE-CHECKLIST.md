# クライアント先訪問チェックリスト

**訪問日**: _________
**作業者**: _________
**開始時刻**: _________
**終了時刻**: _________

---

## 📦 持参物

### 必須

- [ ] ノートPC（AWS CLI設定済み）
- [ ] 環境変数ファイル `/tmp/cis-aws-env.sh` のバックアップ
- [ ] このチェックリスト（印刷またはデジタル）
- [ ] NAS接続情報メモ（後述）
- [ ] AWS認証情報（IAMユーザー/SSO）

### 推奨

- [ ] LANケーブル（有線接続用）
- [ ] USBメモリ（スクリプトバックアップ用）
- [ ] 電源アダプター
- [ ] 携帯Wi-Fiルーター（バックアップ通信）

---

## 📋 事前準備（自社オフィス完了済み）

### ✅ 完了確認

- [ ] S3 EventBridge有効化完了
- [ ] EventBridge Rule作成完了
- [ ] SQS Message Retention 7日間設定完了
- [ ] CloudWatch Dashboard作成完了
- [ ] 検証スクリプト全チェックパス
- [ ] エンドツーエンドテスト成功

### 確認コマンド

```bash
# 自社オフィスで最終確認
cd /Users/tatsuya/focus_project/cis_filesearch_app/backend/ec2-worker
python3 verify_aws_config.py

# 期待: 全チェックパス
```

---

## 🏢 クライアント先での作業フロー

### Phase 1: 環境確認（15分）

#### 1.1 NAS接続情報収集

クライアント担当者から以下の情報を取得：

| 項目 | 値 | 確認済み |
|------|-----|----------|
| NAS IPアドレス | _________________ | [ ] |
| NAS ホスト名 | _________________ | [ ] |
| 共有フォルダパス | _________________ | [ ] |
| ユーザー名 | _________________ | [ ] |
| パスワード | _________________ | [ ] |
| ドメイン名（必要な場合） | _________________ | [ ] |

#### 1.2 ネットワーク疎通確認

```bash
# Hyper-V VM (172.30.116.56) にSSH接続
ssh admin@172.30.116.56

# NASへPing
ping <NAS_IP_ADDRESS>

# 期待: Reply from ... time=XXms
```

- [ ] Ping疎通成功
- [ ] 平均応答時間: _____ ms（10ms以下推奨）

#### 1.3 SMBポート確認（TCP 445）

```bash
# Windowsの場合（Scanner PC）
Test-NetConnection -ComputerName <NAS_IP_ADDRESS> -Port 445

# Linuxの場合
nc -zv <NAS_IP_ADDRESS> 445
```

- [ ] TCP 445ポート開放確認

---

### Phase 2: NAS接続テスト（10分）

#### 2.1 PowerShellスクリプト実行（Windows Scanner PC）

```powershell
# スクリプトディレクトリに移動
cd C:\CIS-FileSearch\scripts\client-site

# NAS接続テスト実行
pwsh 01-test-nas-connection.ps1 `
  -NasServer "<NAS_IP_ADDRESS>" `
  -SharePath "<SHARE_PATH>" `
  -Username "<USERNAME>" `
  -Password (ConvertTo-SecureString "<PASSWORD>" -AsPlainText -Force)

# ドメイン環境の場合
pwsh 01-test-nas-connection.ps1 `
  -NasServer "<NAS_IP_ADDRESS>" `
  -SharePath "<SHARE_PATH>" `
  -Username "<USERNAME>" `
  -Password (ConvertTo-SecureString "<PASSWORD>" -AsPlainText -Force) `
  -Domain "<DOMAIN_NAME>"
```

#### 2.2 テスト結果確認

- [ ] Ping成功
- [ ] SMB接続成功
- [ ] ファイル一覧取得成功
- [ ] ファイル読み取り成功

**エラー時の対処**:
- Ping失敗 → ネットワーク設定確認
- SMB失敗 → ユーザー名/パスワード再確認
- 読み取り失敗 → ファイル権限確認

---

### Phase 3: DataSync Location作成（10分）

#### 3.1 環境変数読み込み

```bash
# MacまたはLinux
source /tmp/cis-aws-env.sh

# 確認
echo $AWS_ACCOUNT_ID
echo $DATASYNC_AGENT_ARN
```

- [ ] 環境変数読み込み成功

#### 3.2 NAS Location作成

```bash
cd /Users/tatsuya/focus_project/cis_filesearch_app

bash scripts/client-site/02-create-datasync-nas-location.sh
```

**入力項目**:
- NAS Server: _________________
- Share Path: _________________
- Subdirectory: _________________ (デフォルト: /)
- Username: _________________
- Password: _________________
- Domain: _________________ (オプション)

#### 3.3 Location ARN確認

```bash
# 作成されたLocation ARN
echo $DATASYNC_NAS_LOCATION_ARN
```

- [ ] Location ARN取得成功
- Location ARN: _________________________________

---

### Phase 4: DataSync Task作成（10分）

#### 4.1 Task作成スクリプト実行

```bash
bash scripts/client-site/03-create-datasync-task.sh
```

**自動処理内容**:
- S3 Location確認/作成
- CloudWatch Log Group確認/作成
- DataSync Task作成
- 月次スケジュール設定（毎月1日 02:00 AM）

#### 4.2 Task ARN確認

```bash
# 作成されたTask ARN
echo $DATASYNC_TASK_ARN
```

- [ ] Task ARN取得成功
- Task ARN: _________________________________

#### 4.3 Task設定確認

```bash
# Task詳細確認
aws datasync describe-task \
  --task-arn $DATASYNC_TASK_ARN \
  --region ap-northeast-1
```

**確認ポイント**:
- [ ] スケジュール: `cron(0 2 1 * ? *)`
- [ ] TransferMode: `CHANGED`（差分のみ）
- [ ] BytesPerSecond: `12500000`（100 Mbps）

---

### Phase 5: 初回同期テスト（30分〜数時間）

#### 5.1 同期開始

```bash
bash scripts/client-site/04-test-initial-sync.sh
```

**注意**:
- 初回同期はファイル数に応じて時間がかかります
- Ctrl+Cで監視を中断してもタスクは継続実行されます

#### 5.2 進捗モニタリング

**スクリプト出力例**:
```
[14:30:15] Status: LAUNCHING
[14:30:25] Status: PREPARING
[14:31:00] Status: TRANSFERRING
   転送済み: 150 MB, ファイル数: 45
[14:32:00] Status: TRANSFERRING
   転送済み: 320 MB, ファイル数: 98
...
```

- [ ] Task実行開始
- [ ] TRANSFERRING状態確認
- 開始時刻: _________
- 終了時刻: _________

#### 5.3 S3バケット確認

```bash
# 転送されたファイル数
aws s3 ls s3://cis-filesearch-s3-landing/files/ --recursive | wc -l

# サンプルファイル表示
aws s3 ls s3://cis-filesearch-s3-landing/files/ --recursive | head -n 10
```

- [ ] S3にファイル転送確認
- 転送ファイル数: _________ 個
- 総データ量: _________ MB/GB

---

### Phase 6: エンドツーエンド検証（15分）

#### 6.1 EventBridge → SQS連携確認

```bash
# テストファイルアップロード
echo "Client Site Test - $(date)" > client-test.txt
aws s3 cp client-test.txt s3://cis-filesearch-s3-landing/files/test/

# 5秒待機
sleep 5

# SQSメッセージ確認
aws sqs receive-message \
  --queue-url $SQS_QUEUE_URL \
  --max-number-of-messages 1 \
  --wait-time-seconds 10 \
  --region ap-northeast-1
```

- [ ] EventBridgeイベント発火確認
- [ ] SQSメッセージ受信確認
- [ ] メッセージ内容正常（s3Bucket, s3Key, fileSize等）

#### 6.2 CloudWatch Metrics確認

```bash
# EventBridge呼び出し回数
aws cloudwatch get-metric-statistics \
  --namespace AWS/Events \
  --metric-name Invocations \
  --dimensions Name=RuleName,Value=cis-s3-to-sqs-file-upload \
  --start-time $(date -u -d '10 minutes ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 60 \
  --statistics Sum \
  --region ap-northeast-1
```

- [ ] CloudWatchメトリクス確認
- [ ] EventBridge Invocations > 0

---

## 🎉 完了確認

### 全体チェックリスト

#### 自社オフィス準備

- [ ] S3 EventBridge有効化
- [ ] EventBridge Rule作成
- [ ] SQS Message Retention延長
- [ ] CloudWatch Dashboard作成
- [ ] 検証スクリプト全チェックパス

#### クライアント先作業

- [ ] NAS接続情報取得
- [ ] ネットワーク疎通確認（Ping, SMB）
- [ ] NAS接続テスト成功
- [ ] DataSync NAS Location作成
- [ ] DataSync Task作成
- [ ] 初回同期実行・完了
- [ ] S3バケットファイル確認
- [ ] EventBridge → SQS連携確認
- [ ] CloudWatchメトリクス確認

---

## 📊 最終レポート

### 作業結果サマリ

| 項目 | 値 |
|------|-----|
| DataSync Agent ARN | _________________ |
| NAS Location ARN | _________________ |
| S3 Location ARN | _________________ |
| DataSync Task ARN | _________________ |
| 同期ファイル数 | _________ 個 |
| 総データ量 | _________ MB/GB |
| 初回同期所要時間 | _________ 分 |
| 次回同期予定日時 | 毎月1日 02:00 AM |

### 引き継ぎ事項

```
□ 定期同期スケジュール: 毎月1日 02:00 AM
□ CloudWatch Dashboard URL: https://console.aws.amazon.com/cloudwatch/home?region=ap-northeast-1#dashboards:name=CIS-FileSearch-Monitoring
□ エラー時の連絡先: _________________
□ その他特記事項: _________________
```

---

## 🔧 トラブルシューティング

### よくある問題

#### 問題1: NAS接続失敗

**症状**: Ping成功、SMB失敗

**解決策**:
1. ユーザー名/パスワード再確認
2. ドメイン指定が必要か確認
3. NAS側のファイアウォール設定確認
4. SMBバージョン確認（SMB3推奨）

#### 問題2: DataSync Location作成失敗

**症状**: InvalidLocationException

**解決策**:
1. DataSync Agent状態確認: `ONLINE`
2. Agent ARN正確性確認
3. NASへのネットワーク経路確認
4. Agent再起動: `sudo systemctl restart amazon-datasync-agent`

#### 問題3: Task実行失敗

**症状**: Task状態が`ERROR`

**解決策**:
```bash
# Task実行詳細確認
aws datasync describe-task-execution \
  --task-execution-arn <TASK_EXECUTION_ARN> \
  --region ap-northeast-1

# CloudWatch Logsで詳細確認
aws logs tail /aws/datasync/cis-filesearch --follow
```

#### 問題4: SQSメッセージが届かない

**症状**: S3にファイルあるが、SQS空

**解決策**:
1. S3 EventBridge有効化確認
2. EventBridge Rule状態確認
3. SQS Policy確認（events.amazonaws.com許可）
4. files/プレフィックス配下にアップロード確認

---

## 📞 緊急連絡先

| 担当 | 連絡先 | 対応可能時間 |
|------|--------|--------------|
| プロジェクトリーダー | _________________ | _________ |
| バックエンドエンジニア | _________________ | _________ |
| AWSアーキテクト | _________________ | _________ |

---

## 📚 参考ドキュメント

- クイックスタート: `/OFFICE-SETUP-QUICKSTART.md`
- 詳細ガイド: `/docs/deployment/PRE-CLIENT-SITE-PREPARATION.md`
- DataSync設定: `/docs/deployment/datasync/`

---

**作業完了日時**: _________
**作業者サイン**: _________
**確認者サイン**: _________

---

**Document Version**: 1.0
**Last Updated**: 2025-12-01
**Author**: CIS Development Team
