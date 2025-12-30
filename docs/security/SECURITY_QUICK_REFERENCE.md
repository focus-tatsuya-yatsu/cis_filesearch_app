# セキュリティクイックリファレンス

## 📚 概要

このガイドは、CIS File Search Applicationのセキュリティ実装に関するクイックリファレンスです。開発者が日常的に参照できるよう、重要なセキュリティプラクティスをまとめています。

---

## 🔒 認証・認可

### JWT認証の実装

```typescript
import { requireAuth, extractAuthFromRequest } from '@/lib/security/auth';
import { NextRequest } from 'next/server';

// 認証必須のAPI
export async function POST(request: NextRequest) {
  try {
    // ✅ 認証チェック
    const userId = await requireAuth(request);

    // 認証済みユーザーのみ処理を続行
    // ...
  } catch (error) {
    return createAuthErrorResponse('Unauthorized', origin);
  }
}

// 認証オプショナルのAPI
export async function GET(request: NextRequest) {
  const { authenticated, userId } = await extractAuthFromRequest(request);

  if (authenticated) {
    // 認証済みユーザー向けの処理
  } else {
    // 未認証ユーザー向けの処理
  }
}
```

### 環境変数設定

```bash
# .env.production
JWT_SECRET=your-256-bit-secret-key-here
ALLOWED_ORIGINS=https://cis-filesearch.example.com,https://app.cis-filesearch.example.com
```

---

## 🚦 レート制限

### 基本的な実装

```typescript
import { rateLimiters, RateLimitError } from '@/lib/security/rate-limit';
import { getClientIP } from '@/lib/security/auth';
import { createRateLimitErrorResponse } from '@/lib/security/error-handler';

export async function POST(request: NextRequest) {
  const ip = getClientIP(request);
  const origin = request.headers.get('origin');

  try {
    // ✅ IP制限チェック（10リクエスト/分）
    await rateLimiters.ip.check(ip, 10);

    // 処理を続行
    // ...
  } catch (error) {
    if (error instanceof RateLimitError) {
      return createRateLimitErrorResponse(error.limit, error.reset, origin);
    }
    throw error;
  }
}
```

### レート制限の種類

| 制限タイプ | リクエスト数 | 時間窓 | 用途 |
|-----------|------------|--------|------|
| `rateLimiters.ip` | 10 | 1分 | 未認証ユーザー |
| `rateLimiters.user` | 50 | 1分 | 認証済みユーザー |
| `rateLimiters.global` | 100 | 1分 | 全体の負荷制限 |
| `rateLimiters.imageUpload` | 5 | 1分 | 画像アップロード |

---

## 🛡️ 入力検証

### 画像ファイルの検証

```typescript
import {
  verifyImageMagicNumber,
  sanitizeFileName,
  validateEmbeddingVector,
} from '@/lib/security/input-validation';

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const imageFile = formData.get('image') as File;

  // ✅ 1. ファイルサイズ検証
  if (imageFile.size > 5 * 1024 * 1024) {
    return createValidationErrorResponse(
      'File size must be less than 5MB',
      'FILE_TOO_LARGE',
      origin
    );
  }

  // ✅ 2. MIMEタイプ検証
  const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg'];
  if (!allowedTypes.includes(imageFile.type)) {
    return createValidationErrorResponse(
      'Only JPEG and PNG images are supported',
      'INVALID_MIME_TYPE',
      origin
    );
  }

  // ✅ 3. ファイル名のサニタイズ
  const sanitizedFileName = sanitizeFileName(imageFile.name);

  // ✅ 4. マジックナンバー検証
  const arrayBuffer = await imageFile.arrayBuffer();
  const imageBuffer = Buffer.from(arrayBuffer);

  const magicNumberCheck = await verifyImageMagicNumber(imageBuffer);
  if (!magicNumberCheck.valid) {
    return createValidationErrorResponse(
      'File content does not match image format',
      'INVALID_FILE_CONTENT',
      origin
    );
  }

  // ✅ 5. MIMEタイプとマジックナンバーの一致確認
  if (
    (imageFile.type === 'image/jpeg' && magicNumberCheck.type !== 'image/jpeg') ||
    (imageFile.type === 'image/png' && magicNumberCheck.type !== 'image/png')
  ) {
    return createValidationErrorResponse(
      'File type mismatch detected',
      'FILE_TYPE_MISMATCH',
      origin
    );
  }

  // 処理を続行
  // ...
}
```

