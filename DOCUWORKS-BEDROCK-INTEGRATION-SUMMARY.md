# DocuWorks SDK + AWS Bedrock Integration - Summary

## プロジェクト概要

クライアントが購入したDocuWorks商用ライセンス(1本)とAWS Bedrockの画像ベクトル検索機能を統合し、本番環境で稼働可能な最適なアーキテクチャを実現します。

**現状:**
- python-worker: DocuWorks dual-mode実装 (SDK + OCR fallback) 済み
- ec2-worker: Bedrock統合 (画像ベクトル化) 済み
- 商用ライセンス: 1本購入済み
- 要件: 画像ベクトル検索は必須

**目標:**
統合された単一ワーカーシステムで、DocuWorks SDK処理とBedrock画像ベクトル検索の両方をサポート

---

## ドキュメント構成

本統合プロジェクトのドキュメントは以下の3つで構成されています:

### 1. メインガイド
**ファイル:** `/docs/deployment/DOCUWORKS-BEDROCK-INTEGRATION-GUIDE.md`

**内容:**
- アーキテクチャ設計 (統合ワーカー)
- DocuWorks SDK integration best practices
- Bedrock統合戦略
- OpenSearch k-NN vector search設定
- 詳細な実装コード
- テスト戦略
- 監視・運用ガイド

**対象者:** 開発者、アーキテクト

### 2. クイックスタートガイド
**ファイル:** `/docs/deployment/IMPLEMENTATION-QUICK-START.md`

**内容:**
- 5ステップでの環境構築手順
- 最短30分での起動
- トラブルシューティング
- パフォーマンス最適化
- コスト見積もり

**対象者:** インフラエンジニア、運用担当者

### 3. ライセンス管理戦略
**ファイル:** `/docs/deployment/LICENSE-MANAGEMENT-STRATEGY.md`

**内容:**
- AWS Secrets Managerでの安全なライセンス管理
- License Manager実装
- 同時実行制限の実装
- 監視・アラート設定
- ライセンス更新プロセス
- スケーリング戦略

**対象者:** 運用担当者、プロジェクトマネージャー

---

## 推奨アーキテクチャ: Unified Python Worker

### アーキテクチャ図

```
┌───────────────────────────────────────────────────────────────┐
│                  Unified Python Worker                         │
│              (python-worker-unified)                           │
│                                                                │
│  ┌─────────────────────────────────────────────────────┐     │
│  │  File Processing Pipeline                           │     │
│  ├─────────────────────────────────────────────────────┤     │
│  │                                                       │     │
│  │  1. Download from S3                                 │     │
│  │  2. Route to appropriate processor                   │     │
│  │  3. Process file (DocuWorks SDK or other)           │     │
│  │  4. Generate vector embedding (Bedrock)             │     │
│  │  5. Index to OpenSearch (text + vector)             │     │
│  │  6. Upload thumbnail to S3                          │     │
│  │                                                       │     │
│  └─────────────────────────────────────────────────────┘     │
│                                                                │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────────┐    │
│  │  DocuWorks   │  │   Bedrock    │  │   OpenSearch    │    │
│  │  Processor   │  │   Client     │  │    Client       │    │
│  ├──────────────┤  ├──────────────┤  ├─────────────────┤    │
│  │ • SDK mode   │  │ • Image vec  │  │ • Text search   │    │
│  │ • OCR mode   │  │ • Text vec   │  │ • Vector search │    │
│  │ • Fallback   │  │ • Multimodal │  │ • Hybrid search │    │
│  └──────────────┘  └──────────────┘  └─────────────────┘    │
└───────────────────────────────────────────────────────────────┘
                              │
                              ▼
        ┌─────────────────────────────────────────────┐
        │    AWS OpenSearch Service                    │
        │  ┌───────────────┐  ┌────────────────────┐ │
        │  │  Full-Text    │  │  k-NN Vector       │ │
        │  │  Search Index │  │  Index (1024-dim)  │ │
        │  └───────────────┘  └────────────────────┘ │
        └─────────────────────────────────────────────┘
```

