# DocuWorks + Bedrock Integration - Decision Tree & FAQ

## 実装判断フローチャート

```
START: DocuWorks SDK + Bedrock 統合
│
├─ Q1: DocuWorks商用ライセンスは購入済みですか?
│  ├─ YES → 次へ
│  └─ NO  → ライセンス購入を検討
│           └─ コスト: ~¥30,000-50,000/年
│
├─ Q2: どのワーカーをベースにしますか?
│  ├─ python-worker (推奨)
│  │  ├─ メリット:
│  │  │  ✓ DocuWorks処理が既に実装済み
│  │  │  ✓ 包括的なファイル処理パイプライン
│  │  │  ✓ テスト済みの構造
│  │  └─ 追加作業: Bedrockクライアント統合
│  │
│  └─ ec2-worker
│     ├─ メリット:
│     │  ✓ Bedrock統合が既に完了
│     └─ 追加作業: DocuWorks SDK実装が必要
│
├─ Q3: 画像ベクトル検索は必須ですか?
│  ├─ YES → Bedrock統合必須
│  │  ├─ モデル: amazon.titan-embed-image-v1
│  │  ├─ ベクトル次元: 1024
│  │  └─ コスト: ~$15-150/月 (使用量次第)
│  │
│  └─ NO  → DocuWorks SDKのみで開始
│           └─ 後でBedrock追加可能
│
├─ Q4: どの環境で運用しますか?
│  ├─ Windows EC2
│  │  ├─ DocuWorks SDK: ✓ サポート
│  │  ├─ インスタンス: Windows Server 2022
│  │  ├─ 最小スペック: t3.medium (4GB RAM)
│  │  └─ 推奨: この選択肢
│  │
│  └─ Linux EC2
│     ├─ DocuWorks SDK: ✗ サポートなし
│     └─ OCR fallbackのみ可能
│
├─ Q5: 同時処理数の要件は?
│  ├─ 1つずつ処理 (低負荷)
│  │  ├─ ライセンス: 1本で十分
│  │  ├─ インスタンス: t3.medium
│  │  └─ スループット: 50-100 DocuWorks files/hour
│  │
│  ├─ 2-4並列処理 (中負荷)
│  │  ├─ ライセンス: 2-4本必要
│  │  ├─ インスタンス: t3.xlarge or c5.2xlarge
│  │  └─ スループット: 200-400 files/hour
│  │
│  └─ 5+並列処理 (高負荷)
│     ├─ ライセンス: 5+本必要
│     ├─ インスタンス: 複数EC2 + Auto Scaling
│     └─ スループット: 400-800+ files/hour
│
└─ Q6: いつ開始しますか?
   ├─ 今すぐ開始
   │  └─ Go to: IMPLEMENTATION-QUICK-START.md
   │
   └─ 詳細を理解してから
      └─ Go to: DOCUWORKS-BEDROCK-INTEGRATION-GUIDE.md
```

---

## FAQ (よくある質問)

### ライセンスについて

**Q1: DocuWorksライセンスは何本必要ですか?**

A: 同時処理数に応じて決まります:
- 1本: 1ファイルずつ処理 (50-100 files/hour)
- 2-4本: 2-4ファイル同時処理 (200-400 files/hour)
- 5+本: Auto Scalingで大規模処理 (400+ files/hour)

現在1本購入済みなので、まずは1本で開始し、必要に応じて追加購入を検討してください。

**Q2: ライセンスはどこに保存しますか?**

A: AWS Secrets Managerに安全に保存します:
```bash
aws secretsmanager create-secret \
    --name cis-filesearch/docuworks-license \
    --secret-string '{"license_key": "YOUR-KEY"}'
```

**Q3: ライセンスの有効期限管理は?**

A: 自動化されています:
- CloudWatch Metricsで有効期限を追跡
- 30日前にSNS通知
- 更新スクリプト提供

---

### アーキテクチャについて

**Q4: なぜpython-workerをベースにするのですか?**

A: 以下の理由から推奨します:
1. DocuWorks処理が既に実装済み
2. 包括的なファイル処理パイプライン
3. テスト済みの構造
4. Bedrockクライアント追加が容易

**Q5: ec2-workerを使うべきケースは?**

