# OpenSearch統合インデックス移行 - エグゼクティブサマリー

## 現状の問題点

### データの分散
- **`cis-files`インデックス**: 実際のファイルデータ（15,000件以上）を含むが、k-NNベクトルフィールドなし
- **`file-index-v2-knn`インデックス**: k-NNベクトルフィールドはあるが、サンプルデータのみ

### システムの不整合
- **Lambda関数**: `file-index-v2-knn`を参照 → テキスト検索が失敗
- **EC2 Worker**: `cis-files`に書き込み → 画像検索が不可能

**結果**: テキスト検索と画像検索が同時に機能しない状態

---

## 提案ソリューション

### 統合インデックスアプローチ（ハイブリッド戦略）

1つの統合インデックス `cis-files-unified-v1` を作成し、以下の両方をサポート:
- テキスト全文検索（日本語対応）
- k-NN画像ベクトル検索（1024次元）

**主要な利点:**
- ✅ ダウンタイム最小（数秒のWorker再起動のみ）
- ✅ データ損失リスクゼロ
- ✅ 段階的移行により検証可能
- ✅ 簡単なロールバック
- ✅ 将来の拡張性

---

## 実装計画

### タイムライン

| フェーズ | 所要時間 | ダウンタイム | リスク |
|---------|---------|-------------|--------|
| 1. 統合インデックス作成 | 5分 | なし | 低 |
| 2. データマイグレーション | 30-60分 | なし | 低 |
| 3. 検証 | 10分 | なし | 低 |
| 4. EC2 Worker更新 | 5分 | 数秒 | 中 |
| 5. Lambda更新 | 5分 | なし | 低 |
| 6. 本番検証 | 10分 | なし | 低 |
| **合計** | **1-2時間** | **数秒** | **低** |

### 段階的実装

#### フェーズ1: インフラ準備（15分）
1. 新統合インデックス `cis-files-unified-v1` を作成
2. 既存データを新インデックスにコピー（Reindex API使用）
3. データ整合性を検証

#### フェーズ2: アプリケーション更新（20分）
1. EC2 Workerの環境変数を更新 → 新インデックスに書き込み
2. Lambda関数の環境変数を更新 → 新インデックスから読み取り
3. 動作確認（テキスト検索、画像検索）

#### フェーズ3: 画像ベクトル補完（バックグラウンド）
1. 既存の画像ファイルに対してベクトル生成
2. インデックスを段階的に更新
3. 進捗をモニタリング

#### フェーズ4: クリーンアップ（1週間後）
1. 新インデックスの安定稼働を確認
2. 旧インデックス（`cis-files`, `file-index-v2-knn`）を削除
3. エイリアス設定（オプション）

---

## 技術仕様

### 統合インデックスマッピング

```json
{
  "mappings": {
    "properties": {
      "file_name": {
        "type": "text",
        "analyzer": "japanese_analyzer",
        "fields": {"keyword": {"type": "keyword"}}
      },
      "file_path": {
        "type": "text",
        "analyzer": "japanese_analyzer"
      },
      "extracted_text": {
        "type": "text",
        "analyzer": "japanese_analyzer"
      },
      "image_embedding": {
        "type": "knn_vector",
        "dimension": 1024,
        "method": {
          "name": "hnsw",
          "space_type": "innerproduct",
          "engine": "nmslib",
          "parameters": {
            "ef_construction": 512,
            "m": 16
          }
        }
      },
      "has_image_embedding": {"type": "boolean"}
    }
  }
}
```

### ハイブリッド検索クエリ例

```json
{
  "query": {
    "bool": {
      "should": [
        {
          "multi_match": {
            "query": "契約書",
            "fields": ["file_name^3", "file_path^2", "extracted_text"]
          }
        },
        {
          "script_score": {
            "query": {"match_all": {}},
            "script": {
              "source": "knn_score",
              "lang": "knn",
              "params": {
                "field": "image_embedding",
                "query_value": [0.123, ...],
                "space_type": "innerproduct"
              }
            }
          }
        }
      ]
    }
  }
}
```

