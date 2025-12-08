/**
 * AWS Secrets Manager Integration
 *
 * このモジュールは、AWS Secrets Managerからシークレットを安全に取得します。
 * OWASP Top 10 2021 - A02: Cryptographic Failures対策
 */

import {
  SecretsManagerClient,
  GetSecretValueCommand,
  type GetSecretValueCommandInput,
} from '@aws-sdk/client-secrets-manager';

/**
 * Secrets Manager クライアント設定
 */
const client = new SecretsManagerClient({
  region: process.env.AWS_REGION || 'ap-northeast-1',
});

/**
 * シークレットキャッシュ (1時間)
 */
interface CachedSecret {
  value: any;
  expiresAt: number;
}

const secretCache = new Map<string, CachedSecret>();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

/**
 * AWS Secrets Managerからシークレットを取得
 *
 * @param secretId - Secret ARNまたは名前
 * @param useCache - キャッシュを使用するか (デフォルト: true)
 * @returns シークレット値 (JSON parse済み)
 *
 * @example
 * ```typescript
 * const dbCreds = await getSecret('prod/database/credentials');
 * console.log(dbCreds.password); // => "MySecretPassword123"
 * ```
 */
export const getSecret = async <T = any>(
  secretId: string,
  useCache = true
): Promise<T> => {
  // キャッシュチェック
  if (useCache) {
    const cached = secretCache.get(secretId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }
  }

  try {
    const input: GetSecretValueCommandInput = {
      SecretId: secretId,
    };

    const command = new GetSecretValueCommand(input);
    const response = await client.send(command);

    let secretValue: T;

    if (response.SecretString) {
      secretValue = JSON.parse(response.SecretString);
    } else if (response.SecretBinary) {
      // Binary secrets are base64-encoded
      const buff = Buffer.from(response.SecretBinary);
      secretValue = JSON.parse(buff.toString('utf-8'));
    } else {
      throw new Error('Secret value is empty');
    }

    // キャッシュに保存
    if (useCache) {
      secretCache.set(secretId, {
        value: secretValue,
        expiresAt: Date.now() + CACHE_TTL,
      });
    }

    return secretValue;
  } catch (error) {
    console.error(`Failed to retrieve secret: ${secretId}`, error);
    throw new Error(`Failed to retrieve secret: ${secretId}`);
  }
};

/**
 * 複数のシークレットを並行取得
 *
 * @param secretIds - Secret IDの配列
 * @returns シークレット値の配列
 *
 * @example
 * ```typescript
 * const [dbCreds, apiKeys] = await getSecrets([
 *   'prod/database/credentials',
 *   'prod/api/keys'
 * ]);
 * ```
 */
export const getSecrets = async <T = any>(secretIds: string[]): Promise<T[]> => {
  return await Promise.all(secretIds.map(id => getSecret<T>(id)));
};

/**
 * シークレットキャッシュをクリア
 */
export const clearSecretCache = (secretId?: string): void => {
  if (secretId) {
    secretCache.delete(secretId);
  } else {
    secretCache.clear();
  }
};

/**
 * 環境変数からシークレットを取得
 *
 * 環境変数が `arn:aws:secretsmanager:` で始まる場合、Secrets Managerから取得
 * それ以外の場合、環境変数の値をそのまま返す (ローカル開発用)
 *
 * @param envKey - 環境変数名
 * @param secretKey - シークレット内のキー名
 * @returns シークレット値
 *
 * @example
 * ```typescript
 * // .env: DATABASE_SECRET_ARN=arn:aws:secretsmanager:...
 * const password = await getSecretFromEnv('DATABASE_SECRET_ARN', 'password');
 *
 * // .env: DATABASE_PASSWORD=localhost-password (ローカル開発)
 * const password = await getSecretFromEnv('DATABASE_PASSWORD');
 * ```
 */
export const getSecretFromEnv = async (
  envKey: string,
  secretKey?: string
): Promise<string> => {
  const envValue = process.env[envKey];

  if (!envValue) {
    throw new Error(`Environment variable ${envKey} is not set`);
  }

  // Secrets Manager ARNの場合
  if (envValue.startsWith('arn:aws:secretsmanager:')) {
    const secret = await getSecret(envValue);

    if (secretKey) {
      if (!(secretKey in secret)) {
        throw new Error(`Secret key '${secretKey}' not found in ${envValue}`);
      }
      return secret[secretKey];
    }

    return secret;
  }

  // 通常の環境変数
  return envValue;
};

/**
 * データベース認証情報を取得
 *
 * @example
 * ```typescript
 * const dbConfig = await getDatabaseCredentials();
 * const pool = new Pool({
 *   host: dbConfig.host,
 *   port: dbConfig.port,
 *   database: dbConfig.database,
 *   user: dbConfig.username,
 *   password: dbConfig.password,
 * });
 * ```
 */
export interface DatabaseCredentials {
  username: string;
  password: string;
  host: string;
  port: number;
  database: string;
}

export const getDatabaseCredentials = async (): Promise<DatabaseCredentials> => {
  const secretId = process.env.DATABASE_SECRET_ARN || 'prod/database/credentials';
  return await getSecret<DatabaseCredentials>(secretId);
};

/**
 * JWT Secretを取得
 */
export const getJWTSecret = async (): Promise<string> => {
  const secret = await getSecretFromEnv(
    process.env.JWT_SECRET_ARN ? 'JWT_SECRET_ARN' : 'JWT_SECRET',
    'secret'
  );
  return secret;
};

/**
 * APIキーを取得
 */
export const getAPIKey = async (keyName: string): Promise<string> => {
  const secretId = process.env.API_KEYS_SECRET_ARN || 'prod/api/keys';
  const apiKeys = await getSecret(secretId);

  if (!(keyName in apiKeys)) {
    throw new Error(`API key '${keyName}' not found`);
  }

  return apiKeys[keyName];
};
