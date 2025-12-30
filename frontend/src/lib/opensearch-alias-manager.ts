/**
 * OpenSearch Alias Management
 * Seamless Index Switching with Zero-Downtime
 *
 * @description
 * Manages OpenSearch index aliases for safe blue-green deployments.
 * Ensures atomic alias updates and provides rollback capabilities.
 *
 * Key Features:
 * - Atomic alias switching (all-or-nothing)
 * - Multi-alias support (read/write separation)
 * - Rollback capability with history tracking
 * - Validation before switching
 * - Traffic routing control
 */

import { Client } from '@opensearch-project/opensearch';
import { Logger } from './logger';

const logger = new Logger('AliasManager');

/**
 * Alias Configuration
 */
export interface AliasConfig {
  name: string;
  isWriteIndex?: boolean; // For write operations
  routing?: string; // Custom routing
  filter?: any; // Filtered alias
}

/**
 * Index Alias Mapping
 */
export interface IndexAliasMapping {
  indexName: string;
  aliases: AliasConfig[];
}

/**
 * Alias Switch History
 */
export interface AliasSwitchHistory {
  timestamp: Date;
  aliasName: string;
  fromIndex: string;
  toIndex: string;
  success: boolean;
  error?: string;
}

/**
 * OpenSearch Alias Manager
 */
export class OpenSearchAliasManager {
  private client: Client;
  private history: AliasSwitchHistory[] = [];

  constructor(client: Client) {
    this.client = client;
  }

  /**
   * Get current alias mappings
   */
  async getAliases(aliasName?: string): Promise<Map<string, string[]>> {
    try {
      const params = aliasName ? { name: aliasName } : {};
      const response = await this.client.cat.aliases({
        ...params,
        format: 'json',
      });

      const aliasMap = new Map<string, string[]>();

      for (const alias of response.body) {
        const indexName = alias.index;
        const aliasNameStr = alias.alias;

        if (!aliasMap.has(aliasNameStr)) {
          aliasMap.set(aliasNameStr, []);
        }

        aliasMap.get(aliasNameStr)!.push(indexName);
      }

      logger.info('Retrieved alias mappings', {
        aliases: Object.fromEntries(aliasMap),
      });

      return aliasMap;
    } catch (error: any) {
      logger.error('Failed to get aliases', { error: error.message });
      throw error;
    }
  }

  /**
   * Atomic alias switch for Blue-Green deployment
   *
   * @description
   * Performs an atomic switch of an alias from one index to another.
   * This is the core operation for zero-downtime deployments.
   *
   * Example:
   * - Before: file-index -> file-index-v1 (blue)
   * - After:  file-index -> file-index-v2 (green)
   */
  async switchAlias(
    aliasName: string,
    fromIndex: string,
    toIndex: string,
    validate = true
  ): Promise<boolean> {
    const startTime = Date.now();

    try {
      logger.info('Starting alias switch', {
        alias: aliasName,
        from: fromIndex,
        to: toIndex,
      });

      // Validation phase
      if (validate) {
        await this.validateAliasSwitch(aliasName, fromIndex, toIndex);
      }

      // Atomic update using updateAliases API
      const actions = [
        // Remove alias from old index
        {
          remove: {
            index: fromIndex,
            alias: aliasName,
          },
        },
        // Add alias to new index
        {
          add: {
            index: toIndex,
            alias: aliasName,
          },
        },
      ];

      await this.client.indices.updateAliases({
        body: { actions },
      });

      const duration = Date.now() - startTime;

      logger.info('Alias switched successfully', {
        alias: aliasName,
        from: fromIndex,
        to: toIndex,
        duration,
      });

      // Record in history
      this.history.push({
        timestamp: new Date(),
        aliasName,
        fromIndex,
        toIndex,
        success: true,
      });

      return true;
    } catch (error: any) {
      logger.error('Alias switch failed', {
        alias: aliasName,
        error: error.message,
      });

      // Record failure in history
      this.history.push({
        timestamp: new Date(),
        aliasName,
        fromIndex,
        toIndex,
        success: false,
        error: error.message,
      });

      throw error;
    }
  }