### 検索クエリの検証

```typescript
import {
  sanitizeSearchQuery,
  validateSearchMode,
  validateSortBy,
  validateSortOrder,
  validateFileType,
  validateDate,
  validatePagination,
} from '@/lib/security/input-validation';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  // ✅ クエリパラメータのサニタイズとバリデーション
  const query = sanitizeSearchQuery(searchParams.get('q') || '');
  const searchMode = validateSearchMode(searchParams.get('searchMode') || 'or');
  const sortBy = validateSortBy(searchParams.get('sortBy') || 'relevance');
  const sortOrder = validateSortOrder(searchParams.get('sortOrder') || 'desc');
  const fileType = validateFileType(searchParams.get('fileType') || 'all');
  const dateFrom = validateDate(searchParams.get('dateFrom') || '');
  const dateTo = validateDate(searchParams.get('dateTo') || '');

  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '20');
  const { page: safePage, limit: safeLimit } = validatePagination(page, limit);

  // 処理を続行
  // ...
}
```

---

## 🔐 CORS設定

### 基本的な実装

```typescript
import {
  isOriginAllowed,
  createCorsResponse,
  createOptionsResponse,
  createOriginErrorResponse,
} from '@/lib/security/cors';

export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin');

  // ✅ オリジン検証
  if (origin && !isOriginAllowed(origin)) {
    return createOriginErrorResponse(origin);
  }

  try {
    // 処理を実行
    const result = await processRequest();

    // ✅ CORS対応レスポンス
    return createCorsResponse({ success: true, data: result }, 200, origin);
  } catch (error) {
    return createSecureErrorResponse(error, origin);
  }
}

// ✅ OPTIONSハンドラー（プリフライト）
export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get('origin');
  return createOptionsResponse(origin);
}
```

### 環境変数設定

```bash
# .env.production
ALLOWED_ORIGINS=https://cis-filesearch.example.com,https://app.cis-filesearch.example.com
```

---

## 🚨 エラーハンドリング

### セキュアなエラーレスポンス

```typescript
import { createSecureErrorResponse } from '@/lib/security/error-handler';

export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin');

  try {
    // 処理を実行
    // ...
  } catch (error) {
    // ✅ セキュアなエラーレスポンス
    // 本番環境では詳細を隠蔽、開発環境では詳細を表示
    return createSecureErrorResponse(error, origin);
  }
}
```

### エラーレスポンスの例

**開発環境**:
```json
{
  "error": "Authentication failed",
  "code": "AUTHENTICATION_ERROR",
  "errorId": "ERR-1702901234567-ABC123",
  "timestamp": "2025-12-18T10:20:30.000Z",
  "details": {
    "message": "Could not load credentials from any providers",
    "name": "CredentialsProviderError",
    "code": "CredentialsProviderError"
  }
}
```

**本番環境**:
```json
{
  "error": "Authentication failed",
  "code": "AUTHENTICATION_ERROR",
  "errorId": "ERR-1702901234567-ABC123",
  "timestamp": "2025-12-18T10:20:30.000Z"
}
```

---

## 📝 監査ログ

### 基本的な実装

