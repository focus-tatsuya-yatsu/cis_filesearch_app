# パフォーマンス最適化 - クイックウィン集

## 5分で実装できる最適化 (最大効果)

### 1. Lambda Memory最適化 (推定改善: 30%)

```bash
# 現在のメモリサイズ確認
aws lambda get-function-configuration \
  --function-name cis-search-api \
  --query 'MemorySize' \
  --output text

# メモリを1024MBに変更
aws lambda update-function-configuration \
  --function-name cis-search-api \
  --memory-size 1024 \
  --timeout 15 \
  --region ap-northeast-1

# 確認
aws lambda get-function-configuration \
  --function-name cis-search-api \
  --query '[MemorySize,Timeout]' \
  --output table
```

**期待効果:**
- レスポンスタイム: -30%
- Cold Start: -25%
- コスト: +10% (実行時間短縮で相殺)

---

### 2. Next.js console.log削除 (推定改善: 5-10%)

```javascript
// next.config.js に追加
module.exports = {
  // ... 既存設定

  compiler: {
    removeConsole: process.env.NODE_ENV === 'production'
      ? { exclude: ['error', 'warn'] }
      : false,
  },
};
```

```bash
# 再ビルド
cd frontend
yarn build
```

**期待効果:**
- Bundle Size: -5%
- 初期ロード: -3%

---

### 3. API Gatewayキャッシュ有効化 (推定改善: 70%)

```bash
# キャッシュ有効化 (AWS Console)
# 1. API Gateway > Stages > prod
# 2. Settings タブ
# 3. Cache Settings:
#    - Enable API cache: Yes
#    - Cache capacity: 0.5 GB
#    - Cache time-to-live (TTL): 300 seconds

# または CLI
aws apigateway update-stage \
  --rest-api-id <YOUR_API_ID> \
  --stage-name prod \
  --patch-operations \
    op=replace,path=/cacheClusterEnabled,value=true \
    op=replace,path=/cacheClusterSize,value=0.5
```

**期待効果:**
- キャッシュヒット時レスポンス: 10-20ms
- Lambda呼び出し: -70%
- コスト: -50%

---

## 15分で実装できる最適化

### 4. Lambda環境変数最適化

```bash
aws lambda update-function-configuration \
  --function-name cis-search-api \
  --environment "Variables={
    OPENSEARCH_ENDPOINT=<YOUR_ENDPOINT>,
    OPENSEARCH_INDEX=file-index,
    AWS_REGION=ap-northeast-1,
    NODE_ENV=production,
    NODE_OPTIONS=--max-old-space-size=896,
    ENABLE_PERFORMANCE_MONITORING=true
  }" \
  --region ap-northeast-1
```

**期待効果:**
- メモリ使用効率: +15%
- GC停止時間: -20%

---

### 5. OpenSearch タイムアウト最適化

```typescript
// src/services/opensearch.service.ts
export async function getOpenSearchClient(): Promise<Client> {
  // ... 既存コード

  opensearchClient = new Client({
    // ... 既存設定

    requestTimeout: 15000, // 30000 → 15000 に変更
    pingTimeout: 3000,     // 追加
    maxRetries: 2,         // 3 → 2 に変更
  });

  // ... 既存コード
}
```

**期待効果:**
- タイムアウトエラー: -40%
- 平均レスポンス: -10%

---

## 30分で実装できる最適化

### 6. Webpack Externals設定

```javascript
// backend/lambda-search-api/webpack.config.js

module.exports = {
  // ... 既存設定

  externals: {
    // AWS SDK v3を外部化
    '@aws-sdk/client-opensearch': 'commonjs2 @aws-sdk/client-opensearch',
    '@aws-sdk/client-cloudwatch': 'commonjs2 @aws-sdk/client-cloudwatch',
    '@aws-sdk/credential-provider-node': 'commonjs2 @aws-sdk/credential-provider-node',
    'aws-sdk': 'commonjs2 aws-sdk',
  },

  optimization: {
    minimize: true,
    usedExports: true,
  },
};
```

```bash
# 再ビルド & デプロイ
cd backend/lambda-search-api
npm run build
npm run package
aws lambda update-function-code \
  --function-name cis-search-api \
  --zip-file fileb://lambda-deployment.zip
```

**期待効果:**
- Bundle Size: -70% (10MB → 3MB)
- Cold Start: -40%

---

### 7. フロントエンド Dynamic Import

```typescript
// Before
import { VirtualizedSearchResults } from '@/components/search/VirtualizedSearchResults';

// After - 動的インポート
import dynamic from 'next/dynamic';

const VirtualizedSearchResults = dynamic(
  () => import('@/components/search/VirtualizedSearchResults').then(
    mod => ({ default: mod.VirtualizedSearchResults })
  ),
  {
    loading: () => <div>Loading...</div>,
    ssr: false, // クライアントサイドのみで使用
  }
);
```

**期待効果:**
- 初期Bundle Size: -15%
- 初期ロード時間: -20%

---

### 8. Response Compression

```typescript
// src/app/api/search/route.ts に追加
import { gzip } from 'zlib';
import { promisify } from 'util';

const compress = promisify(gzip);

export async function GET(request: NextRequest) {
  // ... 検索処理

  const response = {
    success: true,
    data: { /* ... */ },
  };

  const acceptEncoding = request.headers.get('accept-encoding') || '';

  // gzip圧縮サポートチェック
  if (acceptEncoding.includes('gzip')) {
    const compressed = await compress(JSON.stringify(response));

    return new NextResponse(compressed, {
      headers: {
        'Content-Type': 'application/json',
        'Content-Encoding': 'gzip',
        'Cache-Control': 'private, max-age=300',
      },
    });
  }

  return NextResponse.json(response);
}
```