  /**
   * Validate alias switch preconditions
   */
  private async validateAliasSwitch(
    aliasName: string,
    fromIndex: string,
    toIndex: string
  ): Promise<void> {
    // Check if fromIndex exists
    const fromExists = await this.client.indices.exists({
      index: fromIndex,
    });

    if (!fromExists.body) {
      throw new Error(`Source index '${fromIndex}' does not exist`);
    }

    // Check if toIndex exists
    const toExists = await this.client.indices.exists({
      index: toIndex,
    });

    if (!toExists.body) {
      throw new Error(`Target index '${toIndex}' does not exist`);
    }

    // Check if alias currently points to fromIndex
    const aliases = await this.client.indices.getAlias({
      index: fromIndex,
      name: aliasName,
    });

    if (!aliases.body[fromIndex]?.aliases?.[aliasName]) {
      logger.warn('Alias not found on source index', {
        alias: aliasName,
        index: fromIndex,
      });
      // Note: This is a warning, not an error - alias might not exist yet
    }

    logger.info('Alias switch validation passed');
  }

  /**
   * Create multiple aliases on a single index
   *
   * @description
   * Useful for read/write separation:
   * - file-index-read -> file-index-v2 (for search queries)
   * - file-index-write -> file-index-v2 (for indexing)
   */
  async createAliases(
    indexName: string,
    aliases: AliasConfig[]
  ): Promise<boolean> {
    try {
      const actions = aliases.map((alias) => ({
        add: {
          index: indexName,
          alias: alias.name,
          is_write_index: alias.isWriteIndex,
          routing: alias.routing,
          filter: alias.filter,
        },
      }));

      await this.client.indices.updateAliases({
        body: { actions },
      });

      logger.info('Created aliases', {
        index: indexName,
        aliases: aliases.map((a) => a.name),
      });

      return true;
    } catch (error: any) {
      logger.error('Failed to create aliases', { error: error.message });
      throw error;
    }
  }

  /**
   * Remove alias from index
   */
  async removeAlias(indexName: string, aliasName: string): Promise<boolean> {
    try {
      await this.client.indices.deleteAlias({
        index: indexName,
        name: aliasName,
      });

      logger.info('Removed alias', {
        index: indexName,
        alias: aliasName,
      });

      return true;
    } catch (error: any) {
      logger.error('Failed to remove alias', { error: error.message });
      throw error;
    }
  }