### 主要コンポーネント

1. **DocuWorks SDK Processor**
   - 商用SDKによる高精度テキスト抽出
   - 画像抽出機能
   - OCRフォールバック

2. **Bedrock Client**
   - Amazon Titan Multimodal Embeddings
   - 1024次元ベクトル生成
   - 画像・テキスト・マルチモーダル対応

3. **OpenSearch Client (Enhanced)**
   - k-NN vector search
   - Hybrid search (text + vector)
   - 日本語アナライザー

4. **License Manager**
   - AWS Secrets Manager連携
   - 同時実行制限
   - ライセンス有効期限管理

---

## 実装の利点

### 1. アーキテクチャの利点

**単一ワーカープロセス:**
- 管理の簡素化
- リソース効率化
- デプロイメントが容易

**モジュラー設計:**
- 各プロセッサーが独立
- 機能追加が容易
- テストが簡単

**柔軟な処理:**
- DocuWorks: SDK優先、OCR fallback
- 画像: ベクトル化
- テキスト: ベクトル化

### 2. コスト最適化

```
月間コスト見積もり (東京リージョン):

EC2 (t3.medium, 24/7):           ~$30/月
EBS (100GB gp3):                 ~$8/月
OpenSearch (t3.medium.search):   ~$70/月
Bedrock (画像ベクトル化):
  - 1,000 images/day:            ~$15/月
  - 10,000 images/day:           ~$150/月
S3 Storage:                      ~$5/月
SQS:                             ~$1/月
CloudWatch:                      ~$5/月

合計 (低負荷):                   ~$134/月
合計 (高負荷):                   ~$269/月

DocuWorksライセンス:             ~¥30,000-50,000/年
```

### 3. パフォーマンス

**処理能力:**
- DocuWorksファイル: 50-100 files/hour (SDK mode)
- 画像ベクトル化: 1,000-2,000 images/hour
- 全文検索レスポンス: <100ms
- ベクトル検索レスポンス: <200ms

**スケーラビリティ:**
- 現在: 1ライセンス、1インスタンス
- 将来: 複数ライセンス、Auto Scaling対応可能

---

## 実装手順 (概要)

### Phase 1: 環境準備 (Week 1)

1. Windows Server 2022 EC2インスタンスのセットアップ
2. DocuWorks SDKのインストール
3. AWS Secrets Managerでライセンス管理
4. 開発環境の構築

### Phase 2: コード統合 (Week 2)

1. ec2-workerからBedrock clientを統合
2. DocuWorks processorをSDK対応に拡張
3. License Managerサービスの実装
4. 設定管理の更新

### Phase 3: OpenSearch拡張 (Week 3)

1. k-NN vector supportの追加
2. Vector searchメソッドの実装
3. Hybrid search機能
4. インデックスマッピング更新

### Phase 4: テストと最適化 (Week 4)

1. ユニットテスト
2. 統合テスト
3. パフォーマンステスト
4. E2Eテスト

### Phase 5: デプロイ (Week 5)

1. 本番環境へのデプロイ
2. 監視・アラート設定
3. ドキュメント作成
4. 運用チームトレーニング

---

## Quick Start (最短手順)

### 必要なもの

- AWS アカウント
- DocuWorks 商用ライセンス (購入済み)
- Windows Server 2022 EC2 インスタンス
- 基本的なAWSサービス (S3, SQS, OpenSearch) が構成済み

### 5ステップで起動

```powershell
# Step 1: EC2セットアップ (30分)
# Python, Git, Tesseractのインストール

# Step 2: DocuWorks SDK インストール (15分)
# 商用版をインストール、ライセンスキー登録

# Step 3: ライセンス設定 (10分)
aws secretsmanager create-secret --name cis-filesearch/docuworks-license ...

# Step 4: ワーカーインストール (20分)
cd C:\cis-filesearch-app\backend\python-worker
python -m venv venv
.\venv\Scripts\activate
pip install -r requirements.txt
pip install pywin32

# Step 5: 起動 (5分)
python worker.py --validate-only
python worker.py --create-index
python worker.py
```

