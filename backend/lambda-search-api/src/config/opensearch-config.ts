/**
 * OpenSearch Configuration Management
 * Centralized configuration with validation and type safety
 *
 * Configuration Priority:
 * 1. AWS Parameter Store (production)
 * 2. Environment Variables
 * 3. .env file
 * 4. Default values (development only)
 *
 * @module config/opensearch-config
 * 
 * 修正: TypeScriptエラー修正
 * - GetParameterCommand未使用警告修正
 * - ZodError.errorsの型エラー修正
 */

import { SSMClient, GetParametersCommand } from '@aws-sdk/client-ssm';
import { z } from 'zod';

/**
 * Configuration Schema with Validation
 */
const OpenSearchConfigSchema = z.object({
  endpoint: z
    .string()
    .url('OpenSearch endpoint must be a valid URL')
    .refine(
      (url) => url.includes('vpc-') || process.env.NODE_ENV === 'development',
      {
        message: 'Production OpenSearch endpoint must be a VPC endpoint (starts with "vpc-")',
      }
    ),
  indexName: z
    .string()
    .min(1, 'Index name is required')
    .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, {
      message: 'Index name must be lowercase alphanumeric with hyphens, no consecutive hyphens',
    }),
  aliasName: z.string().optional(),
  region: z.string().default('ap-northeast-1'),
  timeout: z.number().min(1000).max(300000).default(30000),
  maxRetries: z.number().min(0).max(10).default(3),
  environment: z.enum(['development', 'staging', 'production']).default('production'),
});

export type OpenSearchConfig = z.infer<typeof OpenSearchConfigSchema>;

/**
 * Configuration Cache (singleton pattern)
 */
class ConfigCache {
  private static instance: ConfigCache;
  private config: OpenSearchConfig | null = null;
  private lastFetchTime: number = 0;
  private cacheTTL: number = 5 * 60 * 1000; // 5 minutes

  private constructor() {}

  static getInstance(): ConfigCache {
    if (!ConfigCache.instance) {
      ConfigCache.instance = new ConfigCache();
    }
    return ConfigCache.instance;
  }

  get(forceRefresh: boolean = false): OpenSearchConfig | null {
    const now = Date.now();
    if (forceRefresh || !this.config || now - this.lastFetchTime > this.cacheTTL) {
      return null; // Needs refresh
    }
    return this.config;
  }

  set(config: OpenSearchConfig): void {
    this.config = config;
    this.lastFetchTime = Date.now();
  }

  clear(): void {
    this.config = null;
    this.lastFetchTime = 0;
  }
}

/**
 * Load configuration from AWS Parameter Store
 */
async function loadFromParameterStore(region: string): Promise<Partial<OpenSearchConfig>> {
  const ssmClient = new SSMClient({ region });

  const parameterNames = [
    '/cis-filesearch/opensearch/endpoint',
    '/cis-filesearch/opensearch/index-name',
    '/cis-filesearch/opensearch/alias-name',
  ];

  try {
    const response = await ssmClient.send(
      new GetParametersCommand({
        Names: parameterNames,
        WithDecryption: true,
      })
    );

    if (!response.Parameters || response.Parameters.length === 0) {
      console.warn('No parameters found in Parameter Store');
      return {};
    }

    const config: Partial<OpenSearchConfig> = {};

    for (const param of response.Parameters) {
      if (!param.Name || !param.Value) continue;

      switch (param.Name) {
        case '/cis-filesearch/opensearch/endpoint':
          config.endpoint = param.Value;
          break;
        case '/cis-filesearch/opensearch/index-name':
          config.indexName = param.Value;
          break;
        case '/cis-filesearch/opensearch/alias-name':
          config.aliasName = param.Value;
          break;
      }
    }

    console.info('Configuration loaded from Parameter Store', {
      parametersFound: response.Parameters.length,
    });

    return config;
  } catch (error: any) {
    console.warn('Failed to load from Parameter Store:', error.message);
    return {};
  }
}

/**
 * Load configuration from environment variables
 */
function loadFromEnvironment(): Partial<OpenSearchConfig> {
  return {
    endpoint: process.env.OPENSEARCH_ENDPOINT,
    indexName: process.env.OPENSEARCH_INDEX,
    aliasName: process.env.OPENSEARCH_ALIAS,
    region: process.env.AWS_REGION || 'ap-northeast-1',
    timeout: process.env.OPENSEARCH_TIMEOUT
      ? parseInt(process.env.OPENSEARCH_TIMEOUT, 10)
      : undefined,
    maxRetries: process.env.OPENSEARCH_MAX_RETRIES
      ? parseInt(process.env.OPENSEARCH_MAX_RETRIES, 10)
      : undefined,
    environment: (process.env.NODE_ENV as any) || 'production',
  };
}

/**
 * Get default configuration (development only)
 */
function getDefaultConfig(): Partial<OpenSearchConfig> {
  if (process.env.NODE_ENV === 'production') {
    return {};
  }

  return {
    endpoint: 'https://localhost:9200',
    indexName: 'file-index-dev',
    aliasName: 'file-index',
    region: 'ap-northeast-1',
    timeout: 30000,
    maxRetries: 3,
    environment: 'development',
  };
}