  /**
   * Gradual Traffic Shifting (Canary Deployment)
   *
   * @description
   * Gradually shift traffic from blue to green by creating
   * filtered aliases based on percentage.
   *
   * Example:
   * - 10% traffic to green (user_id % 10 == 0)
   * - 50% traffic to green (user_id % 2 == 0)
   * - 100% traffic to green (all users)
   */
  async gradualShift(
    aliasName: string,
    blueIndex: string,
    greenIndex: string,
    greenPercentage: number
  ): Promise<boolean> {
    if (greenPercentage < 0 || greenPercentage > 100) {
      throw new Error('Percentage must be between 0 and 100');
    }

    try {
      logger.info('Starting gradual traffic shift', {
        alias: aliasName,
        blue: blueIndex,
        green: greenIndex,
        greenPercentage,
      });

      // Remove existing alias
      await this.client.indices.updateAliases({
        body: {
          actions: [
            {
              remove: {
                index: blueIndex,
                alias: aliasName,
              },
            },
            {
              remove: {
                index: greenIndex,
                alias: aliasName,
              },
            },
          ],
        },
      });

      // Add filtered aliases based on percentage
      const actions: any[] = [];

      if (greenPercentage === 100) {
        // Full cutover to green
        actions.push({
          add: {
            index: greenIndex,
            alias: aliasName,
          },
        });
      } else if (greenPercentage === 0) {
        // Full traffic to blue
        actions.push({
          add: {
            index: blueIndex,
            alias: aliasName,
          },
        });
      } else {
        // Split traffic using modulo on document ID
        const modulo = Math.round(100 / greenPercentage);

        actions.push(
          {
            add: {
              index: greenIndex,
              alias: aliasName,
              filter: {
                script: {
                  script: {
                    source: `doc['_id'].value.hashCode() % ${modulo} == 0`,
                  },
                },
              },
            },
          },
          {
            add: {
              index: blueIndex,
              alias: aliasName,
              filter: {
                script: {
                  script: {
                    source: `doc['_id'].value.hashCode() % ${modulo} != 0`,
                  },
                },
              },
            },
          }
        );
      }

      await this.client.indices.updateAliases({
        body: { actions },
      });

      logger.info('Gradual shift completed', {
        greenPercentage,
      });

      return true;
    } catch (error: any) {
      logger.error('Gradual shift failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Rollback to previous alias configuration
   */
  async rollback(aliasName: string): Promise<boolean> {
    // Find last successful switch for this alias
    const lastSwitch = this.history
      .filter((h) => h.aliasName === aliasName && h.success)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())[0];

    if (!lastSwitch) {
      throw new Error(`No rollback history found for alias '${aliasName}'`);
    }

    logger.warn('Rolling back alias', {
      alias: aliasName,
      to: lastSwitch.fromIndex,
      from: lastSwitch.toIndex,
    });

    // Switch back to previous index
    return this.switchAlias(
      aliasName,
      lastSwitch.toIndex,
      lastSwitch.fromIndex,
      false // Skip validation during rollback
    );
  }

  /**
   * Get switch history
   */
  getHistory(): AliasSwitchHistory[] {
    return [...this.history];
  }

  /**
   * Get latest alias configuration for an index
   */
  async getIndexAliases(indexName: string): Promise<AliasConfig[]> {
    try {
      const response = await this.client.indices.getAlias({
        index: indexName,
      });

      const aliasesObj = response.body[indexName]?.aliases || {};
      const aliases: AliasConfig[] = [];

      for (const [aliasName, config] of Object.entries(aliasesObj)) {
        aliases.push({
          name: aliasName,
          isWriteIndex: (config as any).is_write_index,
          routing: (config as any).routing,
          filter: (config as any).filter,
        });
      }

      return aliases;
    } catch (error: any) {
      logger.error('Failed to get index aliases', { error: error.message });
      throw error;
    }
  }

  /**
   * Verify alias points to expected index
   */
  async verifyAlias(aliasName: string, expectedIndex: string): Promise<boolean> {
    try {
      const aliasMap = await this.getAliases(aliasName);
      const indices = aliasMap.get(aliasName) || [];

      const isValid = indices.includes(expectedIndex);

      if (!isValid) {
        logger.warn('Alias verification failed', {
          alias: aliasName,
          expected: expectedIndex,
          actual: indices,
        });
      }

      return isValid;
    } catch (error: any) {
      logger.error('Alias verification error', { error: error.message });
      return false;
    }
  }
}

/**
 * Alias Strategy Patterns
 */
export class AliasStrategyPatterns {
  /**
   * Read/Write Separation Pattern
   *
   * @description
   * Create separate aliases for read and write operations.
   * Useful for:
   * - Directing writes to a single index
   * - Load-balancing reads across replicas
   * - Testing new index with read traffic before enabling writes
   */
  static readWriteSeparation(indexName: string): AliasConfig[] {
    return [
      {
        name: 'file-index-read',
        isWriteIndex: false,
      },
      {
        name: 'file-index-write',
        isWriteIndex: true,
      },
      {
        name: 'file-index', // General purpose
        isWriteIndex: true,
      },
    ];
  }

  /**
   * Time-Based Routing Pattern
   *
   * @description
   * Route queries to different indices based on time ranges.
   * Useful for:
   * - Hot/Cold architecture
   * - Archiving old data
   */
  static timeBasedRouting(
    hotIndex: string,
    coldIndex: string,
    cutoffDate: Date
  ): IndexAliasMapping[] {
    return [
      {
        indexName: hotIndex,
        aliases: [
          {
            name: 'file-index',
            filter: {
              range: {
                indexed_at: {
                  gte: cutoffDate.toISOString(),
                },
              },
            },
          },
        ],
      },
      {
        indexName: coldIndex,
        aliases: [
          {
            name: 'file-index',
            filter: {
              range: {
                indexed_at: {
                  lt: cutoffDate.toISOString(),
                },
              },
            },
          },
        ],
      },
    ];
  }

  /**
   * Tenant Isolation Pattern
   *
   * @description
   * Create filtered aliases per tenant for multi-tenancy.
   */
  static tenantIsolation(
    indexName: string,
    tenantId: string
  ): AliasConfig[] {
    return [
      {
        name: `file-index-tenant-${tenantId}`,
        filter: {
          term: {
            tenant_id: tenantId,
          },
        },
        routing: tenantId, // Route to specific shard
      },
    ];
  }
}
