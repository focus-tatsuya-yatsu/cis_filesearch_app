# S3プレビューAPI クイックスタートガイド

## 目次

1. [環境設定](#環境設定)
2. [依存関係のインストール](#依存関係のインストール)
3. [基本的な使用方法](#基本的な使用方法)
4. [トラブルシューティング](#トラブルシューティング)

---

## 環境設定

### 1. OpenSearchエラーの修正

`.env.local`ファイルに以下の環境変数を追加してください：

```bash
# OpenSearch Configuration
OPENSEARCH_ENDPOINT=https://search-cis-filesearch-xxxxx.ap-northeast-1.es.amazonaws.com
OPENSEARCH_INDEX=file-index

# AWS Configuration
AWS_REGION=ap-northeast-1

# S3 Configuration
S3_BUCKET=cis-filesearch-storage
S3_PROCESSED_PREFIX=processed/
S3_THUMBNAIL_PREFIX=thumbnails/
```

**注意:**
- `OPENSEARCH_ENDPOINT`は実際のOpenSearchドメインのエンドポイントに置き換えてください
- AWS Consoleから取得: OpenSearch Service → Domain → Endpoint

### 2. AWS認証情報（ローカル開発のみ）

ローカル開発環境で実行する場合、AWS認証情報を設定してください：

**方法1: 環境変数**
```bash
export AWS_ACCESS_KEY_ID=your-access-key
export AWS_SECRET_ACCESS_KEY=your-secret-key
export AWS_REGION=ap-northeast-1
```

**方法2: AWS CLI認証情報**
```bash
aws configure
```

**本番環境:**
EC2インスタンスのIAMロールを使用するため、認証情報の設定は不要です。

---

## 依存関係のインストール

### パッケージのインストール

```bash
cd frontend
yarn install
```

新しく追加されたパッケージ：
- `@aws-sdk/client-s3`: S3操作用SDK
- `@aws-sdk/s3-request-presigner`: Presigned URL生成

既存のパッケージが最新版に更新されます。

---

## 基本的な使用方法

### 1. 単一ファイルのプレビュー

```typescript
import { getPreviewUrl } from '@/services/preview-service';

// PDFファイルのプレビューURL取得
const response = await getPreviewUrl(
  'cis-filesearch-storage',  // バケット名
  'processed/document.pdf',   // S3キー
  'pdf',                      // ファイルタイプ
  1,                          // ページ番号（オプション）
  300                         // 有効期限（秒）
);

console.log('Preview URL:', response.data.previewUrl);
console.log('Expires at:', response.data.expiresAt);

// URLをiframeで表示
<iframe src={response.data.previewUrl} />
```

### 2. PDFの全ページプレビュー

```typescript
import { getPdfPages } from '@/services/preview-service';

const response = await getPdfPages(
  'cis-filesearch-storage',
  'processed/document.pdf',
  1,                          // 開始ページ（オプション）
  10,                         // 終了ページ（オプション）
  ['検索', 'キーワード']       // ハイライトキーワード（オプション）
);

response.data.pages.forEach(page => {
  console.log(`Page ${page.pageNumber}:`, page.previewUrl);
  console.log('Has keywords:', page.hasKeywords);
});
```

### 3. キーワードハイライト情報取得

```typescript
import { getKeywordHighlights } from '@/services/preview-service';

const response = await getKeywordHighlights(
  'cis-filesearch-storage',
  'processed/document.pdf',
  ['検索', 'ワード']
);

response.data.pages.forEach(page => {
  console.log(`\nPage ${page.pageNumber} - ${page.matchCount} matches:`);

  page.snippets.forEach(snippet => {
    console.log(`  "${snippet.text}"`);
    console.log(`  Keyword: ${snippet.keyword}`);
    if (snippet.position) {
      console.log(`  Position: (${snippet.position.x}, ${snippet.position.y})`);
    }
  });
});
```

### 4. Reactコンポーネントの使用

```tsx
import { PdfPreview } from '@/components/features/PdfPreview';

export default function DocumentViewerPage() {
  return (
    <div className="h-screen">
      <PdfPreview
        bucket="cis-filesearch-storage"
        s3Key="processed/document.pdf"
        keywords={['検索', 'キーワード']}
        initialPage={1}
        className="h-full"
      />
    </div>
  );
}
```

---

## APIエンドポイント

### 1. `/api/preview` - 単一ファイルプレビュー

```bash
curl "http://localhost:3000/api/preview?bucket=cis-filesearch-storage&key=processed/document.pdf&fileType=pdf&pageNumber=1"
```

レスポンス:
```json
{
  "success": true,
  "data": {
    "previewUrl": "https://cis-filesearch-storage.s3.amazonaws.com/...",
    "expiresAt": "2025-12-16T10:30:00Z",
    "expiresIn": 300,
    "metadata": {
      "totalPages": 10,
      "fileName": "document.pdf",
      "fileSize": 1024000
    }
  }
}
```

### 2. `/api/preview/pages` - PDFページ一覧

```bash
curl "http://localhost:3000/api/preview/pages?bucket=cis-filesearch-storage&key=processed/document.pdf&startPage=1&endPage=5&keywords=検索,ワード"
```

### 3. `/api/preview/keywords` - キーワードハイライト

```bash
curl "http://localhost:3000/api/preview/keywords?bucket=cis-filesearch-storage&key=processed/document.pdf&keywords=検索,ワード"
```

---

## トラブルシューティング

### エラー: "OpenSearch service is not configured"

**原因:** `.env.local`に`OPENSEARCH_ENDPOINT`が設定されていない

**解決策:**
1. `.env.local`に以下を追加:
   ```bash
   OPENSEARCH_ENDPOINT=https://search-cis-filesearch-xxxxx.ap-northeast-1.es.amazonaws.com
   OPENSEARCH_INDEX=file-index
   ```

2. 開発サーバーを再起動:
   ```bash
   yarn dev
   ```

### エラー: "Access denied to S3 resource"

**原因:** AWS認証情報が正しく設定されていない、またはIAM権限が不足している

**解決策:**

1. **ローカル開発:**
   ```bash
   aws configure
   # または
   export AWS_ACCESS_KEY_ID=...
   export AWS_SECRET_ACCESS_KEY=...
   ```

2. **IAMポリシー確認:**
   ```json
   {
     "Effect": "Allow",
     "Action": [
       "s3:GetObject",
       "s3:ListBucket"
     ],
     "Resource": [
       "arn:aws:s3:::cis-filesearch-storage/*",
       "arn:aws:s3:::cis-filesearch-storage"
     ]
   }
   ```

### エラー: "File not found in S3"

**原因:** 指定されたS3オブジェクトが存在しない

**解決策:**

1. **S3オブジェクトの確認:**
   ```bash
   aws s3 ls s3://cis-filesearch-storage/processed/
   ```

2. **正しいキーを使用:**
   ```typescript
   // ❌ 間違い
   getPreviewUrl('bucket', 'document.pdf', 'pdf');

   // ✅ 正しい（プレフィックス付き）
   getPreviewUrl('bucket', 'processed/document.pdf', 'pdf');
   ```

### エラー: "Text extraction data not found"

**原因:** PDFファイルが処理されていない、またはテキスト抽出ファイルが生成されていない

**解決策:**

バックエンドのファイル処理システムで、以下のファイルが生成されていることを確認：

```
processed/
├── document.pdf                    # 元のPDF
├── document.pdf.metadata.json      # メタデータ
└── document.pdf.text.json          # テキスト抽出結果
```

テキスト抽出ファイルが存在しない場合、バックエンドワーカーでファイルを再処理してください。

### エラー: "Rate limit exceeded"

**原因:** API呼び出しレート制限を超えた

**解決策:**

1. **キャッシュを使用:**
   ```typescript
   import { previewUrlCache } from '@/services/preview-service';

   const url = await previewUrlCache.getUrl(
     'bucket',
     'key',
     'pdf',
     1
   );
   ```

2. **リクエスト頻度を下げる:**
   必要な場合のみAPIを呼び出し、結果をキャッシュする

### パフォーマンスが遅い

**解決策:**

1. **ページ範囲を制限:**
   ```typescript
   // ❌ 全ページ（100ページ）を一度に取得
   await getPdfPages('bucket', 'key');

   // ✅ 必要なページのみ取得
   await getPdfPages('bucket', 'key', 1, 10);
   ```

2. **CloudFrontを使用:**
   S3の前にCloudFrontを配置して、静的コンテンツをキャッシュ

3. **サムネイルを使用:**
   ```typescript
   // サムネイルキーを使用（より高速）
   const thumbnailKey = key.replace('processed/', 'thumbnails/');
   ```

---

## 開発ワークフロー

### 1. 開発サーバー起動

```bash
cd frontend
yarn dev
```

ブラウザで `http://localhost:3000` を開く

### 2. APIテスト

```bash
# プレビューAPI
curl "http://localhost:3000/api/preview?bucket=cis-filesearch-storage&key=processed/test.pdf&fileType=pdf"

# ページAPI
curl "http://localhost:3000/api/preview/pages?bucket=cis-filesearch-storage&key=processed/test.pdf"

# キーワードAPI
curl "http://localhost:3000/api/preview/keywords?bucket=cis-filesearch-storage&key=processed/test.pdf&keywords=test"
```

### 3. コンポーネントのテスト

テストページを作成:

```tsx
// src/app/test-preview/page.tsx
import { PdfPreview } from '@/components/features/PdfPreview';

export default function TestPreviewPage() {
  return (
    <div className="h-screen p-4">
      <h1 className="text-2xl font-bold mb-4">PDFプレビューテスト</h1>
      <PdfPreview
        bucket="cis-filesearch-storage"
        s3Key="processed/test.pdf"
        keywords={['test', 'preview']}
        initialPage={1}
        className="h-full border rounded"
      />
    </div>
  );
}
```

ブラウザで `http://localhost:3000/test-preview` を開いて確認

---

## 次のステップ

1. **認証の統合:**
   - Cognitoなどの認証システムと統合
   - ミドルウェアでAPIルートを保護

2. **本番デプロイ:**
   - EC2またはLambdaにデプロイ
   - CloudFrontでCDNを設定
   - 環境変数を本番環境に設定

3. **機能拡張:**
   - 画像ファイルのプレビュー
   - DocuWorksファイルのサポート
   - アノテーション機能

詳細は [S3プレビューAPI設計ガイド](./s3-preview-api-guide.md) を参照してください。

---

## サポート

問題が解決しない場合は、以下を確認してください：

1. `.env.local`の設定が正しいか
2. AWS認証情報が有効か
3. IAMロールに必要な権限があるか
4. S3オブジェクトが存在するか
5. OpenSearchサービスが稼働しているか

それでも解決しない場合は、開発チームに問い合わせてください。
