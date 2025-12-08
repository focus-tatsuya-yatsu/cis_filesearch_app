# AWS Secrets Manager 移行ガイド

## 概要

このガイドでは、`.env`ファイルに保存されている機密情報をAWS Secrets Managerに移行する手順を説明します。

## 移行前の状態 (❌ 脆弱)

```env
# .env
DATABASE_PASSWORD=MySecretPassword123
API_KEY=sk-1234567890abcdef
JWT_SECRET=super-secret-jwt-key
AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
```

## 移行後の状態 (✅ セキュア)

```env
# .env
DATABASE_SECRET_ARN=arn:aws:secretsmanager:ap-northeast-1:123456789012:secret:prod/database-credentials-AbCdEf
API_KEYS_SECRET_ARN=arn:aws:secretsmanager:ap-northeast-1:123456789012:secret:prod/api-keys-XyZ123
JWT_SECRET_ARN=arn:aws:secretsmanager:ap-northeast-1:123456789012:secret:prod/jwt-secret-Abc456
AWS_REGION=ap-northeast-1
```

---

## 手順1: Secretsの作成

### AWS CLIでの作成

```bash
# 1. データベース認証情報
aws secretsmanager create-secret \
    --name prod/database/credentials \
    --description "Production database credentials" \
    --secret-string '{
        "username": "dbuser",
        "password": "MySecretPassword123",
        "host": "mydb.cluster-abc123.ap-northeast-1.rds.amazonaws.com",
        "port": 5432,
        "database": "filesearch"
    }' \
    --region ap-northeast-1

# 2. APIキー
aws secretsmanager create-secret \
    --name prod/api/keys \
    --description "API keys for external services" \
    --secret-string '{
        "openai_api_key": "sk-1234567890abcdef",
        "aws_access_key_id": "AKIAIOSFODNN7EXAMPLE",
        "aws_secret_access_key": "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
    }' \
    --region ap-northeast-1

# 3. JWT Secret
aws secretsmanager create-secret \
    --name prod/jwt/secret \
    --description "JWT signing secret" \
    --secret-string '{
        "secret": "super-secret-jwt-key"
    }' \
    --region ap-northeast-1
```

### ARNの取得

```bash
# データベース認証情報のARNを取得
aws secretsmanager describe-secret \
    --secret-id prod/database/credentials \
    --region ap-northeast-1 \
    --query 'ARN' \
    --output text

# 出力例:
# arn:aws:secretsmanager:ap-northeast-1:123456789012:secret:prod/database/credentials-AbCdEf
```

---

## 手順2: IAMポリシーの設定

### IAMポリシーの作成

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowSecretsManagerRead",
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue",
        "secretsmanager:DescribeSecret"
      ],
      "Resource": [
        "arn:aws:secretsmanager:ap-northeast-1:123456789012:secret:prod/*"
      ]
    },
    {
      "Sid": "AllowKMSDecrypt",
      "Effect": "Allow",
      "Action": [
        "kms:Decrypt",
        "kms:DescribeKey"
      ],
      "Resource": "arn:aws:kms:ap-northeast-1:123456789012:key/*",
      "Condition": {
        "StringEquals": {
          "kms:ViaService": "secretsmanager.ap-northeast-1.amazonaws.com"
        }
      }
    }
  ]
}
```

### IAMロールへのアタッチ

```bash
aws iam attach-role-policy \
    --role-name FileSearchAppEC2Role \
    --policy-arn arn:aws:iam::123456789012:policy/FileSearchAppSecretsManagerReadPolicy
```

---

## 手順3: コードの変更

### Before (❌ 脆弱)

```typescript
import { Pool } from 'pg';

// 環境変数から直接読み取り
const pool = new Pool({
  host: process.env.DATABASE_HOST,
  port: parseInt(process.env.DATABASE_PORT || '5432'),
  database: process.env.DATABASE_NAME,
  user: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD,  // ❌ 平文
});
```

### After (✅ セキュア)

```typescript
import { Pool } from 'pg';
import { getDatabaseCredentials } from './utils/secretsManager';

// Secrets Managerから取得
const dbCreds = await getDatabaseCredentials();

const pool = new Pool({
  host: dbCreds.host,
  port: dbCreds.port,
  database: dbCreds.database,
  user: dbCreds.username,
  password: dbCreds.password,  // ✅ 実行時に取得
});
```

---

## 手順4: 環境変数の更新

### .env ファイル

```env
# AWS Secrets Manager ARNs
DATABASE_SECRET_ARN=arn:aws:secretsmanager:ap-northeast-1:123456789012:secret:prod/database-credentials-AbCdEf
API_KEYS_SECRET_ARN=arn:aws:secretsmanager:ap-northeast-1:123456789012:secret:prod/api-keys-XyZ123
JWT_SECRET_ARN=arn:aws:secretsmanager:ap-northeast-1:123456789012:secret:prod/jwt-secret-Abc456

# AWS設定
AWS_REGION=ap-northeast-1

# ローカル開発用 (本番環境では使用しない)
# NODE_ENV=development
# DATABASE_PASSWORD=localhost-password
```

### .env.example ファイルの更新

```env
# AWS Secrets Manager ARNs (Production)
DATABASE_SECRET_ARN=
API_KEYS_SECRET_ARN=
JWT_SECRET_ARN=

# AWS Configuration
AWS_REGION=ap-northeast-1

# Local Development Only (DO NOT use in production)
# DATABASE_HOST=localhost
# DATABASE_PORT=5432
# DATABASE_NAME=filesearch_dev
# DATABASE_USER=dev_user
# DATABASE_PASSWORD=dev_password
```

---

## 手順5: 動作確認

### テストスクリプト

```typescript
// test-secrets.ts
import { getSecret, getDatabaseCredentials, getJWTSecret } from './utils/secretsManager';

