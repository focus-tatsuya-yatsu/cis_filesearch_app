# SQS無限ループ修正 - 緊急デプロイ実行計画

**作成日**: 2025-12-13
**承認者**: Product Manager
**ステータス**: ✅ 承認済み - 即座実行推奨

---

## 📋 Executive Decision Summary

### Go/No-Go判断: ✅ **GO - 即座にデプロイ実行**

**重大性評価:**
- 58,524メッセージ滞留による運用コスト継続的増加リスク
- Auto Scaling 1台でも不要な処理リソース消費
- DLQ不安定化による本番環境の信頼性低下

**推奨方式**: **Option 1 - S3 + User Data方式**

**理由:**
1. 最速デプロイ（15-20分）
2. 将来のメンテナンス性向上（S3ファイル更新のみで修正可能）
3. ロールバック容易（3分以内）
4. 初心者でも実行可能（明確な手順）

---

## 🎯 デプロイ方式の意思決定

### 意思決定マトリックス

| 評価項目 | Option 1 (S3) | Option 2 (新AMI) | Option 3 (手動AMI) |
|---------|---------------|------------------|-------------------|
| デプロイ速度 | ⭐⭐⭐ (15-20分) | ⭐⭐ (30-40分) | ⭐ (60-90分) |
| 運用性 | ⭐⭐⭐ | ⭐⭐ | ⭐ |
| 初心者対応 | ⭐⭐⭐ | ⭐⭐ | ⭐ |
| ロールバック | ⭐⭐⭐ (即座) | ⭐⭐ | ⭐ |
| 将来性 | ⭐⭐⭐ | ⭐ | ⭐ |
| リスク | 低 | 中 | 高 |

### Option 1の戦略的優位性

1. **即効性**: Launch Template更新のみでデプロイ完了
2. **メンテナンス性**: 次回からはS3ファイル更新だけで修正可能
3. **透明性**: User Dataで何が実行されるか明確
4. **柔軟性**: 緊急時に即座にバージョン切り替え可能

---

## 📅 詳細タイムライン（全20分）

### Phase 1: 準備 (5分)

```bash
# Step 1.1: S3バケット確認・作成
aws s3 mb s3://cis-filesearch-worker-scripts --region ap-northeast-1

# Step 1.2: 修正版アップロード
aws s3 cp /Users/tatsuya/focus_project/cis_filesearch_app/backend/file-scanner/worker_fixed.py \
  s3://cis-filesearch-worker-scripts/worker.py

# Step 1.3: 確認
aws s3 ls s3://cis-filesearch-worker-scripts/
```

**成功基準:**
- ✅ S3バケットが作成される
- ✅ worker.pyがS3に存在
- ✅ ファイルサイズが正常（> 10KB）

---

### Phase 2: Launch Template更新 (5分)

```bash
# Step 2.1: 現在のLaunch Template確認
aws ec2 describe-launch-template-versions \
  --launch-template-name cis-filesearch-worker-template \
  --versions '$Latest' \
  --region ap-northeast-1

# Step 2.2: User Dataスクリプト作成
cat > /tmp/userdata.sh <<'EOF'
#!/bin/bash
set -e

# 既存のセットアップ処理（AMI内に含まれる）
# ...

# 修正版worker.pyをS3から取得
echo "Downloading fixed worker.py from S3..."
cd /opt/file-scanner
aws s3 cp s3://cis-filesearch-worker-scripts/worker.py worker.py --region ap-northeast-1

# Workerサービス再起動
echo "Restarting file-scanner-worker service..."
systemctl restart file-scanner-worker

echo "Worker deployment complete!"
EOF

# Step 2.3: User DataをBase64エンコード
USER_DATA_BASE64=$(base64 -i /tmp/userdata.sh)

# Step 2.4: Launch Template JSON作成
cat > /tmp/new-template-data.json <<EOF
{
  "LaunchTemplateData": {
    "UserData": "$USER_DATA_BASE64"
  }
}
EOF

# Step 2.5: 新バージョン作成
aws ec2 create-launch-template-version \
  --launch-template-name cis-filesearch-worker-template \
  --source-version '$Latest' \
  --launch-template-data file:///tmp/new-template-data.json \
  --region ap-northeast-1
```

**成功基準:**
- ✅ 新しいLaunch Template Versionが作成される
- ✅ User DataにS3取得コマンドが含まれる

---

### Phase 3: インスタンス入れ替え (5-10分)

