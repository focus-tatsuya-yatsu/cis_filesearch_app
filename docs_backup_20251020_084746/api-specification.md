# CIS ファイル検索システム API仕様書

## 1. API概要

### 1.1 基本情報

- **ベースURL**: `https://api.cis-filesearch.com/v1`
- **プロトコル**: HTTPS
- **データ形式**: JSON
- **文字コード**: UTF-8
- **認証方式**: Bearer Token (JWT)

### 1.2 共通ヘッダー

```http
Content-Type: application/json
Authorization: Bearer {jwt_token}
X-Request-ID: {request_id}
Accept-Language: ja
```

### 1.3 レスポンス形式

#### 成功レスポンス

```json
{
  "success": true,
  "data": {
    // レスポンスデータ
  },
  "meta": {
    "timestamp": "2025-01-15T10:00:00Z",
    "request_id": "req_abc123"
  }
}
```

#### エラーレスポンス

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "エラーメッセージ",
    "details": {}
  },
  "meta": {
    "timestamp": "2025-01-15T10:00:00Z",
    "request_id": "req_abc123"
  }
}
```

### 1.4 HTTPステータスコード

| コード | 説明 |
|--------|------|
| 200 | 成功 |
| 201 | 作成成功 |
| 400 | リクエスト不正 |
| 401 | 認証エラー |
| 403 | 権限なし |
| 404 | リソースが見つからない |
| 429 | レート制限超過 |
| 500 | サーバーエラー |

## 2. 認証API

### 2.1 ログイン

**POST** `/auth/login`

#### リクエスト

```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

#### レスポンス

```json
{
  "success": true,
  "data": {
    "access_token": "eyJhbGciOiJIUzI1NiIs...",
    "refresh_token": "eyJhbGciOiJIUzI1NiIs...",
    "expires_in": 3600,
    "token_type": "Bearer",
    "user": {
      "id": "user_123",
      "email": "user@example.com",
      "name": "山田太郎",
      "role": "user",
      "department": "営業部"
    }
  }
}
```

### 2.2 トークンリフレッシュ

**POST** `/auth/refresh`

#### リクエスト

```json
{
  "refresh_token": "eyJhbGciOiJIUzI1NiIs..."
}
```

#### レスポンス

```json
{
  "success": true,
  "data": {
    "access_token": "eyJhbGciOiJIUzI1NiIs...",
    "expires_in": 3600
  }
}
```

### 2.3 ログアウト

**POST** `/auth/logout`

#### リクエスト

```json
{
  "refresh_token": "eyJhbGciOiJIUzI1NiIs..."
}
```

#### レスポンス

```json
{
  "success": true,
  "data": {
    "message": "ログアウトしました"
  }
}
```

### 2.4 ユーザー情報取得

**GET** `/auth/me`

#### レスポンス

```json
{
  "success": true,
  "data": {
    "id": "user_123",
    "email": "user@example.com",
    "name": "山田太郎",
    "role": "user",
    "department": "営業部",
    "permissions": [
      "search:read",
      "file:download"
    ],
    "last_login": "2025-01-15T09:00:00Z"
  }
}
```

## 3. 検索API

### 3.1 基本検索

**GET** `/search`

#### クエリパラメータ

| パラメータ | 型 | 必須 | 説明 |
|-----------|-----|------|------|
| q | string | ○ | 検索クエリ |
| page | integer | - | ページ番号（デフォルト: 1） |
| limit | integer | - | 件数（デフォルト: 20、最大: 100） |
| sort | string | - | ソート順（relevance, date_desc, date_asc, name_asc, name_desc） |

#### レスポンス

```json
{
  "success": true,
  "data": {
    "results": [
      {
        "id": "file_001",
        "name": "営業報告書_2025Q1.pdf",
        "path": "/documents/sales/2025/Q1/営業報告書_2025Q1.pdf",
        "type": "pdf",
        "size": 2048576,
        "created_at": "2025-01-10T10:00:00Z",
        "modified_at": "2025-01-14T15:30:00Z",
        "highlight": {
          "content": "...検索キーワードが<mark>ハイライト</mark>されたテキスト..."
        },
        "score": 0.95
      }
    ],
    "total": 150,
    "page": 1,
    "limit": 20,
    "total_pages": 8,
    "query": "営業報告",
    "took_ms": 230
  }
}
```

### 3.2 詳細検索

**POST** `/search/advanced`

#### リクエスト

```json
{
  "query": {
    "text": "営業報告",
    "file_types": ["pdf", "docx"],
    "date_range": {
      "from": "2025-01-01",
      "to": "2025-01-31"
    },
    "size_range": {
      "min": 0,
      "max": 10485760
    },
    "paths": ["/documents/sales/"],
    "metadata": {
      "author": "山田太郎"
    }
  },
  "filters": {
    "department": "営業部"
  },
  "options": {
    "highlight": true,
    "facets": ["type", "author", "department"],
    "fuzzy": true
  },
  "pagination": {
    "page": 1,
    "limit": 20
  },
  "sort": {
    "field": "modified_at",
    "order": "desc"
  }
}
```

#### レスポンス

