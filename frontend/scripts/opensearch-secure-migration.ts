#!/usr/bin/env tsx
/**
 * Secure OpenSearch Migration Script
 * Implements security best practices and comprehensive validation
 *
 * SECURITY FEATURES:
 * - VPC access validation before execution
 * - Configuration consistency checks
 * - Dry-run mode for safe testing
 * - Comprehensive audit logging
 * - Circuit breaker for failure handling
 * - Automated rollback on critical errors
 *
 * USAGE:
 *   # Dry run (safe, no changes made)
 *   npm run migrate:opensearch -- --dry-run
 *
 *   # Execute from EC2 instance (VPC access)
 *   npm run migrate:opensearch -- --execute
 *
 *   # Force mode (skip some validations, use with caution)
 *   npm run migrate:opensearch -- --execute --force
 *
 * @author Security Team
 * @version 2.0.0
 * @security-audit-required true
 */

import { Client } from '@opensearch-project/opensearch';
import { AwsSigv4Signer } from '@opensearch-project/opensearch/aws';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { BlueGreenMigration } from '../src/lib/opensearch-migration-strategy';

// ============================================================================
// CONFIGURATION VALIDATION
// ============================================================================

interface MigrationConfig {
  opensearchEndpoint: string;
  currentIndexName: string;
  newIndexName: string;
  aliasName: string;
  awsRegion: string;
  backupRepositoryName: string;
  dryRun: boolean;
  force: boolean;
}

/**
 * Load and validate configuration from environment
 */
function loadConfiguration(): MigrationConfig {
  const config: MigrationConfig = {
    opensearchEndpoint: process.env.OPENSEARCH_ENDPOINT || '',
    currentIndexName: process.env.OPENSEARCH_INDEX || '',
    newIndexName: process.env.OPENSEARCH_NEW_INDEX || '',
    aliasName: process.env.OPENSEARCH_ALIAS || 'file-index',
    awsRegion: process.env.AWS_REGION || 'ap-northeast-1',
    backupRepositoryName: process.env.OPENSEARCH_BACKUP_REPO || 'opensearch-backups',
    dryRun: process.argv.includes('--dry-run'),
    force: process.argv.includes('--force'),
  };

  // Validation
  const errors: string[] = [];

  if (!config.opensearchEndpoint) {
    errors.push('OPENSEARCH_ENDPOINT environment variable is required');
  }

  if (!config.currentIndexName) {
    errors.push('OPENSEARCH_INDEX environment variable is required');
  }

  if (!config.newIndexName) {
    config.newIndexName = `${config.currentIndexName}-v2-${getDateString()}`;
    console.warn(`⚠️  OPENSEARCH_NEW_INDEX not set, using: ${config.newIndexName}`);
  }

  // Security check: Ensure endpoint is VPC endpoint
  if (!config.opensearchEndpoint.includes('vpc-')) {
    errors.push(
      '🔐 SECURITY VIOLATION: OpenSearch endpoint must be a VPC endpoint (starts with "vpc-")'
    );
    errors.push('   Public endpoints are not allowed for production migrations');
  }

  if (errors.length > 0) {
    console.error('❌ Configuration validation failed:\n');
    errors.forEach((err) => console.error(`   - ${err}`));
    process.exit(1);
  }

  return config;
}

/**
 * Get date string for index naming
 */
function getDateString(): string {
  const now = new Date();
  return now.toISOString().split('T')[0]; // YYYY-MM-DD
}

// ============================================================================
// NETWORK VALIDATION
// ============================================================================

/**
 * Validate VPC network access
 * Critical security check: Must be executed from within VPC
 */
