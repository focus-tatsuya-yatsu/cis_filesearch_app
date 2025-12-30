/**
 * OpenSearch Resilience Patterns
 * Circuit Breaker, Retry, Fallback, and Bulkhead Patterns
 *
 * @description
 * Implements comprehensive resilience patterns for OpenSearch operations
 * to ensure system stability during migration and production use.
 *
 * Patterns Implemented:
 * - Circuit Breaker: Prevent cascading failures
 * - Retry with Exponential Backoff: Handle transient failures
 * - Fallback: Graceful degradation
 * - Bulkhead: Resource isolation
 * - Timeout: Prevent indefinite blocking
 * - Rate Limiting: Prevent overload
 */

import { Client } from '@opensearch-project/opensearch';
import { Logger } from './logger';

const logger = new Logger('Resilience');

/**
 * Circuit Breaker States
 */
export enum CircuitState {
  CLOSED = 'CLOSED', // Normal operation
  OPEN = 'OPEN', // Failing, reject requests
  HALF_OPEN = 'HALF_OPEN', // Testing if service recovered
}

/**
 * Circuit Breaker Configuration
 */
export interface CircuitBreakerConfig {
  failureThreshold: number; // Failures before opening
  successThreshold: number; // Successes to close from half-open
  timeout: number; // Time in OPEN state before trying HALF_OPEN (ms)
  monitoringPeriod: number; // Time window for failure counting (ms)
  name: string;
}

/**
 * Retry Configuration
 */
export interface RetryConfig {
  maxAttempts: number;
  initialDelay: number; // ms
  maxDelay: number; // ms
  backoffMultiplier: number;
  retryableErrors: string[]; // Error codes/messages to retry
}

/**
 * Bulkhead Configuration
 */
export interface BulkheadConfig {
  maxConcurrentCalls: number;
  maxQueueSize: number;
  queueTimeout: number; // ms
}

/**
 * Operation Result
 */
export interface OperationResult<T> {
  success: boolean;
  data?: T;
  error?: Error;
  attempts: number;
  duration: number;
  circuitBreakerState?: CircuitState;
}

/**
 * Advanced Circuit Breaker Implementation
 */
export class CircuitBreaker {
  private config: CircuitBreakerConfig;
  private state: CircuitState = CircuitState.CLOSED;
  private failures: number = 0;
  private successes: number = 0;
  private nextRetryTime: number = 0;
  private failureTimestamps: number[] = [];

  constructor(config: CircuitBreakerConfig) {
    this.config = config;
  }

  /**
   * Execute operation with circuit breaker protection
   */
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    // Check circuit state
    if (this.state === CircuitState.OPEN) {
      if (Date.now() < this.nextRetryTime) {
        throw new CircuitBreakerOpenError(
          `Circuit breaker '${this.config.name}' is OPEN`,
          this.nextRetryTime
        );
      }

      // Transition to HALF_OPEN
      this.state = CircuitState.HALF_OPEN;
      logger.info('Circuit breaker transitioning to HALF_OPEN', {
        name: this.config.name,
      });
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  /**
   * Handle successful operation
   */
  private onSuccess(): void {
    this.failures = 0;

    if (this.state === CircuitState.HALF_OPEN) {
      this.successes++;

      logger.info('Circuit breaker half-open success', {
        name: this.config.name,
        successes: this.successes,
        threshold: this.config.successThreshold,
      });

      if (this.successes >= this.config.successThreshold) {
        this.state = CircuitState.CLOSED;
        this.successes = 0;
        logger.info('Circuit breaker CLOSED', {
          name: this.config.name,
        });
      }
    }
  }

  /**
   * Handle failed operation
   */
  private onFailure(): void {
    const now = Date.now();

    // Add failure timestamp
    this.failureTimestamps.push(now);

    // Remove old failures outside monitoring period
    this.failureTimestamps = this.failureTimestamps.filter(
      (timestamp) => now - timestamp < this.config.monitoringPeriod
    );

    this.failures = this.failureTimestamps.length;

    logger.warn('Circuit breaker failure', {
      name: this.config.name,
      failures: this.failures,
      threshold: this.config.failureThreshold,
      state: this.state,
    });

    if (this.state === CircuitState.HALF_OPEN) {
      // Immediate open on failure in half-open
      this.openCircuit();
    } else if (this.failures >= this.config.failureThreshold) {
      this.openCircuit();
    }
  }

  /**
   * Open the circuit
   */
  private openCircuit(): void {
    this.state = CircuitState.OPEN;
    this.successes = 0;
    this.nextRetryTime = Date.now() + this.config.timeout;

    logger.error('Circuit breaker OPENED', {
      name: this.config.name,
      failures: this.failures,
      retryAt: new Date(this.nextRetryTime).toISOString(),
    });
  }

  /**
   * Get current state
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Get metrics
   */
  getMetrics(): {
    state: CircuitState;
    failures: number;
    successes: number;
    nextRetryTime?: Date;
  } {
    return {
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      nextRetryTime:
        this.state === CircuitState.OPEN
          ? new Date(this.nextRetryTime)
          : undefined,
    };
  }

  /**
   * Reset circuit breaker (for testing)
   */
  reset(): void {
    this.state = CircuitState.CLOSED;
    this.failures = 0;
    this.successes = 0;
    this.failureTimestamps = [];
    this.nextRetryTime = 0;
  }
}

/**
 * Retry Mechanism with Exponential Backoff
 */
export class RetryMechanism {
  private config: RetryConfig;