```json
{
  "success": true,
  "data": {
    "results": [...],
    "facets": {
      "type": [
        {"value": "pdf", "count": 45},
        {"value": "docx", "count": 32}
      ],
      "author": [
        {"value": "山田太郎", "count": 23},
        {"value": "佐藤花子", "count": 15}
      ]
    },
    "total": 77,
    "aggregations": {
      "total_size": 524288000,
      "avg_size": 6809454
    }
  }
}
```

### 3.3 検索サジェスト

**GET** `/search/suggestions`

#### クエリパラメータ

| パラメータ | 型 | 必須 | 説明 |
|-----------|-----|------|------|
| q | string | ○ | 入力中のクエリ |
| limit | integer | - | 件数（デフォルト: 10） |

#### レスポンス

```json
{
  "success": true,
  "data": {
    "suggestions": [
      "営業報告書",
      "営業報告書 2025",
      "営業報告書 Q1"
    ]
  }
}
```

### 3.4 類似画像検索

**POST** `/search/similar-images`

#### リクエスト（multipart/form-data）

```
image: (binary)
threshold: 0.8
limit: 20
```

#### レスポンス

```json
{
  "success": true,
  "data": {
    "results": [
      {
        "id": "img_001",
        "name": "product_photo.jpg",
        "path": "/images/products/product_photo.jpg",
        "similarity": 0.92,
        "thumbnail_url": "https://cdn.example.com/thumbs/img_001.jpg"
      }
    ],
    "total": 15
  }
}
```

## 4. ファイルAPI

### 4.1 ファイル詳細取得

**GET** `/files/{file_id}`

#### レスポンス

```json
{
  "success": true,
  "data": {
    "id": "file_001",
    "name": "営業報告書_2025Q1.pdf",
    "path": "/documents/sales/2025/Q1/営業報告書_2025Q1.pdf",
    "type": "pdf",
    "mime_type": "application/pdf",
    "size": 2048576,
    "created_at": "2025-01-10T10:00:00Z",
    "modified_at": "2025-01-14T15:30:00Z",
    "created_by": "user_123",
    "modified_by": "user_456",
    "metadata": {
      "pages": 10,
      "author": "山田太郎",
      "title": "2025年第1四半期営業報告書"
    },
    "permissions": {
      "can_read": true,
      "can_download": true,
      "can_edit": false
    }
  }
}
```

### 4.2 ファイルプレビュー

**GET** `/files/{file_id}/preview`

#### クエリパラメータ

| パラメータ | 型 | 必須 | 説明 |
|-----------|-----|------|------|
| page | integer | - | ページ番号（PDFの場合） |
| size | string | - | サムネイルサイズ（small, medium, large） |

#### レスポンス

```json
{
  "success": true,
  "data": {
    "preview_url": "https://preview.example.com/files/file_001",
    "type": "image",
    "expires_at": "2025-01-15T11:00:00Z",
    "pages": 10,
    "current_page": 1
  }
}
```

### 4.3 ファイルダウンロード

**GET** `/files/{file_id}/download`

#### レスポンス

```json
{
  "success": true,
  "data": {
    "download_url": "https://download.example.com/secure/file_001",
    "expires_at": "2025-01-15T11:00:00Z"
  }
}
```

### 4.4 フォルダ内容取得

**GET** `/files/browse`

#### クエリパラメータ

| パラメータ | 型 | 必須 | 説明 |
|-----------|-----|------|------|
| path | string | - | フォルダパス（デフォルト: /） |
| sort | string | - | ソート順 |
| type | string | - | ファイルタイプフィルタ |

#### レスポンス

```json
{
  "success": true,
  "data": {
    "current_path": "/documents/sales/",
    "folders": [
      {
        "name": "2025",
        "path": "/documents/sales/2025/",
        "item_count": 45,
        "size": 104857600,
        "modified_at": "2025-01-14T10:00:00Z"
      }
    ],
    "files": [
      {
        "id": "file_002",
        "name": "overview.docx",
        "type": "docx",
        "size": 524288,
        "modified_at": "2025-01-13T14:00:00Z"
      }
    ],
    "breadcrumbs": [
      {"name": "ルート", "path": "/"},
      {"name": "documents", "path": "/documents/"},
      {"name": "sales", "path": "/documents/sales/"}
    ]
  }
}
```

## 5. 管理API

### 5.1 インデックス更新開始

**POST** `/admin/index/trigger`

#### リクエスト

```json
{
  "type": "full",  // full or incremental
  "paths": ["/documents/"],
  "options": {
    "force": false,
    "notify_on_complete": true
  }
}
```

#### レスポンス

```json
{
  "success": true,
  "data": {
    "job_id": "job_123456",
    "status": "started",
    "estimated_time": 3600,
    "message": "インデックス更新を開始しました"
  }
}
```

### 5.2 インデックス状態取得

**GET** `/admin/index/status`

#### レスポンス