```typescript
import {
  logSuccess,
  logFailure,
  logImageUpload,
  logSearchQuery,
  logSecurityEvent,
} from '@/lib/security/audit-logger';
import { getClientIP, getUserAgent } from '@/lib/security/auth';

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  const ip = getClientIP(request);
  const userAgent = getUserAgent(request);
  const { userId } = await extractAuthFromRequest(request);

  try {
    // 処理を実行
    const result = await processImageUpload();

    // ✅ 成功ログ
    await logImageUpload({
      userId,
      ipAddress: ip,
      userAgent,
      fileSize: result.fileSize,
      fileType: result.fileType,
      cached: result.cached,
      processingTime: Date.now() - startTime,
    });

    return createCorsResponse({ success: true, data: result }, 200, origin);
  } catch (error) {
    // ✅ 失敗ログ
    await logFailure({
      eventType: 'IMAGE_EMBEDDING_REQUEST',
      userId,
      ipAddress: ip,
      userAgent,
      resource: '/api/image-embedding',
      action: 'POST',
      errorCode: error.code || 'INTERNAL_ERROR',
      errorMessage: error.message,
      processingTime: Date.now() - startTime,
    });

    return createSecureErrorResponse(error, origin);
  }
}
```

### セキュリティイベントログ

```typescript
// 疑わしいアクティビティを検出した場合
await logSecurityEvent({
  eventType: 'SUSPICIOUS_ACTIVITY',
  userId,
  ipAddress: ip,
  userAgent,
  resource: '/api/image-embedding',
  severity: 'high',
  description: 'Multiple failed authentication attempts from the same IP',
  details: {
    failedAttempts: 10,
    timeWindow: '5 minutes',
  },
});
```

---

## 🔄 完全な実装例

### セキュア画像アップロードAPI

