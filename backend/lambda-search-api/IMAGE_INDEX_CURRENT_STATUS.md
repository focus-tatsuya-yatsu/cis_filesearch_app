# 🔍 画像インデックスの現状と対応方針

作成日: 2024-12-19

## 📊 現状分析結果

### 1. インデックスの状態
```
インデックス名: file-index-v2-knn
ベクトル次元数: 1024次元（AWS Bedrock Titan想定）
現在のドキュメント数: 10件（サンプル画像のみ）
```

### 2. 現在インデックスされている画像
| ファイル名 | パス | 状態 |
|-----------|------|------|
| sample_1.jpg～sample_10.jpg | /shared/images/ | テスト用サンプル画像のみ |

### 3. 問題点
- ✅ **テキスト検索**: 10,000件の実ファイルがインデックス済み（正常動作）
- ❌ **画像検索**: サンプル10件のみ（実画像なし）
- 実際のNASファイルの画像がベクトル化されていない
- ユーザーがアップロードした画像と無関係なサンプル画像が返される

## 🎯 解決方針

### オプション1: 新規インデックス作成（推奨）
**メリット:**
- 既存のシステムに影響なし
- 段階的な移行が可能
- ロールバック可能

**手順:**
1. 新インデックス `file-index-v3-knn` を作成（1024次元）
2. 実画像をバッチ処理でインデックス化
3. 動作確認後、Lambda関数で使用インデックスを切り替え
4. 旧インデックスを削除

### オプション2: 既存インデックス更新
**メリット:**
- 設定変更不要
- 即座に反映

**デメリット:**
- サンプルデータと実データが混在
- エラー時の切り戻しが困難

## 🚀 実行手順（推奨案）

### フェーズ1: 準備（30分）
```bash
# 1. 必要なパッケージインストール
cd /Users/tatsuya/focus_project/cis_filesearch_app/backend/lambda-search-api
pip3 install boto3 opensearch-py tqdm

# 2. AWS認証確認
aws sso login
aws sts get-caller-identity

# 3. 現在の画像ファイル数を確認
aws s3 ls s3://cis-filesearch-s3-landing/ --recursive | grep -E '\.(jpg|jpeg|png|gif)' | wc -l
```

### フェーズ2: テスト実行（1時間）
```bash
# 1. 小規模テスト（100ファイル）
python3 scripts/batch-index-images.py \
  --max-files 100 \
  --dry-run \
  --concurrency 5

# 2. 結果確認
./test-image-1024.sh
```

### フェーズ3: 本番実行（推定時間）
| 画像数 | 処理時間 | 並列数 | コスト |
|--------|----------|--------|--------|
| 1,000 | 10分 | 5 | $0.05 |
| 10,000 | 1時間 | 10 | $0.40 |
| 100,000 | 5時間 | 20 | $4.00 |
| 500,000 | 1日 | 30 | $20.00 |

### フェーズ4: 検証
```bash
# 実画像での検索テスト
curl -X POST http://localhost:3000/api/search \
  -H "Content-Type: application/json" \
  -F "file=@/path/to/test-image.jpg"
```

## 💡 重要な考慮事項

### 1. ベクトル生成方法の選択
現在のシステムは **1024次元** を使用していますが、以下の選択肢があります：

| 方式 | 次元数 | コスト | 速度 | 精度 |
|------|--------|--------|------|------|
| AWS Bedrock Titan | 1024 | $0.0008/画像 | 遅い | 高 |
| CLIP (Lambda) | 512 | $0.00003/画像 | 速い | 中 |
| ローカル処理 | 任意 | 無料 | 最速 | 設定次第 |

### 2. インデックス作成のタイミング
- **即座に必要**: サンプルをクリアして本番画像をインデックス
- **段階的**: 新規追加分から順次ベクトル化
- **週末実行**: システム負荷の低い時間帯に一括処理

### 3. 今後の運用
```python
# EC2 Workerに追加（新規画像の自動ベクトル化）
if file_extension in ['.jpg', '.jpeg', '.png']:
    embedding = generate_embedding(file_path)
    document['image_vector'] = embedding
```

## 📝 即実行コマンド

### オプションA: すぐに10件テスト
```bash
# 10件の実画像をインデックス化してテスト
cd /Users/tatsuya/focus_project/cis_filesearch_app/backend/lambda-search-api
python3 << 'EOF'
import boto3
import json
import random

# S3から画像ファイルを10件取得
s3 = boto3.client('s3')
bucket = 'cis-filesearch-s3-landing'

response = s3.list_objects_v2(
    Bucket=bucket,
    Prefix='documents/',
    MaxKeys=100
)

images = [obj for obj in response.get('Contents', [])
          if obj['Key'].lower().endswith(('.jpg', '.jpeg', '.png'))][:10]

print(f"Found {len(images)} images to index")

# TODO: 各画像に対してベクトル生成とインデックス化
for img in images:
    print(f"- {img['Key']} ({img['Size']/1024:.1f} KB)")
EOF
```

### オプションB: サンプルデータをクリア
```bash
# 注意: 実行前に確認してください
# サンプルデータ（sample_*.jpg）のみを削除
curl -X POST "https://${OPENSEARCH_ENDPOINT}/file-index-v2-knn/_delete_by_query" \
  -H "Content-Type: application/json" \
  -d '{
    "query": {
      "wildcard": {
        "file_path": "/shared/images/sample_*"
      }
    }
  }'
```

## 🎉 結論

**現状**: 画像検索はサンプルデータ10件のみでテスト環境状態

**必要なアクション**:
1. ✅ バッチ処理スクリプトは準備済み（`scripts/batch-index-images.py`）
2. ⏳ AWS認証を更新して実行環境を準備
3. 🚀 小規模テスト後、本番実行

**推定作業時間**:
- 準備: 30分
- テスト: 1時間
- 10,000画像の処理: 1時間
- 検証: 30分

**合計**: 約3時間で基本的な画像検索が実用レベルに到達

---

## 次のステップ

```bash
# 1. このステータスを確認
cat IMAGE_INDEX_CURRENT_STATUS.md

# 2. 戦略ドキュメントを読む
cat IMAGE_INDEXING_STRATEGY.md

# 3. クイックスタートを実行
cat QUICKSTART_IMAGE_INDEXING.md
```