```bash
# Step 3.1: Auto Scaling Groupの最新テンプレート適用
aws autoscaling update-auto-scaling-group \
  --auto-scaling-group-name cis-filesearch-worker-asg \
  --launch-template LaunchTemplateName=cis-filesearch-worker-template,Version='$Latest' \
  --region ap-northeast-1

# Step 3.2: インスタンスリフレッシュ開始
aws autoscaling start-instance-refresh \
  --auto-scaling-group-name cis-filesearch-worker-asg \
  --preferences MinHealthyPercentage=0,InstanceWarmup=60 \
  --region ap-northeast-1

# Step 3.3: リフレッシュ進行状況確認（30秒ごと）
watch -n 30 'aws autoscaling describe-instance-refreshes \
  --auto-scaling-group-name cis-filesearch-worker-asg \
  --region ap-northeast-1 \
  --query "InstanceRefreshes[0].[Status,PercentageComplete]" \
  --output table'
```

**成功基準:**
- ✅ 旧インスタンス終了
- ✅ 新インスタンス起動・Running状態
- ✅ ヘルスチェック成功

---

### Phase 4: 検証 (5分)

```bash
# 検証スクリプト実行
chmod +x /Users/tatsuya/focus_project/cis_filesearch_app/deployment-verification.sh
/Users/tatsuya/focus_project/cis_filesearch_app/deployment-verification.sh
```

**検証内容:**
1. SQSメッセージ数確認
2. DLQメッセージ数確認
3. EC2インスタンス状態確認
4. CloudWatch Logsエラーチェック

**成功基準:**
- ✅ SQSメッセージ数が5分で10%以上減少
- ✅ DLQへの新規メッセージ流入停止
- ✅ CloudWatch Logsにエラーなし

---

## 🛡️ リスク管理計画

### リスク評価マトリックス

| リスク項目 | 確率 | 影響度 | 緩和策 |
|-----------|------|--------|--------|
| User Data実行失敗 | 低 | 高 | ロールバック手順整備 |
| S3アクセス権限不足 | 中 | 中 | IAMロール事前確認 |
| インスタンス起動失敗 | 低 | 高 | 旧インスタンス保持 |
| SQS処理停止（5-10分） | 高 | 低 | 許容範囲（非リアルタイム） |

### ロールバック計画（3分以内実行）

```bash
# 緊急ロールバック手順

# Step 1: Launch Template旧バージョンに戻す
aws autoscaling update-auto-scaling-group \
  --auto-scaling-group-name cis-filesearch-worker-asg \
  --launch-template LaunchTemplateName=cis-filesearch-worker-template,Version='1' \
  --region ap-northeast-1

# Step 2: インスタンスリフレッシュ
aws autoscaling start-instance-refresh \
  --auto-scaling-group-name cis-filesearch-worker-asg \
  --preferences MinHealthyPercentage=0,InstanceWarmup=60 \
  --region ap-northeast-1

# Step 3: 確認
aws ec2 describe-instances \
  --filters "Name=tag:aws:autoscaling:groupName,Values=cis-filesearch-worker-asg" \
            "Name=instance-state-name,Values=running" \
  --query 'Reservations[0].Instances[0].[InstanceId,LaunchTime]' \
  --output table
```

---

## ✅ 成功基準と監視計画

### デプロイ成功の定義

**即時確認（デプロイ後5分）:**
1. ✅ 新インスタンスが正常起動
2. ✅ worker.pyがS3から正常取得（CloudWatch Logs確認）
3. ✅ SQSメッセージ処理開始（メッセージ数減少）
4. ✅ DLQへのエラーメッセージ流入停止

**短期確認（1時間後）:**
1. ✅ SQSメッセージ数が1,000以下に減少
2. ✅ DLQメッセージ数が安定（増加なし）
3. ✅ CloudWatch Logsにエラーなし

**最終確認（24時間後）:**
1. ✅ SQSメッセージ数が100以下（正常状態）
2. ✅ DLQメッセージゼロ
3. ✅ Auto Scaling 1台で安定稼働

### 24時間監視計画

**監視スクリプト実行:**
```bash
# 1時間ごとに実行（cron設定推奨）
chmod +x /Users/tatsuya/focus_project/cis_filesearch_app/24h-monitoring.sh

# 手動実行
/Users/tatsuya/focus_project/cis_filesearch_app/24h-monitoring.sh

# cron設定例（1時間ごと）
0 * * * * /Users/tatsuya/focus_project/cis_filesearch_app/24h-monitoring.sh
```