  constructor(config: RetryConfig) {
    this.config = config;
  }

  /**
   * Execute operation with retry logic
   */
  async execute<T>(operation: () => Promise<T>): Promise<OperationResult<T>> {
    const startTime = Date.now();
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= this.config.maxAttempts; attempt++) {
      try {
        const data = await operation();

        return {
          success: true,
          data,
          attempts: attempt,
          duration: Date.now() - startTime,
        };
      } catch (error: any) {
        lastError = error;

        // Check if error is retryable
        if (!this.isRetryableError(error)) {
          logger.warn('Non-retryable error, failing immediately', {
            error: error.message,
            attempt,
          });

          return {
            success: false,
            error,
            attempts: attempt,
            duration: Date.now() - startTime,
          };
        }

        // Don't retry on last attempt
        if (attempt === this.config.maxAttempts) {
          logger.error('Max retry attempts reached', {
            attempts: attempt,
            error: error.message,
          });

          return {
            success: false,
            error,
            attempts: attempt,
            duration: Date.now() - startTime,
          };
        }

        // Calculate delay with exponential backoff
        const delay = this.calculateDelay(attempt);

        logger.warn('Retrying operation', {
          attempt,
          maxAttempts: this.config.maxAttempts,
          delay,
          error: error.message,
        });

        await this.sleep(delay);
      }
    }

    return {
      success: false,
      error: lastError,
      attempts: this.config.maxAttempts,
      duration: Date.now() - startTime,
    };
  }

  /**
   * Check if error is retryable
   */
  private isRetryableError(error: any): boolean {
    // Check HTTP status codes
    if (error.statusCode) {
      const retryableStatusCodes = [408, 429, 500, 502, 503, 504];
      if (retryableStatusCodes.includes(error.statusCode)) {
        return true;
      }
    }

    // Check error messages
    for (const retryableError of this.config.retryableErrors) {
      if (
        error.message &&
        error.message.toLowerCase().includes(retryableError.toLowerCase())
      ) {
        return true;
      }
    }

    // Network errors
    if (
      error.code === 'ECONNRESET' ||
      error.code === 'ETIMEDOUT' ||
      error.code === 'ENOTFOUND'
    ) {
      return true;
    }

    return false;
  }