async function testSecrets() {
  try {
    console.log('Testing Secrets Manager integration...\n');

    // 1. データベース認証情報
    console.log('1. Database Credentials:');
    const dbCreds = await getDatabaseCredentials();
    console.log(`   - Host: ${dbCreds.host}`);
    console.log(`   - Database: ${dbCreds.database}`);
    console.log(`   - Username: ${dbCreds.username}`);
    console.log(`   - Password: ${'*'.repeat(dbCreds.password.length)}`);
    console.log('   ✅ Successfully retrieved\n');

    // 2. JWT Secret
    console.log('2. JWT Secret:');
    const jwtSecret = await getJWTSecret();
    console.log(`   - Secret: ${'*'.repeat(jwtSecret.length)}`);
    console.log('   ✅ Successfully retrieved\n');

    // 3. APIキー
    console.log('3. API Keys:');
    const apiKey = await getSecret('prod/api/keys');
    console.log(`   - OpenAI API Key: ${apiKey.openai_api_key.substring(0, 10)}...`);
    console.log('   ✅ Successfully retrieved\n');

    console.log('✅ All secrets retrieved successfully!');
  } catch (error) {
    console.error('❌ Failed to retrieve secrets:', error);
    process.exit(1);
  }
}

testSecrets();
```

### 実行

```bash
ts-node test-secrets.ts
```

---

## ローカル開発環境での設定

ローカル開発では、Secrets Managerを使用せず、通常の環境変数を使用できます。

### .env.local

```env
# ローカル開発用の環境変数
NODE_ENV=development
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_NAME=filesearch_dev
DATABASE_USER=dev_user
DATABASE_PASSWORD=dev_password
JWT_SECRET=local-dev-jwt-secret
```

### コードでの分岐

```typescript
import { getDatabaseCredentials } from './utils/secretsManager';

async function getDatabaseConfig() {
  if (process.env.NODE_ENV === 'development') {
    // ローカル開発: 環境変数から直接読み取り
    return {
      host: process.env.DATABASE_HOST!,
      port: parseInt(process.env.DATABASE_PORT || '5432'),
      database: process.env.DATABASE_NAME!,
      user: process.env.DATABASE_USER!,
      password: process.env.DATABASE_PASSWORD!,
    };
  } else {
    // 本番環境: Secrets Managerから取得
    return await getDatabaseCredentials();
  }
}
```

---

## セキュリティベストプラクティス

### ✅ DO

1. **Secrets Managerを本番環境でのみ使用**
   - ローカル開発では環境変数を使用してコストを削減

2. **IAMポリシーの最小権限の原則**
   - 必要なSecretへのアクセスのみを許可

3. **Secretの命名規則**
   - `{環境}/{サービス}/{用途}` の形式を使用
   - 例: `prod/database/credentials`, `staging/api/keys`

4. **自動ローテーションの有効化**
   - RDSパスワードなどは定期的に自動ローテーション

5. **監査ログの有効化**
   - CloudTrailでSecretへのアクセスを監視

### ❌ DON'T

1. **Secretを直接コードにハードコーディングしない**
   ```typescript
   // ❌ 絶対にやらない
   const password = "MySecretPassword123";
   ```

2. **Secretをログに出力しない**
   ```typescript
   // ❌ 絶対にやらない
   console.log(`Password: ${password}`);
   ```

3. **Git履歴に機密情報を残さない**
   - `.env`ファイルは`.gitignore`に追加
   - 既にコミット済みの場合、Git履歴を削除

---

## トラブルシューティング

### エラー: `ResourceNotFoundException`

**原因**: Secret IDまたはARNが間違っている

**解決策**:
```bash
# Secretが存在するか確認
aws secretsmanager list-secrets --region ap-northeast-1
```

### エラー: `AccessDeniedException`

**原因**: IAMポリシーが正しく設定されていない

**解決策**:
```bash
# IAMロールのポリシーを確認
aws iam list-attached-role-policies --role-name FileSearchAppEC2Role

# IAMロールにポリシーをアタッチ
aws iam attach-role-policy \
    --role-name FileSearchAppEC2Role \
    --policy-arn arn:aws:iam::123456789012:policy/FileSearchAppSecretsManagerReadPolicy
```

### エラー: `InvalidRequestException`

**原因**: Secret値のJSON形式が不正

**解決策**:
```bash
# Secret値を確認
aws secretsmanager get-secret-value \
    --secret-id prod/database/credentials \
    --region ap-northeast-1 \
    --query 'SecretString' \
    --output text | jq '.'
```

---

## コスト

### AWS Secrets Manager料金 (東京リージョン)

- **Secretあたり**: $0.40/月
- **API呼び出し**: 10,000リクエストあたり $0.05

### コスト削減のヒント

1. **Secretをグループ化**:
   - 複数の関連する値を1つのSecretにまとめる
   - 例: すべてのAPIキーを1つのSecretに保存

2. **キャッシュを活用**:
   - `secretsManager.ts`の実装ではデフォルトで1時間キャッシュ
   - API呼び出し回数を削減

3. **ローカル開発では使用しない**:
   - 開発環境では通常の環境変数を使用

---

## まとめ

Secrets Managerを使用することで:

- ✅ 機密情報をGit履歴から完全に分離
- ✅ 実行時にのみSecretを取得し、メモリ上でのみ保持
- ✅ IAMポリシーによるアクセス制御
- ✅ 自動ローテーション対応
- ✅ CloudTrailによる監査ログ

**CVSS 9.8 (Critical) の脆弱性が完全に解消されます。**