**期待効果:**
- レスポンスサイズ: -75%
- 転送時間: -70%

---

## 検証コマンド集

### Lambda パフォーマンス確認

```bash
# 直近100件の実行時間を確認
aws logs filter-log-events \
  --log-group-name /aws/lambda/cis-search-api \
  --filter-pattern "REPORT" \
  --max-items 100 \
  | jq -r '.events[].message' \
  | grep "Duration" \
  | awk '{print $3}' \
  | awk '{sum+=$1; count++} END {print "Avg:", sum/count, "ms"}'
```

### API Gateway パフォーマンス確認

```bash
# キャッシュヒット率
aws cloudwatch get-metric-statistics \
  --namespace AWS/ApiGateway \
  --metric-name CacheHitCount \
  --dimensions Name=ApiName,Value=cis-search-api \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 3600 \
  --statistics Sum
```

### Next.js Bundle Size確認

```bash
cd frontend

# ビルド
yarn build

# チャンクサイズ確認
ls -lh .next/static/chunks/ | sort -k5 -hr | head -10

# 合計サイズ
du -sh .next/static/chunks/
```

### OpenSearch クエリ時間確認

```bash
# CloudWatch Logsから検索
aws logs filter-log-events \
  --log-group-name /aws/lambda/cis-search-api \
  --filter-pattern "took" \
  --max-items 100 \
  | jq -r '.events[].message' \
  | grep "took" \
  | jq '.took' \
  | awk '{sum+=$1; count++} END {print "Avg:", sum/count, "ms"}'
```

---

## パフォーマンス改善チェックリスト

### 即座に実施可能 (5分)
- [ ] Lambda メモリを1024MBに変更
- [ ] Lambda タイムアウトを15秒に変更
- [ ] Next.js console.log削除設定

### 短時間で実施可能 (15分)
- [ ] Lambda 環境変数最適化
- [ ] API Gateway キャッシュ有効化
- [ ] OpenSearch タイムアウト短縮

### 要テスト (30分)
- [ ] Webpack externals設定
- [ ] Dynamic Import導入
- [ ] Response Compression実装

### 継続的な監視
- [ ] CloudWatch Dashboardセットアップ
- [ ] アラート設定
- [ ] 週次パフォーマンスレビュー

---

## トラブルシューティング: よくある問題

### 問題: Lambda Cold Startが遅い

**診断:**
```bash
# Bundle Sizeを確認
ls -lh backend/lambda-search-api/dist/

# 期待値: < 3MB
```

**解決策:**
```bash
# webpack.config.jsのexternals設定を確認
# 不要な依存関係を除外
```

---

### 問題: API Gatewayキャッシュが効かない

**診断:**
```bash
# CORSプリフライトリクエスト確認
curl -i -X OPTIONS https://your-api/search

# キャッシュ設定確認
aws apigateway get-stage \
  --rest-api-id <API_ID> \
  --stage-name prod
```

**解決策:**
- Method Settingsでcache_key_parametersを設定
- リクエストにクエリパラメータが含まれているか確認

---

### 問題: フロントエンドの初期ロードが遅い

**診断:**
```bash
# Lighthouseスコア確認
npx lighthouse http://localhost:3000/search \
  --only-categories=performance \
  --output=json \
  | jq '.categories.performance.score * 100'
```

**解決策:**
1. Dynamic Import導入
2. 画像最適化有効化
3. 不要なパッケージ削除

---

## 効果測定: Before/After比較

### 測定方法

```bash
# Before測定
for i in {1..10}; do
  curl -w "@curl-format.txt" -o /dev/null -s \
    "https://your-api/search?q=test&page=1&limit=20"
done | awk '{sum+=$1; count++} END {print "Avg:", sum/count, "ms"}'

# curl-format.txt
time_total: %{time_total}s\n
```

### 期待値

**Before:**
- P50: 300ms
- P95: 800ms
- Cold Start: 1000ms

**After (全最適化適用):**
- P50: **120ms** (60%改善) ✅
- P95: **350ms** (56%改善) ✅
- Cold Start: **500ms** (50%改善) ✅

---

## まとめ: 優先度付き実装順序

### 最優先 (今すぐ実施)
1. Lambda メモリ最適化 (5分, 30%改善)
2. API Gateway キャッシュ (5分, 70%改善)
3. Next.js console削除 (5分, 5%改善)

### 高優先 (今週中に実施)
4. Webpack externals (30分, 40%改善)
5. OpenSearch タイムアウト (15分, 10%改善)
6. Response Compression (30分, 70%転送改善)

### 中優先 (来週実施)
7. Dynamic Import (30分, 20%初期ロード改善)
8. Lambda環境変数 (15分, 15%改善)

### 継続的改善
9. パフォーマンスモニタリング
10. 定期的なロードテスト
11. ユーザーフィードバック収集

---

**総合期待効果:**
- **レスポンスタイム**: 60%改善
- **コスト**: 30%削減
- **ユーザー体験**: 大幅改善

このクイックウィン集を実装することで、最小の労力で最大の効果を得られます。