A: 以下の場合はec2-workerをベースに:
- Bedrock統合が最優先
- DocuWorks処理は最小限でよい
- 既存のec2-workerに大きく依存している

ただし、ほとんどのケースでpython-workerが適しています。

**Q6: 両方のワーカーを同時に動かせますか?**

A: 可能ですが非推奨です:
- 管理が複雑化
- ライセンス管理が困難
- リソース効率が悪い

統合ワーカー(python-worker + Bedrock)を推奨します。

---

### Bedrock統合について

**Q7: Bedrockのコストは?**

A: 使用量ベースの課金:
```
画像ベクトル化:
- 1,000 images/day: ~$15/月
- 10,000 images/day: ~$150/月

テキストベクトル化:
- 1,000 texts/day: ~$5/月
- 10,000 texts/day: ~$50/月
```

詳細: https://aws.amazon.com/bedrock/pricing/

**Q8: どのBedrockモデルを使用しますか?**

A: Amazon Titan Multimodal Embeddings を推奨:
- モデルID: `amazon.titan-embed-image-v1`
- ベクトル次元: 1024
- 対応: 画像、テキスト、マルチモーダル
- リージョン: us-east-1 (推奨)

**Q9: Bedrockのレート制限は?**

A: リージョンとアカウントによりますが:
- デフォルト: 100 requests/second
- 必要に応じてService Quotas増加申請
- リトライロジック実装済み

---

### OpenSearch統合について

**Q10: OpenSearchでベクトル検索を使うには?**

A: k-NN pluginを有効化:
```json
{
  "settings": {
    "index.knn": true,
    "index.knn.algo_param.ef_search": 512
  },
  "mappings": {
    "properties": {
      "image_vector": {
        "type": "knn_vector",
        "dimension": 1024,
        "method": {
          "name": "hnsw",
          "space_type": "cosinesimil"
        }
      }
    }
  }
}
```

**Q11: テキスト検索とベクトル検索を組み合わせられますか?**

A: はい、Hybrid Searchを実装済み:
```python
results = opensearch_client.hybrid_search(
    text_query="検索キーワード",
    query_vector=query_vector,
    text_weight=0.5,  # テキスト検索の重み
    vector_weight=0.5  # ベクトル検索の重み
)
```

**Q12: OpenSearchのインスタンスサイズは?**

A: 処理量に応じて:
- 開発/テスト: t3.small.search
- 本番(低負荷): t3.medium.search (~$70/月)
- 本番(高負荷): r6g.large.search (~$150/月)

---

### パフォーマンスについて

**Q13: DocuWorksファイルの処理時間は?**

A: ファイルサイズとページ数に依存:
- 小(1-10ページ): 2-5秒
- 中(10-50ページ): 5-15秒
- 大(50-100ページ): 15-30秒

SDK使用時の方がOCRより2-3倍高速です。

**Q14: ベクトル化の処理時間は?**

A: Bedrockのレイテンシー:
- 画像: 200-500ms
- テキスト: 100-300ms

ネットワーク遅延含め、トータル1秒以内です。

**Q15: 1日あたりの処理可能ファイル数は?**

A: 構成により異なります:

```
単一インスタンス (1ライセンス):
- DocuWorks: 1,200-2,400 files/day
- 画像: 24,000-48,000 files/day

複数インスタンス (4ライセンス):
- DocuWorks: 4,800-9,600 files/day
- 画像: 96,000-192,000 files/day
```

---

### トラブルシューティング

**Q16: "Failed to initialize DocuWorks SDK"エラーが出ます**

A: 以下を確認:
1. DocuWorks SDKが正しくインストールされているか
   ```powershell
   Test-Path "C:\Program Files\Fuji Xerox\DocuWorks"
   ```

2. ライセンスキーが有効か
   - DocuWorks Deskを起動して確認

3. pywin32が正しくインストールされているか
   ```powershell
   pip install pywin32
   python .\venv\Scripts\pywin32_postinstall.py -install
   ```

**Q17: "Bedrock AccessDeniedException"エラーが出ます**

A: IAM権限を確認:
```bash
# EC2インスタンスロールにBedrock権限を追加
aws iam attach-role-policy \
    --role-name EC2-FileProcessor-Role \
    --policy-arn arn:aws:iam::aws:policy/AmazonBedrockFullAccess
```

**Q18: OpenSearchに接続できません**

