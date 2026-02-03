# nas_path空パターン分析レポート

**分析日**: 2026-01-28
**Lambda関数**: `cis-filesearch-analyze-nas-path`
**OpenSearchインデックス**: `cis-files`

## 1. 全体サマリー

| 項目 | 件数 | 割合 |
|------|------|------|
| **総ドキュメント数** | 881,990 | 100% |
| **nas_pathあり** | 258,407 | 29.3% |
| **nas_pathなし（または空）** | 623,583 | **70.7%** |

**重要**: 全体の約70%のドキュメントに`nas_path`フィールドが設定されていません。

## 2. サーバー別分析

| サーバー | nas_pathあり | nas_pathなし | nas_pathなし率 | 備考 |
|----------|-------------|--------------|----------------|------|
| **ts-server3** | 93,223 | 89,108 | **48.87%** | 比較的良好 |
| **ts-server5** | 138,356 | 507,419 | **78.58%** | 最も問題が大きい |
| **ts-server6** | 838 | 1,272 | **60.28%** | 中程度の問題 |
| **ts-server7** | 0 | 248 | **100%** | 完全に欠損 |

### 分析結果

1. **ts-server5が最大の問題源**
   - 507,419件（全体の約58%）がnas_pathなし
   - サーバー内の78.58%がnas_path欠損
   - 対策優先度: **最高**

2. **ts-server7は完全欠損**
   - 248件全てがnas_pathなし
   - 何らかのスキャン設定の問題の可能性
   - 対策優先度: **高**（件数は少ないが100%欠損）

3. **ts-server3は比較的良好**
   - 約半数（48.87%）にnas_pathあり
   - 最も正常に近い状態

## 3. 時系列分析

| 期間 | nas_pathあり | nas_pathなし |
|------|-------------|--------------|
| 2024年以前 | 0 | 0 |
| 2024年 | 0 | 0 |
| **2025年** | 258,407 | 623,576 |

**結論**: 全てのファイルが2025年にインデックスされています。これは最近のバルクインデックス処理の結果と考えられます。

## 4. サンプルデータ分析

### nas_pathが正常に設定されている例

```
ファイル名: 47_乗入れ部標準図.SFC
file_path: s3://cis-filesearch-s3-landing/documents/road/ts-server3/trashbox/H31_JOB/...
nas_path: \\ts-server3\share\trashbox\H31_JOB\...
indexed_at: 2025-12-10T06:42:31
```

### nas_pathが設定されていない例

```
ファイル名: CIMG0133.JPG
file_path: s3://cis-filesearch-s3-landing/documents/road/ts-server3/H28_JOB/...
nas_path: (なし)
indexed_at: 2025-12-10T06:42:34
```

**重要な発見**:
- 同じts-server3の同じ時間帯にインデックスされたファイルでも、nas_pathがある場合とない場合が混在
- これはバッチ処理中のランダムな問題ではなく、何らかのパターンがある可能性

## 5. 原因の仮説

### 仮説1: file-scannerのバグまたは設定問題
- nas_pathを生成するロジックに問題がある可能性
- ts-server5とts-server7で特に問題が発生

### 仮説2: DataSync同期のタイミング問題
- S3へのアップロード時にnas_pathメタデータが失われている可能性

### 仮説3: OpenSearchインデックス時の問題
- マッピングまたはインデックス処理でnas_pathが欠落

## 6. 推奨対策

### 即座の対策

1. **file-scannerコードの確認**
   - nas_path生成ロジックの検証
   - サーバー別の処理の違いを確認

2. **ts-server7の設定確認**
   - DataSync設定の確認
   - NASマウント設定の確認

### 中期的対策

1. **再インデックス処理**
   - nas_pathが欠損しているドキュメントの特定
   - S3メタデータからnas_pathを再生成
   - OpenSearchドキュメントの更新

2. **モニタリング強化**
   - 新規インデックス時のnas_path設定率を監視
   - アラート設定

### 長期的対策

1. **インデックス処理の改善**
   - nas_pathの必須フィールド化
   - バリデーション追加

## 7. 技術詳細

### 使用したOpenSearchクエリ

```json
// nas_pathが存在し、空でないドキュメントのカウント
{
  "query": {
    "bool": {
      "must": [{ "exists": { "field": "nas_path" } }],
      "must_not": [{ "term": { "nas_path.keyword": "" } }]
    }
  }
}

// nas_pathが存在しないまたは空のドキュメントのカウント
{
  "query": {
    "bool": {
      "should": [
        { "bool": { "must_not": [{ "exists": { "field": "nas_path" } }] } },
        { "term": { "nas_path.keyword": "" } }
      ],
      "minimum_should_match": 1
    }
  }
}

// サーバー別のカウント
{
  "query": {
    "match_phrase": { "file_path": "ts-server5" }
  }
}
```

### Lambda関数の場所

```
backend/lambda-analyze-nas-path/
├── src/
│   └── index.ts    # 分析ロジック
├── package.json
├── tsconfig.json
└── deploy.sh       # デプロイスクリプト
```

### 実行方法

```bash
# Lambda関数の呼び出し
aws lambda invoke \
  --function-name cis-filesearch-analyze-nas-path \
  --region ap-northeast-1 \
  /tmp/result.json

# 結果の確認
cat /tmp/result.json | python3 -m json.tool
```