```typescript
import { NextRequest } from 'next/server';
import { requireAuth, getClientIP, getUserAgent } from '@/lib/security/auth';
import { rateLimiters, RateLimitError } from '@/lib/security/rate-limit';
import {
  verifyImageMagicNumber,
  sanitizeFileName,
  validateEmbeddingVector,
} from '@/lib/security/input-validation';
import {
  isOriginAllowed,
  createCorsResponse,
  createOptionsResponse,
  createOriginErrorResponse,
} from '@/lib/security/cors';
import {
  createSecureErrorResponse,
  createRateLimitErrorResponse,
  createValidationErrorResponse,
  createAuthErrorResponse,
} from '@/lib/security/error-handler';
import { logImageUpload, logFailure } from '@/lib/security/audit-logger';

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  const origin = request.headers.get('origin');
  const ip = getClientIP(request);
  const userAgent = getUserAgent(request);

  // ✅ 1. オリジン検証
  if (origin && !isOriginAllowed(origin)) {
    return createOriginErrorResponse(origin);
  }

  try {
    // ✅ 2. 認証チェック
    const userId = await requireAuth(request);

    // ✅ 3. IP制限チェック
    try {
      await rateLimiters.ip.check(ip, 10);
    } catch (error) {
      if (error instanceof RateLimitError) {
        return createRateLimitErrorResponse(error.limit, error.reset, origin);
      }
      throw error;
    }

    // ✅ 4. ユーザー制限チェック
    try {
      await rateLimiters.user.check(userId, 50);
    } catch (error) {
      if (error instanceof RateLimitError) {
        return createRateLimitErrorResponse(error.limit, error.reset, origin);
      }
      throw error;
    }

    // ✅ 5. 画像アップロード制限チェック
    try {
      await rateLimiters.imageUpload.check(userId, 5);
    } catch (error) {
      if (error instanceof RateLimitError) {
        return createRateLimitErrorResponse(error.limit, error.reset, origin);
      }
      throw error;
    }

    // ✅ 6. ファイルの取得
    const formData = await request.formData();
    const imageFile = formData.get('image') as File;

    if (!imageFile) {
      return createValidationErrorResponse(
        'Image file is required',
        'MISSING_IMAGE',
        origin
      );
    }

    // ✅ 7. ファイルサイズ検証
    if (imageFile.size > 5 * 1024 * 1024) {
      return createValidationErrorResponse(
        'File size must be less than 5MB',
        'FILE_TOO_LARGE',
        origin
      );
    }

    // ✅ 8. MIMEタイプ検証
    const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg'];
    if (!allowedTypes.includes(imageFile.type)) {
      return createValidationErrorResponse(
        'Only JPEG and PNG images are supported',
        'INVALID_MIME_TYPE',
        origin
      );
    }

    // ✅ 9. ファイル名のサニタイズ
    const sanitizedFileName = sanitizeFileName(imageFile.name);

    // ✅ 10. マジックナンバー検証
    const arrayBuffer = await imageFile.arrayBuffer();
    const imageBuffer = Buffer.from(arrayBuffer);

    const magicNumberCheck = await verifyImageMagicNumber(imageBuffer);
    if (!magicNumberCheck.valid) {
      return createValidationErrorResponse(
        'File content does not match image format',
        'INVALID_FILE_CONTENT',
        origin
      );
    }

    // ✅ 11. MIMEタイプとマジックナンバーの一致確認
    if (
      (imageFile.type === 'image/jpeg' && magicNumberCheck.type !== 'image/jpeg') ||
      (imageFile.type === 'image/png' && magicNumberCheck.type !== 'image/png')
    ) {
      return createValidationErrorResponse(
        'File type mismatch detected',
        'FILE_TYPE_MISMATCH',
        origin
      );
    }

    // ✅ 12. 画像処理（Bedrock API呼び出し）
    const embedding = await generateImageEmbedding(imageBuffer);

    // ✅ 13. ベクトルの検証
    const vectorValidation = validateEmbeddingVector(embedding);
    if (!vectorValidation.valid) {
      return createValidationErrorResponse(
        'Invalid embedding generated',
        'INVALID_EMBEDDING',
        origin
      );
    }

    // ✅ 14. 成功ログ
    await logImageUpload({
      userId,
      ipAddress: ip,
      userAgent,
      fileSize: imageFile.size,
      fileType: imageFile.type,
      cached: false,
      processingTime: Date.now() - startTime,
    });

    // ✅ 15. レスポンス返却
    return createCorsResponse(
      {
        success: true,
        data: {
          embedding,
          dimensions: embedding.length,
          fileName: sanitizedFileName,
          fileSize: imageFile.size,
          fileType: imageFile.type,
        },
      },
      200,
      origin
    );
  } catch (error) {
    // ✅ 失敗ログ
    await logFailure({
      eventType: 'IMAGE_EMBEDDING_REQUEST',
      userId: undefined,
      ipAddress: ip,
      userAgent,
      resource: '/api/image-embedding',
      action: 'POST',
      errorCode: (error as any).code || 'INTERNAL_ERROR',
      errorMessage: (error as any).message,
      processingTime: Date.now() - startTime,
    });

    return createSecureErrorResponse(error, origin);
  }
}

// ✅ OPTIONSハンドラー（プリフライト）
export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get('origin');
  return createOptionsResponse(origin);
}
```

---

## 🧪 テストコマンド

### セキュリティテスト

```bash
# 依存関係の脆弱性スキャン
npm audit

# 高度な脆弱性スキャン
npm audit fix

# Snykを使用した脆弱性スキャン
npx snyk test

# ESLintセキュリティプラグイン
npm run lint
```

---

## 📋 チェックリスト

### APIエンドポイント作成時のチェックリスト

- [ ] JWT認証の実装（必要な場合）
- [ ] レート制限の実装
- [ ] オリジン検証（CORS）
- [ ] 入力検証（サニタイズ、ホワイトリスト）
- [ ] エラーハンドリング（本番環境で詳細を隠蔽）
- [ ] 監査ログの記録
- [ ] OPTIONSハンドラーの実装
- [ ] セキュリティヘッダーの設定
- [ ] 単体テストの作成

---

## 🔗 関連ドキュメント

- [セキュリティ監査レポート](./IMAGE_SEARCH_SECURITY_AUDIT.md)
- [OWASP Top 10 2021](https://owasp.org/Top10/)
- [AWS セキュリティベストプラクティス](https://aws.amazon.com/security/best-practices/)
- [Next.js セキュリティ](https://nextjs.org/docs/advanced-features/security-headers)

---

**最終更新日**: 2025-12-18
**バージョン**: 1.0