```json
{
  "success": true,
  "data": {
    "last_update": "2025-01-01T00:00:00Z",
    "next_scheduled": "2025-02-01T00:00:00Z",
    "current_job": {
      "job_id": "job_123456",
      "status": "running",
      "progress": 45,
      "files_processed": 4500,
      "files_total": 10000,
      "started_at": "2025-01-15T10:00:00Z",
      "estimated_completion": "2025-01-15T11:00:00Z"
    },
    "statistics": {
      "total_files": 50000,
      "total_size": 10737418240,
      "indexed_files": 49500,
      "failed_files": 500
    }
  }
}
```

### 5.3 検索ログ取得

**GET** `/admin/logs/search`

#### クエリパラメータ

| パラメータ | 型 | 必須 | 説明 |
|-----------|-----|------|------|
| from | datetime | - | 開始日時 |
| to | datetime | - | 終了日時 |
| user_id | string | - | ユーザーID |
| limit | integer | - | 件数 |

#### レスポンス

```json
{
  "success": true,
  "data": {
    "logs": [
      {
        "id": "log_001",
        "timestamp": "2025-01-15T10:30:00Z",
        "user_id": "user_123",
        "user_name": "山田太郎",
        "query": "営業報告",
        "filters": {
          "type": ["pdf"]
        },
        "results_count": 45,
        "response_time_ms": 230,
        "ip_address": "192.168.1.100"
      }
    ],
    "total": 1500,
    "aggregations": {
      "total_searches": 1500,
      "unique_users": 45,
      "avg_response_time": 250
    }
  }
}
```

## 6. ユーザー管理API

### 6.1 ユーザー一覧取得

**GET** `/users`

#### クエリパラメータ

| パラメータ | 型 | 必須 | 説明 |
|-----------|-----|------|------|
| page | integer | - | ページ番号 |
| limit | integer | - | 件数 |
| department | string | - | 部署フィルタ |
| role | string | - | 役割フィルタ |

#### レスポンス

```json
{
  "success": true,
  "data": {
    "users": [
      {
        "id": "user_123",
        "email": "yamada@example.com",
        "name": "山田太郎",
        "department": "営業部",
        "role": "user",
        "status": "active",
        "created_at": "2024-01-15T10:00:00Z",
        "last_login": "2025-01-15T09:00:00Z"
      }
    ],
    "total": 50,
    "page": 1,
    "limit": 20
  }
}
```

### 6.2 ユーザー作成

**POST** `/users`

#### リクエスト

```json
{
  "email": "tanaka@example.com",
  "name": "田中次郎",
  "department": "開発部",
  "role": "user",
  "password": "InitialPassword123!"
}
```

#### レスポンス

```json
{
  "success": true,
  "data": {
    "id": "user_789",
    "email": "tanaka@example.com",
    "name": "田中次郎",
    "department": "開発部",
    "role": "user",
    "status": "pending_activation",
    "created_at": "2025-01-15T11:00:00Z"
  }
}
```

### 6.3 ユーザー更新

**PUT** `/users/{user_id}`

#### リクエスト

```json
{
  "name": "田中次郎",
  "department": "企画部",
  "role": "admin"
}
```

#### レスポンス

```json
{
  "success": true,
  "data": {
    "id": "user_789",
    "email": "tanaka@example.com",
    "name": "田中次郎",
    "department": "企画部",
    "role": "admin",
    "status": "active",
    "updated_at": "2025-01-15T11:30:00Z"
  }
}
```

### 6.4 ユーザー削除

**DELETE** `/users/{user_id}`

#### レスポンス

```json
{
  "success": true,
  "data": {
    "message": "ユーザーを削除しました"
  }
}
```

## 7. エラーコード一覧

| コード | 説明 |
|--------|------|
| AUTH_INVALID_CREDENTIALS | 認証情報が正しくありません |
| AUTH_TOKEN_EXPIRED | トークンの有効期限が切れています |
| AUTH_INSUFFICIENT_PERMISSIONS | 権限が不足しています |
| VALIDATION_ERROR | 入力値が不正です |
| RESOURCE_NOT_FOUND | リソースが見つかりません |
| RATE_LIMIT_EXCEEDED | レート制限を超えました |
| INDEX_UPDATE_IN_PROGRESS | インデックス更新中です |
| FILE_TOO_LARGE | ファイルサイズが大きすぎます |
| UNSUPPORTED_FILE_TYPE | サポートされていないファイルタイプです |
| INTERNAL_SERVER_ERROR | サーバー内部エラーが発生しました |

## 8. レート制限

| エンドポイント | 制限 |
|---------------|------|
| /auth/* | 10回/分 |
| /search | 100回/分 |
| /search/advanced | 50回/分 |
| /files/*/download | 30回/分 |
| /admin/* | 10回/分 |

## 9. Webhook

### 9.1 インデックス完了通知

```json
{
  "event": "index.completed",
  "timestamp": "2025-01-15T12:00:00Z",
  "data": {
    "job_id": "job_123456",
    "status": "success",
    "files_processed": 10000,
    "duration_seconds": 3600
  }
}
```

---

## 改訂履歴

| 版数 | 日付 | 改訂内容 | 作成者 |
|------|------|----------|--------|
| 1.0 | 2025-01-15 | 初版作成 | CIS開発チーム |