async function validateVPCAccess(
  client: Client,
  config: MigrationConfig
): Promise<boolean> {
  console.log('🔍 Validating VPC network access...');

  try {
    // Check 1: Can we reach OpenSearch cluster?
    const healthResponse = await client.cluster.health({}, { timeout: 5000 });

    if (!healthResponse.body) {
      throw new Error('No response from OpenSearch cluster');
    }

    console.log('✅ Network connectivity: OK');
    console.log(`   Cluster status: ${healthResponse.body.status}`);

    // Check 2: Are we running in VPC environment?
    const isInVPC = await detectVPCEnvironment();

    if (!isInVPC && !config.force) {
      console.error('❌ SECURITY ERROR: Not running in VPC environment');
      console.error('   This script must be executed from:');
      console.error('     - EC2 instance within VPC');
      console.error('     - AWS Lambda within VPC');
      console.error('     - Via AWS SSM Session Manager');
      console.error('');
      console.error('   Current environment detected: Local machine');
      console.error('   Use --force to bypass this check (NOT RECOMMENDED)');
      return false;
    }

    if (!isInVPC && config.force) {
      console.warn('⚠️  WARNING: VPC check bypassed with --force flag');
      console.warn('   Ensure you have proper network access');
    }

    return true;
  } catch (error: any) {
    if (error.message?.includes('ENOTFOUND') || error.message?.includes('ETIMEDOUT')) {
      console.error('❌ NETWORK ERROR: Cannot reach OpenSearch endpoint');
      console.error('   This is expected if running outside VPC');
      console.error('');
      console.error('   VPC endpoints are only accessible from:');
      console.error('     - EC2 instances in the same VPC');
      console.error('     - Resources with VPC peering');
      console.error('     - Via VPN connection to VPC');
      console.error('');
      console.error('   To execute this migration:');
      console.error('   1. Connect to EC2 bastion: aws ssm start-session --target <INSTANCE_ID>');
      console.error('   2. Clone repository on EC2 instance');
      console.error('   3. Run migration script from EC2');
      return false;
    }

    console.error('❌ Unexpected error during network validation:', error.message);
    return false;
  }
}

/**
 * Detect if running in VPC environment
 */
async function detectVPCEnvironment(): Promise<boolean> {
  // Check 1: AWS_EXECUTION_ENV (Lambda)
  if (process.env.AWS_EXECUTION_ENV) {
    return true;
  }

  // Check 2: EC2 instance metadata service
  try {
    const response = await fetch('http://169.254.169.254/latest/meta-data/instance-id', {
      signal: AbortSignal.timeout(2000),
    });
    if (response.ok) {
      const instanceId = await response.text();
      console.log(`   Detected EC2 instance: ${instanceId}`);
      return true;
    }
  } catch {
    // Not in EC2
  }

  // Check 3: Hostname patterns
  const hostname = os.hostname();
  if (hostname.startsWith('ip-') || hostname.includes('ec2')) {
    console.log(`   Detected VPC hostname: ${hostname}`);
    return true;
  }

  return false;
}

// ============================================================================
// INDEX VALIDATION
// ============================================================================

/**
 * Validate index configuration consistency
 */
async function validateIndexConfiguration(
  client: Client,
  config: MigrationConfig
): Promise<boolean> {
  console.log('🔍 Validating index configuration...');

  try {
    // Check if current index exists
    const indexExists = await client.indices.exists({
      index: config.currentIndexName,
    });

    if (!indexExists.body) {
      console.error(`❌ Current index '${config.currentIndexName}' does not exist`);
      console.error('   Available indices:');

      const indices = await client.cat.indices({ format: 'json' });
      indices.body.forEach((idx: any) => {
        console.error(`     - ${idx.index} (${idx['docs.count']} docs)`);
      });

      return false;
    }

    console.log(`✅ Current index exists: ${config.currentIndexName}`);

    // Check document count
    const countResponse = await client.count({
      index: config.currentIndexName,
    });

    const docCount = countResponse.body.count;
    console.log(`   Document count: ${docCount.toLocaleString()}`);

    if (docCount === 0) {
      console.warn('⚠️  WARNING: Current index has 0 documents');
      if (!config.force) {
        console.error('   Migration of empty index may not be intentional');
        console.error('   Use --force to proceed anyway');
        return false;
      }
    }

    // Check if new index already exists (from previous failed migration)
    const newIndexExists = await client.indices.exists({
      index: config.newIndexName,
    });

    if (newIndexExists.body) {
      console.warn(`⚠️  WARNING: New index '${config.newIndexName}' already exists`);
      console.warn('   This may be from a previous failed migration');

      if (!config.force) {
        console.error('   Use --force to delete and recreate, or change OPENSEARCH_NEW_INDEX');
        return false;
      }

      console.warn('   Will delete existing new index and recreate');
    }

    // Check alias configuration
    const aliases = await client.indices.getAlias({
      index: config.currentIndexName,
    });

    console.log('   Current aliases:');
    Object.keys(aliases.body[config.currentIndexName]?.aliases || {}).forEach((alias) => {
      console.log(`     - ${alias}`);
    });

    return true;
  } catch (error: any) {
    console.error('❌ Index validation failed:', error.message);
    return false;
  }
}