A: 以下を確認:
1. VPCセキュリティグループ
   - EC2からOpenSearchへの443ポートが開いているか

2. IAMロール
   - OpenSearchアクセス権限があるか

3. エンドポイント設定
   - `.env`ファイルのエンドポイントURLが正しいか

**Q19: メモリ不足エラーが発生します**

A: 対策:
1. インスタンスサイズを増やす (t3.large など)
2. 並列処理数を減らす
   ```bash
   MAX_WORKERS=2  # デフォルト4から削減
   ```
3. ファイルサイズ制限を設定
   ```bash
   MAX_FILE_SIZE_MB=50
   DOCUWORKS_MAX_PAGES=500
   ```

---

### コストについて

**Q20: 月間コストの見積もりは?**

A: 構成例:

**低負荷 (1,000 DocuWorks files/day):**
```
EC2 (t3.medium):              $30/月
OpenSearch (t3.medium):       $70/月
Bedrock (1,000 images/day):   $15/月
その他 (S3, SQS, etc):        $10/月
────────────────────────────
合計:                         ~$125/月
```

**高負荷 (10,000 DocuWorks files/day):**
```
EC2 (t3.large):                $60/月
OpenSearch (r6g.large):        $150/月
Bedrock (10,000 images/day):   $150/月
その他:                        $20/月
────────────────────────────
合計:                          ~$380/月
```

**Q21: コスト削減のヒントは?**

A: 以下を検討:
1. **EC2 Spot Instances** (最大70%削減)
2. **Reserved Instances** (1年契約で40%削減)
3. **OpenSearch UltraWarm** (古いデータを低コストストレージへ)
4. **Bedrockバッチ処理** (不要な重複処理を避ける)
5. **S3 Intelligent-Tiering** (アクセス頻度に応じた自動階層化)

---

### セキュリティについて

**Q22: ライセンスキーはどう保護されますか?**

A: 多層防御:
1. **保存:** AWS Secrets Manager (KMS暗号化)
2. **アクセス:** IAMロールベース (最小権限原則)
3. **監査:** CloudTrail (すべてのアクセスをログ)
4. **ローテーション:** 年次更新プロセス

**Q23: ファイルデータの暗号化は?**

A: 全段階で暗号化:
1. **転送中:** TLS/SSL (S3, OpenSearch)
2. **保存時:**
   - S3: SSE-S3 または SSE-KMS
   - EBS: KMS暗号化
   - OpenSearch: 保存時暗号化有効

**Q24: VPCセキュリティのベストプラクティスは?**

A: 推奨構成:
```
┌─────────────────────────────────────┐
│  VPC (10.0.0.0/16)                  │
│                                     │
│  ┌───────────────────────────┐    │
│  │  Private Subnet           │    │
│  │  - EC2 Worker             │    │
│  │  - OpenSearch             │    │
│  └───────────────────────────┘    │
│                                     │
│  VPC Endpoints:                    │
│  - S3                              │
│  - SQS                              │
│  - Secrets Manager                  │
│  - Bedrock                          │
└─────────────────────────────────────┘
```

インターネット直接アクセス不要。

---

### 運用について

**Q25: 監視はどうすればよいですか?**

A: CloudWatch統合:
- **メトリクス:**
  - 処理ファイル数
  - 処理時間
  - エラー率
  - ライセンス使用状況

- **アラーム:**
  - エラー率 > 10%
  - ライセンス有効期限 < 30日
  - ライセンス使用率 > 90%

- **ダッシュボード:** 提供済み

**Q26: ログはどこで確認できますか?**

A: 複数の場所:
1. **ローカル:** `C:\logs\worker-stdout.log`
2. **CloudWatch Logs:** `/aws/ec2/file-processor`
3. **S3 (長期保存):** ライフサイクルポリシーで自動移動

```bash
# CloudWatch Logsの確認
aws logs tail /aws/ec2/file-processor --follow
```

**Q27: バックアップ戦略は?**

A: 多層バックアップ:
1. **OpenSearch:**
   - 自動スナップショット (毎日)
   - S3に保存 (30日保持)

2. **S3:**
   - バージョニング有効
   - クロスリージョンレプリケーション (オプション)

3. **設定:**
   - Secrets Manager自動バックアップ
   - EC2 AMI定期作成