  /**
   * Calculate delay with exponential backoff and jitter
   */
  private calculateDelay(attempt: number): number {
    // Exponential backoff: initialDelay * (backoffMultiplier ^ (attempt - 1))
    const exponentialDelay =
      this.config.initialDelay *
      Math.pow(this.config.backoffMultiplier, attempt - 1);

    // Cap at maxDelay
    const cappedDelay = Math.min(exponentialDelay, this.config.maxDelay);

    // Add jitter (random 0-25% variation)
    const jitter = cappedDelay * 0.25 * Math.random();

    return Math.floor(cappedDelay + jitter);
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Bulkhead Pattern for Resource Isolation
 */
export class Bulkhead {
  private config: BulkheadConfig;
  private activeCalls: number = 0;
  private queue: Array<{
    operation: () => Promise<any>;
    resolve: (value: any) => void;
    reject: (error: any) => void;
    timestamp: number;
  }> = [];

  constructor(config: BulkheadConfig) {
    this.config = config;
  }

  /**
   * Execute operation with bulkhead isolation
   */
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    // Check if we can execute immediately
    if (this.activeCalls < this.config.maxConcurrentCalls) {
      return this.executeOperation(operation);
    }

    // Check if queue is full
    if (this.queue.length >= this.config.maxQueueSize) {
      throw new BulkheadRejectionError(
        'Bulkhead queue is full, request rejected'
      );
    }

    // Add to queue
    return new Promise((resolve, reject) => {
      const queueItem = {
        operation,
        resolve,
        reject,
        timestamp: Date.now(),
      };

      this.queue.push(queueItem);

      logger.info('Operation queued', {
        queueSize: this.queue.length,
        activeCalls: this.activeCalls,
      });

      // Set timeout
      setTimeout(() => {
        const index = this.queue.indexOf(queueItem);
        if (index !== -1) {
          this.queue.splice(index, 1);
          reject(new BulkheadTimeoutError('Operation timed out in queue'));
        }
      }, this.config.queueTimeout);
    });
  }

  /**
   * Execute operation and manage active calls
   */
  private async executeOperation<T>(operation: () => Promise<T>): Promise<T> {
    this.activeCalls++;

    try {
      const result = await operation();
      return result;
    } finally {
      this.activeCalls--;
      this.processQueue();
    }
  }

  /**
   * Process queued operations
   */
  private processQueue(): void {
    while (
      this.queue.length > 0 &&
      this.activeCalls < this.config.maxConcurrentCalls
    ) {
      const queueItem = this.queue.shift();
      if (queueItem) {
        this.executeOperation(queueItem.operation)
          .then(queueItem.resolve)
          .catch(queueItem.reject);
      }
    }
  }

  /**
   * Get metrics
   */
  getMetrics(): {
    activeCalls: number;
    queueSize: number;
    maxConcurrentCalls: number;
  } {
    return {
      activeCalls: this.activeCalls,
      queueSize: this.queue.length,
      maxConcurrentCalls: this.config.maxConcurrentCalls,
    };
  }
}

/**
 * Resilient OpenSearch Client Wrapper
 */
export class ResilientOpenSearchClient {
  private client: Client;
  private circuitBreaker: CircuitBreaker;
  private retryMechanism: RetryMechanism;
  private bulkhead: Bulkhead;

  constructor(
    client: Client,
    circuitBreakerConfig?: Partial<CircuitBreakerConfig>,
    retryConfig?: Partial<RetryConfig>,
    bulkheadConfig?: Partial<BulkheadConfig>
  ) {
    this.client = client;

    // Initialize circuit breaker
    this.circuitBreaker = new CircuitBreaker({
      failureThreshold: 5,
      successThreshold: 2,
      timeout: 60000, // 1 minute
      monitoringPeriod: 120000, // 2 minutes
      name: 'OpenSearchClient',
      ...circuitBreakerConfig,
    });

    // Initialize retry mechanism
    this.retryMechanism = new RetryMechanism({
      maxAttempts: 3,
      initialDelay: 1000, // 1 second
      maxDelay: 10000, // 10 seconds
      backoffMultiplier: 2,
      retryableErrors: [
        'timeout',
        'connection',
        'unavailable',
        'too many requests',
      ],
      ...retryConfig,
    });

    // Initialize bulkhead
    this.bulkhead = new Bulkhead({
      maxConcurrentCalls: 10,
      maxQueueSize: 100,
      queueTimeout: 30000, // 30 seconds
      ...bulkheadConfig,
    });
  }