// ============================================================================
// BACKUP VALIDATION
// ============================================================================

/**
 * Validate backup repository and create pre-migration snapshot
 */
async function validateAndCreateBackup(
  client: Client,
  config: MigrationConfig
): Promise<string | null> {
  console.log('🔍 Validating backup repository...');

  try {
    // Check if repository exists
    const repoExists = await client.snapshot.getRepository({
      repository: config.backupRepositoryName,
    });

    if (!repoExists.body[config.backupRepositoryName]) {
      console.error(`❌ Backup repository '${config.backupRepositoryName}' not found`);
      console.error('   Create repository first:');
      console.error('   PUT _snapshot/opensearch-backups');
      console.error('   {');
      console.error('     "type": "s3",');
      console.error('     "settings": {');
      console.error('       "bucket": "cis-filesearch-backups",');
      console.error('       "region": "ap-northeast-1"');
      console.error('     }');
      console.error('   }');
      return null;
    }

    console.log(`✅ Backup repository exists: ${config.backupRepositoryName}`);

    // Create pre-migration snapshot
    const snapshotName = `pre-migration-${config.currentIndexName}-${Date.now()}`;

    console.log(`📸 Creating pre-migration snapshot: ${snapshotName}`);

    if (config.dryRun) {
      console.log('   [DRY RUN] Snapshot creation skipped');
      return snapshotName;
    }

    const snapshotResponse = await client.snapshot.create({
      repository: config.backupRepositoryName,
      snapshot: snapshotName,
      body: {
        indices: config.currentIndexName,
        include_global_state: false,
        metadata: {
          reason: 'Pre-migration backup',
          migration_script: 'opensearch-secure-migration.ts',
          timestamp: new Date().toISOString(),
        },
      },
      wait_for_completion: true,
    });

    if (snapshotResponse.body.snapshot.state !== 'SUCCESS') {
      console.error('❌ Snapshot creation failed');
      return null;
    }

    console.log('✅ Pre-migration snapshot created successfully');
    console.log(`   Snapshot name: ${snapshotName}`);
    console.log(`   Documents: ${snapshotResponse.body.snapshot.shards.successful} shards`);

    return snapshotName;
  } catch (error: any) {
    console.error('❌ Backup validation failed:', error.message);
    return null;
  }
}

// ============================================================================
// AUDIT LOGGING
// ============================================================================

interface AuditLog {
  timestamp: string;
  action: string;
  status: 'SUCCESS' | 'FAILURE' | 'WARNING' | 'INFO';
  details: any;
}

const auditLogs: AuditLog[] = [];

function logAudit(action: string, status: AuditLog['status'], details: any): void {
  const logEntry: AuditLog = {
    timestamp: new Date().toISOString(),
    action,
    status,
    details,
  };

  auditLogs.push(logEntry);

  // Console output
  const statusIcon =
    status === 'SUCCESS' ? '✅' : status === 'FAILURE' ? '❌' : status === 'WARNING' ? '⚠️' : 'ℹ️';
  console.log(`${statusIcon} [${action}] ${JSON.stringify(details)}`);
}