詳細は `/docs/deployment/IMPLEMENTATION-QUICK-START.md` を参照してください。

---

## 主要機能

### 1. DocuWorks SDK Integration

**機能:**
- ネイティブテキスト抽出 (.xdw/.xbd)
- 高精度メタデータ抽出
- ページごとの画像抽出
- OCR fallback (SDK失敗時)

**実装:**
```python
# DocuWorks COM interface
import win32com.client

dw_app = win32com.client.Dispatch("DocuWorks.DeskApp")
doc = dw_app.Documents.Open(file_path)

# Extract text
text = doc.Pages.Item(1).GetText()

# Extract metadata
metadata = {
    'title': doc.Title,
    'author': doc.Author,
    'page_count': doc.Pages.Count
}
```

### 2. Bedrock Image Vectorization

**機能:**
- Amazon Titan Multimodal Embeddings
- 1024次元ベクトル生成
- 画像・テキスト・マルチモーダル対応

**実装:**
```python
# Image vectorization
bedrock_client = BedrockClient(config)
vector = bedrock_client.generate_image_embedding(image_path)

# Text vectorization
vector = bedrock_client.generate_text_embedding(text)

# Multimodal
vector = bedrock_client.generate_multimodal_embedding(image_path, text)
```

### 3. OpenSearch k-NN Vector Search

**機能:**
- k-NN近傍検索
- コサイン類似度
- Hybrid search (text + vector)

**実装:**
```python
# Vector search
results = opensearch_client.vector_search(
    query_vector=query_vector,
    k=10
)

# Hybrid search
results = opensearch_client.hybrid_search(
    text_query="検索キーワード",
    query_vector=query_vector,
    text_weight=0.5,
    vector_weight=0.5
)
```

### 4. License Management

**機能:**
- AWS Secrets Manager連携
- 同時実行制限 (1ライセンス = 1並列)
- 有効期限管理
- 自動アラート

**実装:**
```python
# License acquisition
license_manager = get_license_manager()

if license_manager.acquire_license():
    try:
        # Process with SDK
        result = process_with_sdk(file_path)
    finally:
        license_manager.release_license()
```

---

## 監視・運用

### CloudWatch Metrics

- `FileProcessed`: 処理済みファイル数
- `ProcessingTime`: 処理時間
- `BedrockCalls`: Bedrock API呼び出し数
- `DocuWorksProcessed`: DocuWorks処理数
- `LicenseActiveInstances`: アクティブライセンス数
- `LicenseDaysUntilExpiry`: ライセンス有効期限

### CloudWatch Alarms

1. **ライセンス有効期限アラート** (30日前)
2. **ライセンス容量アラート** (使用率90%以上)
3. **処理エラー率アラート** (10%以上)
4. **Bedrockスロットリングアラート**

### ダッシュボード

- 処理統計
- Bedrockメトリクス
- ライセンス使用状況
- システムヘルス

---

## セキュリティ

### ライセンスキー管理

1. **保存:** AWS Secrets Manager (暗号化)
2. **アクセス:** IAMロールベース
3. **監査:** CloudTrailログ
4. **ローテーション:** 年次更新プロセス

### データ保護

1. **転送中:** TLS/SSL
2. **保存時:** S3暗号化、EBS暗号化
3. **アクセス制御:** IAMポリシー
4. **ネットワーク:** VPC、セキュリティグループ

---

## トラブルシューティング

### よくある問題

1. **DocuWorks SDK初期化失敗**
   - SDKインストール確認
   - ライセンス有効性確認
   - COM登録確認

2. **Bedrock API エラー**
   - IAM権限確認
   - リージョン設定確認
   - レート制限確認

3. **OpenSearch 接続エラー**
   - VPCセキュリティグループ確認
   - IAMロール確認
   - エンドポイント設定確認

4. **メモリ不足**
   - インスタンスタイプ確認
   - 並列処理数調整
   - ファイルサイズ制限設定