---

## 将来のファイル処理フロー

### 新規ファイルアップロード時

```
1. S3アップロード
   ↓
2. EC2 Worker処理
   - ファイルダウンロード
   - テキスト抽出（OCR含む）
   - OpenSearchインデックス投入（image_embedding=nullで初期化）
   ↓
3. Lambda（画像埋め込み生成）※画像ファイルの場合のみ
   - Bedrock Titan Embeddingsで1024次元ベクトル生成
   - OpenSearchの該当ドキュメントを部分更新（image_embeddingフィールド）
   ↓
4. 検索可能
   - テキスト検索: 即座に可能
   - 画像検索: ベクトル生成後に可能
```

**重要なポイント:**
- EC2 Workerはテキスト抽出とインデックス投入のみに集中
- 画像ベクトル生成は非同期（Lambda）で処理
- 各コンポーネントは独立して動作可能

---

## リスク管理

### リスクアセスメント

| リスク | 影響度 | 発生確率 | 対策 |
|-------|-------|---------|------|
| マイグレーション失敗 | 高 | 低 | Reindex APIは原子的操作、元データは保持 |
| Worker再起動時のメッセージロス | 中 | 低 | SQS visibility timeoutで再配信 |
| Lambda設定ミス | 中 | 低 | 環境変数変更のみ、即座にロールバック可 |
| ディスク容量不足 | 高 | 低 | 事前にクラスタ容量確認 |
| 検索パフォーマンス低下 | 中 | 低 | k-NNパラメータ最適化、モニタリング |

### ロールバック計画

**所要時間:** 5分以内

```bash
# 1. EC2 Worker環境変数をcis-filesに戻す
sudo sed -i 's/OPENSEARCH_INDEX=cis-files-unified-v1/OPENSEARCH_INDEX=cis-files/' /etc/environment
sudo systemctl restart file-processor.service

# 2. Lambda環境変数をcis-filesに戻す
aws lambda update-function-configuration \
  --function-name cis-search-api \
  --environment "Variables={OPENSEARCH_INDEX=cis-files}"

# 3. 動作確認
curl "${API_GATEWAY_URL}/search?q=test"
```

---

## モニタリングとアラート

### 監視メトリクス

1. **OpenSearch クラスタヘルス**
   - ステータス: green/yellow/red
   - アクティブシャード数
   - 未割り当てシャード数

2. **インデックスメトリクス**
   - ドキュメント数
   - ストレージサイズ
   - 検索レイテンシ
   - インデックス速度

3. **アプリケーションメトリクス**
   - EC2 Worker: 処理速度、エラー率
   - Lambda: 実行時間、エラー率
   - API: レスポンスタイム、成功率

### CloudWatchアラーム設定

```yaml
alarms:
  - name: OpenSearchClusterRed
    metric: ClusterStatus.red
    threshold: 1
    action: SNS通知

  - name: SearchLatencyHigh
    metric: SearchLatency
    threshold: 1000ms
    action: SNS通知

  - name: WorkerProcessingFailed
    metric: ProcessingErrorRate
    threshold: 10%
    action: SNS通知
```

---

## 成功基準

### 移行完了の判定基準

- ✅ すべてのドキュメントが新インデックスに存在（100%一致）
- ✅ テキスト検索が正常に動作（既存の検索結果と同等）
- ✅ 画像検索機能が有効（k-NNフィールド設定済み）
- ✅ インデックスステータスが `green`
- ✅ 検索レイテンシが許容範囲内（< 500ms）
- ✅ EC2 WorkerとLambdaがエラーなく稼働

### パフォーマンス目標

| 指標 | 目標値 | 現状 |
|-----|-------|-----|
| テキスト検索レスポンス | < 500ms | - |
| 画像検索レスポンス | < 1000ms | - |
| インデックス速度 | > 100 docs/sec | - |
| 検索成功率 | > 99.9% | - |
| システム可用性 | > 99.5% | - |