function saveAuditLog(config: MigrationConfig): void {
  const logFileName = `migration-audit-${Date.now()}.json`;
  const logFilePath = path.join(
    __dirname,
    '..',
    'docs',
    'incident-response',
    'audit-logs',
    logFileName
  );

  const auditReport = {
    migration: {
      timestamp: new Date().toISOString(),
      config,
      dryRun: config.dryRun,
    },
    logs: auditLogs,
  };

  fs.mkdirSync(path.dirname(logFilePath), { recursive: true });
  fs.writeFileSync(logFilePath, JSON.stringify(auditReport, null, 2));

  console.log(`\n📝 Audit log saved: ${logFilePath}`);
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

async function main() {
  console.log('🚀 OpenSearch Secure Migration Script v2.0.0\n');

  // Step 1: Load configuration
  const config = loadConfiguration();

  logAudit('LOAD_CONFIG', 'SUCCESS', config);

  if (config.dryRun) {
    console.log('🧪 DRY RUN MODE: No changes will be made\n');
  }

  // Step 2: Create OpenSearch client
  const client = new Client({
    ...AwsSigv4Signer({
      region: config.awsRegion,
      service: 'es',
      getCredentials: () => {
        const credentialsProvider = defaultProvider();
        return credentialsProvider();
      },
    }),
    node: config.opensearchEndpoint,
  });

  // Step 3: Validate VPC access
  const vpcAccessValid = await validateVPCAccess(client, config);
  if (!vpcAccessValid) {
    logAudit('VALIDATE_VPC_ACCESS', 'FAILURE', { reason: 'VPC access check failed' });
    saveAuditLog(config);
    process.exit(1);
  }
  logAudit('VALIDATE_VPC_ACCESS', 'SUCCESS', {});

  // Step 4: Validate index configuration
  const indexConfigValid = await validateIndexConfiguration(client, config);
  if (!indexConfigValid) {
    logAudit('VALIDATE_INDEX_CONFIG', 'FAILURE', { reason: 'Index configuration invalid' });
    saveAuditLog(config);
    process.exit(1);
  }
  logAudit('VALIDATE_INDEX_CONFIG', 'SUCCESS', {});

  // Step 5: Create backup
  const snapshotName = await validateAndCreateBackup(client, config);
  if (!snapshotName) {
    logAudit('CREATE_BACKUP', 'FAILURE', { reason: 'Backup creation failed' });
    saveAuditLog(config);
    process.exit(1);
  }
  logAudit('CREATE_BACKUP', 'SUCCESS', { snapshotName });

  // Step 6: Execute migration
  if (config.dryRun) {
    console.log('\n✅ DRY RUN COMPLETE: All validations passed');
    console.log('   To execute migration, run with --execute flag');
    console.log('   Ensure you are running from EC2 instance in VPC');
    logAudit('DRY_RUN_COMPLETE', 'SUCCESS', {});
  } else {
    console.log('\n🚀 Starting Blue-Green migration...\n');

    const migration = new BlueGreenMigration(
      client,
      config.currentIndexName,
      config.newIndexName,
      config.aliasName
    );

    try {
      const success = await migration.executeMigration();

      if (success) {
        console.log('\n✅ MIGRATION COMPLETED SUCCESSFULLY');
        logAudit('MIGRATION_COMPLETE', 'SUCCESS', {
          newIndex: config.newIndexName,
          alias: config.aliasName,
        });
      } else {
        console.error('\n❌ MIGRATION FAILED');
        console.error('   System rolled back to original state');
        console.error(`   Backup snapshot available: ${snapshotName}`);
        logAudit('MIGRATION_FAILED', 'FAILURE', { snapshotName });
      }
    } catch (error: any) {
      console.error('\n💥 CRITICAL ERROR during migration');
      console.error(`   Error: ${error.message}`);
      console.error(`   Backup snapshot: ${snapshotName}`);
      console.error('   Follow rollback procedures in docs/incident-response/');
      logAudit('MIGRATION_ERROR', 'FAILURE', {
        error: error.message,
        stack: error.stack,
        snapshotName,
      });
    }
  }

  // Save audit log
  saveAuditLog(config);

  console.log('\n📋 Review audit log for complete migration history');
}

// Execute
main().catch((error) => {
  console.error('💥 FATAL ERROR:', error);
  logAudit('FATAL_ERROR', 'FAILURE', { error: error.message, stack: error.stack });
  saveAuditLog(loadConfiguration());
  process.exit(1);
});
