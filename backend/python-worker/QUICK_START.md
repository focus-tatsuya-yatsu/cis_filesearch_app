# Worker Verification - Quick Start Guide

新しいworkerインスタンス (i-0e6ac1e4d535a4ab2) の検証方法

## 前提条件

AWS CLIとPython 3が正しく設定されている必要があります。

```bash
# AWS認証情報の確認
aws sts get-caller-identity

# Pythonバージョン確認
python3 --version
```

## 🚀 最も簡単な検証方法

```bash
# ディレクトリに移動
cd /Users/tatsuya/focus_project/cis_filesearch_app/backend/python-worker

# クイック検証実行（1分で完了）
python3 quick-verify.py
```

**期待される出力（成功時）**:
```
✓ Instance is running
✓ Messages are being processed
✓ PROCESSING IS WORKING: 150 files indexed in last 30 minutes
Processing rate: 85.2%

🎉 VERIFICATION SUCCESSFUL: Worker is processing files correctly!
```

**警告が出た場合**:
```
❌ VERIFICATION FAILED: Worker is NOT processing files!
```
→ トラブルシューティングセクションへ

## 📊 詳細分析（問題がある場合）

```bash
# CloudWatchログの詳細分析
python3 analyze-logs.py --minutes 60 --file-types --opensearch

# 何を確認するか：
# - "Files indexed" の数が 0 より大きい = ✅ 処理されている
# - "Messages received" のみで "Files indexed" が 0 = ❌ 削除のみ
```

## 🔍 OpenSearch検証

### 方法1: ポートフォワーディング（推奨）

```bash
# ターミナル1: ポートフォワーディング開始
./ssm-connect.sh
# メニューでオプション9を選択

# ターミナル2: OpenSearch確認
curl -X GET "http://localhost:9200/file-metadata/_count?pretty"
curl -X GET "http://localhost:9200/file-metadata/_search?pretty&size=5"
```

### 方法2: EC2から直接確認

```bash
# インスタンスに接続
./ssm-connect.sh
# メニューでオプション1を選択

# OpenSearch確認
curl https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com/file-metadata/_count?pretty
```

## 🔧 トラブルシューティング

### 問題1: 「Messages deleted but NOT indexed」

**原因**: Workerがメッセージを削除しているが、OpenSearchにインデックスしていない

**確認手順**:
```bash
# 1. インスタンスに接続
./ssm-connect.sh  # オプション1

# 2. Workerログを確認
tail -100 /var/log/worker.log | grep -i "opensearch"

# 3. OpenSearch接続をテスト
curl -v https://vpc-cis-filesearch-opensearch-xuupcgptq6a4opklfeh65x3uqe.ap-northeast-1.es.amazonaws.com/_cluster/health 2>&1

# 4. 環境変数を確認
printenv | grep OPENSEARCH
```

### 問題2: 「No recent processing activity」

**原因**: キューが空の可能性

**確認手順**:
```bash
# SQSキューを確認
aws sqs get-queue-attributes \
  --queue-url https://sqs.ap-northeast-1.amazonaws.com/770923989980/cis-filesearch-index-queue \
  --attribute-names ApproximateNumberOfMessages

# メッセージがある場合は、数分待ってから再度検証
sleep 300
python3 quick-verify.py
```

### 問題3: AWS認証エラー

**エラー**: "The security token included in the request is invalid"

**解決策**:
```bash
# AWS認証情報を設定
aws configure

# またはプロファイルを使用
export AWS_PROFILE=your-profile-name

# 再度検証
python3 quick-verify.py
```

## 📈 継続的なモニタリング

### リアルタイムログ監視

```bash
# CloudWatchログをリアルタイムで表示
aws logs tail /aws/ec2/cis-filesearch-worker --follow --region ap-northeast-1
```

### 定期的な検証スケジュール

```bash
# 10分ごとに検証（例）
watch -n 600 'python3 quick-verify.py'
```

## ✅ 成功基準チェックリスト

次の条件がすべて満たされていることを確認:

- [ ] `quick-verify.py` が成功ステータスを返す
- [ ] CloudWatchログに "Indexed to OpenSearch" メッセージがある
- [ ] OpenSearchインデックスのドキュメント数が増加している
- [ ] エラー率が5%未満
- [ ] 処理率が80%以上

## 📚 関連ドキュメント

- **詳細ガイド**: `VERIFICATION_GUIDE.md`
- **メインREADME**: `README.md`

## 🆘 サポート

問題が解決しない場合:

1. すべての検証スクリプトの出力を保存
2. CloudWatchログをエクスポート
3. 以下の情報を含めて報告:
   - `quick-verify.py` の出力
   - `analyze-logs.py --minutes 60 --file-types --opensearch` の出力
   - エラーメッセージのスクリーンショット

---

**Instance ID**: i-0e6ac1e4d535a4ab2
**Last Updated**: 2025-12-15