詳細は各ドキュメントのトラブルシューティングセクションを参照してください。

---

## スケーリング戦略

### 現在の構成 (1ライセンス)

```
単一EC2インスタンス
- DocuWorks: 50-100 files/hour
- 画像ベクトル化: 1,000-2,000 images/hour
```

### 将来のスケーリング

**Option 1: Vertical Scaling (2-4ライセンス)**
```
より大きなEC2インスタンス
- 複数ライセンスで並列処理
- 200-400 DocuWorks files/hour
- インスタンスタイプ: t3.xlarge or c5.2xlarge
```

**Option 2: Horizontal Scaling (5+ライセンス)**
```
複数EC2インスタンス
- Auto Scaling
- 分散ライセンス管理 (DynamoDB)
- 400-800+ DocuWorks files/hour
```

---

## 次のステップ

### 即座に開始

1. **環境構築**
   ```bash
   # クイックスタートガイドに従って環境構築
   docs/deployment/IMPLEMENTATION-QUICK-START.md
   ```

2. **テストファイルで検証**
   ```bash
   # サンプルファイルをアップロード
   aws s3 cp sample.xdw s3://your-bucket/test/
   ```

3. **動作確認**
   ```bash
   # ログ確認
   Get-Content C:\logs\worker-stdout.log -Tail 100

   # OpenSearch検索テスト
   curl -XGET "https://opensearch-endpoint/file-index/_search"
   ```

### 本番環境への移行

1. **Auto Scaling設定**
2. **Multi-AZ構成**
3. **バックアップ戦略**
4. **モニタリングダッシュボード**
5. **運用手順書作成**

---

## リソース

### ドキュメント

- メインガイド: `/docs/deployment/DOCUWORKS-BEDROCK-INTEGRATION-GUIDE.md`
- クイックスタート: `/docs/deployment/IMPLEMENTATION-QUICK-START.md`
- ライセンス管理: `/docs/deployment/LICENSE-MANAGEMENT-STRATEGY.md`

### 外部リソース

- [DocuWorks Development Kit](https://www.fujixerox.co.jp/product/software/docuworks/)
- [AWS Bedrock Documentation](https://docs.aws.amazon.com/bedrock/)
- [OpenSearch k-NN Plugin](https://opensearch.org/docs/latest/search-plugins/knn/)
- [Python COM Programming](https://docs.microsoft.com/en-us/windows/win32/com/)

### サポート

- AWS サポート: https://console.aws.amazon.com/support/
- DocuWorks サポート: https://www.fujixerox.co.jp/support/
- プロジェクト Issue: GitHub Issues

---

## まとめ

### 提供した成果物

1. **包括的な統合ガイド** (70ページ相当)
   - アーキテクチャ設計
   - 実装コード例
   - ベストプラクティス

2. **即座に使えるクイックスタートガイド**
   - 最短30分で環境構築
   - ステップバイステップ手順
   - トラブルシューティング

3. **ライセンス管理戦略**
   - 安全な管理方法
   - 完全な実装コード
   - 監視・アラート設定

### ベストプラクティス実現

✅ **DocuWorks SDK Integration**
- 商用ライセンスの適切な管理
- SDK優先、OCR fallback
- 画像抽出とベクトル化

✅ **Bedrock Integration**
- 画像・テキストベクトル化
- OpenSearch k-NN検索
- ハイブリッド検索機能

✅ **Production-Ready**
- 包括的なエラーハンドリング
- メトリクス・監視
- スケーラブルなアーキテクチャ

✅ **License Management**
- AWS Secrets Manager連携
- 同時実行制限
- 自動アラート

### 実装スケジュール

- **Week 1:** 環境セットアップ
- **Week 2:** コード統合
- **Week 3:** OpenSearch拡張
- **Week 4:** テスト
- **Week 5:** デプロイ

**合計: 5週間で本番環境稼働**

---

**Document Version:** 1.0
**Created:** 2025-12-02
**Status:** Ready for Implementation
**Next Action:** 環境構築開始 (IMPLEMENTATION-QUICK-START.md を参照)