/**
 * Merge configuration from multiple sources
 */
function mergeConfigs(
  parameterStore: Partial<OpenSearchConfig>,
  environment: Partial<OpenSearchConfig>,
  defaults: Partial<OpenSearchConfig>
): Partial<OpenSearchConfig> {
  // Priority: Parameter Store > Environment Variables > Defaults
  return {
    ...defaults,
    ...environment,
    ...parameterStore,
  };
}

/**
 * Load and validate OpenSearch configuration
 *
 * @param options - Configuration options
 * @returns Validated OpenSearch configuration
 * @throws {Error} If configuration is invalid
 *
 * @example
 * ```typescript
 * const config = await loadOpenSearchConfig();
 * console.log(config.endpoint); // https://vpc-xxx.ap-northeast-1.es.amazonaws.com
 * ```
 */
export async function loadOpenSearchConfig(options?: {
  forceRefresh?: boolean;
  skipParameterStore?: boolean;
}): Promise<OpenSearchConfig> {
  const { forceRefresh = false, skipParameterStore = false } = options || {};

  // Check cache first
  const cache = ConfigCache.getInstance();
  const cachedConfig = cache.get(forceRefresh);
  if (cachedConfig && !forceRefresh) {
    return cachedConfig;
  }

  // Load from multiple sources
  const region = process.env.AWS_REGION || 'ap-northeast-1';

  const [parameterStoreConfig, envConfig, defaultConfig] = await Promise.all([
    skipParameterStore ? Promise.resolve({}) : loadFromParameterStore(region),
    Promise.resolve(loadFromEnvironment()),
    Promise.resolve(getDefaultConfig()),
  ]);

  // Merge configurations
  const mergedConfig = mergeConfigs(parameterStoreConfig, envConfig, defaultConfig);

  // Validate configuration
  try {
    const validatedConfig = OpenSearchConfigSchema.parse(mergedConfig);

    // Cache the validated configuration
    cache.set(validatedConfig);

    console.info('OpenSearch configuration loaded and validated', {
      endpoint: validatedConfig.endpoint.substring(0, 30) + '...',
      indexName: validatedConfig.indexName,
      environment: validatedConfig.environment,
    });

    return validatedConfig;
  } catch (error) {
    if (error instanceof z.ZodError) {
      // 修正: ZodErrorのissuesプロパティを使用
      const issues = error.issues;
      console.error('Configuration validation failed:', {
        errors: issues.map((e: z.ZodIssue) => ({
          path: e.path.join('.'),
          message: e.message,
        })),
      });

      throw new Error(
        `Invalid OpenSearch configuration:\n${issues
          .map((e: z.ZodIssue) => `  - ${e.path.join('.')}: ${e.message}`)
          .join('\n')}`
      );
    }

    throw error;
  }
}

/**
 * Validate network connectivity to OpenSearch
 */
export async function validateOpenSearchConnectivity(
  config: OpenSearchConfig
): Promise<boolean> {
  try {
    const url = new URL('/_cluster/health', config.endpoint);

    const response = await fetch(url.toString(), {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });

    return response.ok;
  } catch (error: any) {
    console.error('OpenSearch connectivity check failed:', {
      error: error.message,
      endpoint: config.endpoint,
    });
    return false;
  }
}

/**
 * Detect execution environment
 */
export async function detectExecutionEnvironment(): Promise<{
  isVPC: boolean;
  isEC2: boolean;
  isLambda: boolean;
  instanceId?: string;
}> {
  // Lambda detection
  const isLambda = !!process.env.AWS_LAMBDA_FUNCTION_NAME;

  // EC2 detection
  let isEC2 = false;
  let instanceId: string | undefined;

  try {
    const response = await fetch('http://169.254.169.254/latest/meta-data/instance-id', {
      signal: AbortSignal.timeout(2000),
    });

    if (response.ok) {
      instanceId = await response.text();
      isEC2 = true;
    }
  } catch {
    // Not running on EC2
  }

  const isVPC = isLambda || isEC2;

  return { isVPC, isEC2, isLambda, instanceId };
}

/**
 * Print configuration summary (for debugging)
 */
export function printConfigSummary(config: OpenSearchConfig): void {
  console.log('');
  console.log('=========================================');
  console.log('  OpenSearch Configuration Summary');
  console.log('=========================================');
  console.log(`  Endpoint:    ${config.endpoint}`);
  console.log(`  Index:       ${config.indexName}`);
  console.log(`  Alias:       ${config.aliasName || 'N/A'}`);
  console.log(`  Region:      ${config.region}`);
  console.log(`  Environment: ${config.environment}`);
  console.log(`  Timeout:     ${config.timeout}ms`);
  console.log(`  Max Retries: ${config.maxRetries}`);
  console.log('=========================================');
  console.log('');
}

/**
 * Clear configuration cache
 */
export function clearConfigCache(): void {
  ConfigCache.getInstance().clear();
}