---

### スケーリングについて

**Q28: いつスケールアップすべきですか?**

A: 以下のサインが出たら:
1. SQSキューが常に詰まっている (Depth > 1000)
2. 処理時間が長くなっている (>30秒/file)
3. ライセンス使用率 > 80%

スケーリングオプション:
- **Vertical:** より大きなインスタンス
- **Horizontal:** 複数インスタンス + Auto Scaling

**Q29: Auto Scalingの設定は?**

A: 提供予定 (Phase 2):
```yaml
AutoScaling:
  MinSize: 1
  MaxSize: 4
  TargetMetric: SQS Queue Depth
  ScaleUp: Queue > 100
  ScaleDown: Queue < 10
```

**Q30: Dockerコンテナ化は可能ですか?**

A: Windowsコンテナで可能ですが非推奨:
- DocuWorks SDKのWindows依存性
- ライセンス管理の複雑化
- デバッグの難しさ

EC2インスタンスでの直接実行を推奨します。

---

## 実装チェックリスト

### 事前準備

- [ ] AWSアカウント準備
- [ ] DocuWorks商用ライセンス購入
- [ ] Windows Server 2022 EC2インスタンス起動
- [ ] 必要なAWSサービス (S3, SQS, OpenSearch) 作成
- [ ] IAMロール設定

### インストール

- [ ] Python 3.11+ インストール
- [ ] Git インストール
- [ ] Tesseract OCR インストール
- [ ] DocuWorks SDK インストール
- [ ] リポジトリクローン
- [ ] Python仮想環境作成
- [ ] 依存関係インストール
- [ ] pywin32インストール

### 設定

- [ ] AWS Secrets Managerにライセンス保存
- [ ] `.env`ファイル作成
- [ ] OpenSearchインデックス作成
- [ ] IAM権限確認

### テスト

- [ ] 設定検証 (`--validate-only`)
- [ ] OpenSearchインデックス作成確認
- [ ] サンプルファイルでテスト実行
- [ ] ログ確認
- [ ] ベクトル検索テスト

### 本番化

- [ ] Windowsサービス化
- [ ] CloudWatch監視設定
- [ ] アラーム設定
- [ ] バックアップ設定
- [ ] ドキュメント作成

---

## 推奨実装パス

### Path A: 最速実装 (1週間)

```
Day 1-2: 環境構築
  - EC2セットアップ
  - DocuWorks SDK インストール
  - Python環境構築

Day 3-4: 統合コード実装
  - Bedrockクライアント追加
  - License Manager実装
  - OpenSearch拡張

Day 5: テスト
  - ユニットテスト
  - 統合テスト

Day 6-7: デプロイと検証
  - 本番デプロイ
  - 監視設定
  - 最終確認
```

### Path B: 安定実装 (5週間)

```
Week 1: 準備
Week 2: コード統合
Week 3: OpenSearch拡張
Week 4: テストと最適化
Week 5: 本番デプロイ
```

詳細: `DOCUWORKS-BEDROCK-INTEGRATION-GUIDE.md`

---

## サポートリソース

### ドキュメント

1. **メインガイド** (推奨)
   - ファイル: `DOCUWORKS-BEDROCK-INTEGRATION-GUIDE.md`
   - 用途: 詳細な技術仕様と実装

2. **クイックスタート**
   - ファイル: `IMPLEMENTATION-QUICK-START.md`
   - 用途: 即座に開始

3. **ライセンス管理**
   - ファイル: `LICENSE-MANAGEMENT-STRATEGY.md`
   - 用途: ライセンス運用

4. **このドキュメント**
   - ファイル: `INTEGRATION-DECISION-TREE.md`
   - 用途: 意思決定とFAQ

### 外部リソース

- **DocuWorks:** https://www.fujixerox.co.jp/product/software/docuworks/
- **AWS Bedrock:** https://docs.aws.amazon.com/bedrock/
- **OpenSearch k-NN:** https://opensearch.org/docs/latest/search-plugins/knn/

### コミュニティ

- AWS Forums: https://forums.aws.amazon.com/
- Stack Overflow: Tag `aws-bedrock`, `opensearch`, `docuworks`

---

**Document Version:** 1.0
**Last Updated:** 2025-12-02
**For:** Quick reference and decision making