**監視項目とアラート基準:**

| 監視項目 | 正常範囲 | 警告 | 緊急 |
|---------|---------|------|------|
| SQSメッセージ数 | <100 | 1,000-10,000 | >10,000 |
| DLQメッセージ数 | 0 | 1-50 | >50 |
| EC2台数 | 1 | 2 | ≥3 |
| エラーログ | 0/時間 | 1-5/時間 | >5/時間 |

**期待される効果:**
- **1時間後**: SQSメッセージ 58,524 → 5,000以下（90%減少）
- **6時間後**: SQSメッセージ 1,000以下（98%減少）
- **24時間後**: SQSメッセージ 100以下、DLQゼロ（正常稼働）

---

## 🚀 Phase 2への影響分析

### ポジティブな影響

1. ✅ **インフラ安定化**: 開発環境の信頼性向上
2. ✅ **CI/CD基盤整備**: S3ベースデプロイ確立
3. ✅ **コスト削減**: 月額$270節約（Phase 2予算確保）
4. ✅ **運用ノウハウ蓄積**: 緊急対応プロセス確立

### Phase 2タスク開始タイミング

**即座開始可能:**
- Lambda API開発（独立している）
- フロントエンド開発（バックエンドAPI完成後）

**24時間後開始推奨:**
- 画像検索機能（SQS安定確認後）
- フルテキスト検索（インフラ信頼性確認後）

---

## 📝 今後のメンテナンス性向上策

### 短期施策（今週中）
1. ✅ S3デプロイパイプライン自動化
2. ✅ CloudWatch Alarmsセットアップ
3. ✅ ランブック作成（障害対応手順）

### 中期施策（Phase 2期間中）
1. GitHub Actions CI/CDパイプライン構築
2. Terraformコード化（Infrastructure as Code）
3. ブルー/グリーンデプロイメント導入

### 長期施策（Phase 3以降）
1. Kubernetes移行検討（ECS/EKS）
2. マルチリージョン構成
3. 自動スケーリング最適化

---

## 📊 コスト影響分析

### 緊急対応によるコスト削減

**Before（問題発生時）:**
- Auto Scaling: 10台 × t3.medium × $0.0416/時間 = $300/月
- 不要なSQS処理: 推定$50/月
- **合計**: $350/月

**After（対応後）:**
- Auto Scaling: 1台 × t3.medium × $0.0416/時間 = $30/月
- 正常なSQS処理: $0.40/月
- **合計**: $30.40/月

**削減効果: $319.60/月（91%削減）**

---

## 🎓 Lessons Learned

### 今回の成功要因
1. ✅ 迅速な根本原因特定（コードレビュー）
2. ✅ 緊急コスト削減対応（Auto Scaling調整）
3. ✅ 明確なデプロイ計画策定（3つのOption比較）

### 今後の改善点
1. ⚠️ SQS監視アラート未設定（早期発見できず）
2. ⚠️ デプロイ自動化未整備（手動デプロイ必要）
3. ⚠️ ログ監視体制が不十分

### アクションアイテム
1. CloudWatch Alarms即座設定（今週中）
2. CI/CDパイプライン構築（Phase 2期間中）
3. 定期コストレビュー体制確立（月次）
4. ランブック整備（来週中）

---

## 📞 ステークホルダー通知計画

### 通知タイミング

**デプロイ開始時:**
- Slack/Email通知: 「SQS無限ループ修正デプロイ開始」

**デプロイ完了時（20分後）:**
- Slack/Email通知: 「デプロイ成功 - 検証開始」

**1時間後:**
- Slack/Email通知: 「第1回監視結果レポート」

**24時間後:**
- Slack/Email通知: 「最終検証レポート - Phase 2 Go/No-Go判断」

---

## ✅ 承認サイン

**承認者**: Product Manager
**承認日時**: 2025-12-13
**実行承認**: ✅ 即座実行推奨

**次のアクション:**
1. Phase 1: 準備（5分） - S3バケット作成・アップロード
2. Phase 2: デプロイ（10分） - Launch Template更新・インスタンス入れ替え
3. Phase 3: 検証（5分） - deployment-verification.sh実行
4. Phase 4: 監視（24時間） - 24h-monitoring.sh定期実行

**期待される結果:**
- 20分後: デプロイ完了
- 1時間後: SQSメッセージ90%減少
- 24時間後: 正常稼働確認、Phase 2開始

---

**最終更新**: 2025-12-13
**ドキュメントステータス**: 承認済み・実行待ち