---

## 実装ファイル

### 提供スクリプト

1. **`create-unified-index.sh`**
   - 統合インデックスの作成
   - マッピング定義の適用
   - 作成確認

2. **`migrate-data-to-unified.sh`**
   - Reindex APIを使用したデータマイグレーション
   - 進捗監視
   - 完了確認

3. **`verify-unified-index.sh`**
   - インデックス統計確認
   - k-NNフィールド確認
   - テキスト検索テスト
   - ファイルタイプ分布確認
   - インデックス健全性チェック

4. **`MIGRATION_QUICKSTART.md`**
   - ステップバイステップの実行手順
   - トラブルシューティングガイド
   - ロールバック手順

### ドキュメント

1. **`OPENSEARCH_UNIFIED_INDEX_STRATEGY.md`**
   - 詳細な戦略説明
   - 技術仕様
   - 実装計画
   - リスクアセスメント

2. **`OPENSEARCH_MIGRATION_SUMMARY.md`** （本ドキュメント）
   - エグゼクティブサマリー
   - 全体像の把握

---

## 次のステップ

### 即座に実行可能

1. **スクリプトの確認**
   ```bash
   cd /path/to/cis_filesearch_app/scripts
   ls -la *.sh
   ```

2. **環境変数の設定**
   ```bash
   export OPENSEARCH_ENDPOINT="https://vpc-cis-filesearch-xxxxx.ap-northeast-1.es.amazonaws.com"
   export AWS_REGION="ap-northeast-1"
   ```

3. **EC2にSSH接続**
   ```bash
   ssh ec2-user@your-ec2-instance-ip
   ```

4. **移行開始**
   ```bash
   bash create-unified-index.sh
   ```

### 推奨実施タイミング

- **平日**: 火曜日〜木曜日（月曜・金曜を避ける）
- **時間帯**: 低トラフィック時間（例: 午前2時〜5時）
- **準備**: 事前に全スクリプトをレビュー
- **サポート**: エンジニアが即座に対応できる体制

---

## FAQ

### Q1: 移行中にシステムは使えますか？

**A:** はい。移行作業はバックグラウンドで行われ、検索機能は継続して利用可能です。Worker再起動時のみ数秒のダウンタイムがあります。

### Q2: データが失われるリスクはありますか？

**A:** ありません。元のインデックス（`cis-files`）はそのまま保持され、新インデックスにコピーするだけです。

### Q3: 移行失敗時のロールバックは簡単ですか？

**A:** はい。環境変数を元の値に戻すだけで、5分以内にロールバック可能です。

### Q4: 画像検索はいつから使えますか？

**A:** 移行直後からテキスト検索は使えます。画像検索は、バックフィル処理でベクトルを生成した画像から順次利用可能になります。

### Q5: 旧インデックスはいつ削除できますか？

**A:** 新インデックスが1週間以上安定稼働していることを確認してから削除することを推奨します。

---

## サポート連絡先

技術的な質問や問題が発生した場合:

- **プロジェクトリード**: [連絡先]
- **インフラチーム**: [連絡先]
- **緊急連絡**: [連絡先]

---

## まとめ

この移行により、CIS File Search Applicationは以下を実現します:

✅ **統一されたデータアーキテクチャ**: 1つのインデックスでテキストと画像の両方を検索
✅ **最小限のダウンタイム**: 数秒のWorker再起動のみ
✅ **安全な移行プロセス**: データ損失リスクゼロ、簡単なロールバック
✅ **将来の拡張性**: 新しい検索機能の追加が容易
✅ **運用の簡素化**: 管理対象インデックスの削減

**推定所要時間**: 1-2時間
**推定リスク**: 低
**推奨実施**: 低トラフィック時間帯

準備ができたら、`MIGRATION_QUICKSTART.md`の手順に従って移行を開始してください。

---

**作成日**: 2025-12-19
**バージョン**: 1.0
**ステータス**: レビュー待ち