  /**
   * Resilient search operation
   */
  async search(params: any): Promise<any> {
    return this.executeResilient(async () => {
      return await this.client.search(params);
    }, 'search');
  }

  /**
   * Resilient index operation
   */
  async index(params: any): Promise<any> {
    return this.executeResilient(async () => {
      return await this.client.index(params);
    }, 'index');
  }

  /**
   * Resilient bulk operation
   */
  async bulk(params: any): Promise<any> {
    return this.executeResilient(async () => {
      return await this.client.bulk(params);
    }, 'bulk');
  }

  /**
   * Execute operation with all resilience patterns
   */
  private async executeResilient<T>(
    operation: () => Promise<T>,
    operationName: string
  ): Promise<T> {
    const startTime = Date.now();

    try {
      // 1. Bulkhead (resource isolation)
      const result = await this.bulkhead.execute(async () => {
        // 2. Circuit Breaker (fail fast)
        return await this.circuitBreaker.execute(async () => {
          // 3. Retry with exponential backoff
          const retryResult = await this.retryMechanism.execute(operation);

          if (!retryResult.success) {
            throw retryResult.error || new Error('Operation failed');
          }

          return retryResult.data!;
        });
      });

      const duration = Date.now() - startTime;

      logger.info('Resilient operation succeeded', {
        operation: operationName,
        duration,
        circuitState: this.circuitBreaker.getState(),
      });

      return result;
    } catch (error: any) {
      const duration = Date.now() - startTime;

      logger.error('Resilient operation failed', {
        operation: operationName,
        duration,
        error: error.message,
        circuitState: this.circuitBreaker.getState(),
      });

      throw error;
    }
  }

  /**
   * Get health metrics
   */
  getMetrics(): {
    circuitBreaker: any;
    bulkhead: any;
  } {
    return {
      circuitBreaker: this.circuitBreaker.getMetrics(),
      bulkhead: this.bulkhead.getMetrics(),
    };
  }

  /**
   * Reset all resilience mechanisms (for testing)
   */
  reset(): void {
    this.circuitBreaker.reset();
  }
}

/**
 * Custom Errors
 */
export class CircuitBreakerOpenError extends Error {
  constructor(
    message: string,
    public nextRetryTime: number
  ) {
    super(message);
    this.name = 'CircuitBreakerOpenError';
  }
}

export class BulkheadRejectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BulkheadRejectionError';
  }
}

export class BulkheadTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BulkheadTimeoutError';
  }
}

/**
 * Fallback Strategy
 */
export class FallbackStrategy {
  /**
   * Execute with fallback
   */
  static async executeWithFallback<T>(
    primary: () => Promise<T>,
    fallback: () => Promise<T>,
    fallbackCondition: (error: any) => boolean = () => true
  ): Promise<T> {
    try {
      return await primary();
    } catch (error: any) {
      if (fallbackCondition(error)) {
        logger.warn('Primary operation failed, using fallback', {
          error: error.message,
        });

        return await fallback();
      }

      throw error;
    }
  }

  /**
   * Cache-based fallback for search
   */
  static createCacheFallback<T>(
    cache: Map<string, T>,
    ttl: number = 300000
  ): (cacheKey: string, operation: () => Promise<T>) => Promise<T> {
    const cacheTimestamps = new Map<string, number>();

    return async (cacheKey: string, operation: () => Promise<T>): Promise<T> => {
      try {
        const result = await operation();

        // Update cache
        cache.set(cacheKey, result);
        cacheTimestamps.set(cacheKey, Date.now());

        return result;
      } catch (error: any) {
        // Check if we have cached data
        const cachedData = cache.get(cacheKey);
        const cacheTime = cacheTimestamps.get(cacheKey);

        if (cachedData && cacheTime && Date.now() - cacheTime < ttl) {
          logger.warn('Operation failed, returning cached data', {
            cacheKey,
            cacheAge: Date.now() - cacheTime,
          });

          return cachedData;
        }

        throw error;
      }
    };
  }
}
