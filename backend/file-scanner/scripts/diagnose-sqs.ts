#!/usr/bin/env ts-node
/**
 * SQS Queue Diagnostics Script
 * SQSキューの状態を診断し、ボトルネックを特定する
 */

import * as dotenv from 'dotenv';
import { SQSPublisher } from '../src/services/SQSPublisher';
import { AWSConfig } from '../src/types';
import { createLogger } from '../src/utils/logger';

dotenv.config();

const logger = createLogger('SQS-Diagnostics');

async function diagnoseSQS() {
  logger.info('========================================');
  logger.info('SQS Queue Diagnostics');
  logger.info('========================================');

  const awsConfig: AWSConfig = {
    region: process.env.AWS_REGION || 'ap-northeast-1',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    s3: {
      bucket: process.env.S3_BUCKET_NAME || 'cis-filesearch-landing',
      uploadConcurrency: 10,
      multipartThreshold: 100,
      chunkSize: 10
    },
    sqs: {
      queueUrl: process.env.SQS_QUEUE_URL || '',
      dlqUrl: process.env.SQS_DLQ_URL
    }
  };

  if (!awsConfig.sqs.queueUrl) {
    logger.error('SQS_QUEUE_URL is not set');
    process.exit(1);
  }

  try {
    const publisher = new SQSPublisher({
      awsConfig,
      dryRun: false
    });

    // キューメトリクスを取得
    const metrics = await publisher.getQueueMetrics();

    logger.info('\n📊 Queue Metrics:');
    logger.info(`  Messages in Queue: ${metrics.approximateNumberOfMessages}`);
    logger.info(`  Messages in Flight: ${metrics.approximateNumberOfMessagesNotVisible}`);
    logger.info(`  Messages Delayed: ${metrics.approximateNumberOfMessagesDelayed}`);

    // 処理速度の計算
    const totalMessages = metrics.approximateNumberOfMessages +
                         metrics.approximateNumberOfMessagesNotVisible;

    logger.info('\n⚠️ Analysis:');

    if (metrics.approximateNumberOfMessages > 1000) {
      logger.warn(`  High backlog detected: ${metrics.approximateNumberOfMessages} messages`);
      logger.warn('  Recommendation: Increase python-worker instances');
    } else if (metrics.approximateNumberOfMessages > 100) {
      logger.warn(`  Moderate backlog: ${metrics.approximateNumberOfMessages} messages`);
      logger.warn('  Recommendation: Monitor worker processing speed');
    } else {
      logger.info(`  ✅ Queue is healthy: ${metrics.approximateNumberOfMessages} messages`);
    }

    if (metrics.approximateNumberOfMessagesNotVisible > 500) {
      logger.warn(`  High in-flight messages: ${metrics.approximateNumberOfMessagesNotVisible}`);
      logger.warn('  Possible issue: Workers not deleting messages after processing');
    }

    // DLQ確認
    if (awsConfig.sqs.dlqUrl) {
      logger.info('\n🔴 Checking Dead Letter Queue...');
      const dlqPublisher = new SQSPublisher({
        awsConfig: {
          ...awsConfig,
          sqs: {
            queueUrl: awsConfig.sqs.dlqUrl,
            dlqUrl: undefined
          }
        },
        dryRun: false
      });

      const dlqMetrics = await dlqPublisher.getQueueMetrics();
      logger.info(`  DLQ Messages: ${dlqMetrics.approximateNumberOfMessages}`);

      if (dlqMetrics.approximateNumberOfMessages > 0) {
        logger.error('  ⚠️ Failed messages detected in DLQ!');
        logger.error('  Action required: Investigate and reprocess failed messages');
      } else {
        logger.info('  ✅ No failed messages in DLQ');
      }

      await dlqPublisher.cleanup();
    }

    // 統計情報
    const stats = publisher.getStatistics();
    logger.info('\n📈 Publisher Statistics:');
    logger.info(`  Published: ${stats.publishedCount}`);
    logger.info(`  Failed: ${stats.failedCount}`);
    logger.info(`  Queued: ${stats.queuedCount}`);

    // 推奨アクション
    logger.info('\n💡 Recommendations:');

    const backlog = metrics.approximateNumberOfMessages;
    const estimatedHours = backlog / (10 * 60); // 10 files/min

    if (backlog > 100) {
      logger.info('  1. Scale up python-worker instances:');
      logger.info(`     - Current backlog: ${backlog} messages`);
      logger.info(`     - Estimated time to clear (1 worker): ${estimatedHours.toFixed(1)} hours`);
      logger.info('     - Recommended: 4-8 worker instances');

      logger.info('\n  2. Enable batch processing in python-worker:');
      logger.info('     - Change sqs_max_messages from 1 to 10');
      logger.info('     - Implement bulk indexing in OpenSearch');

      logger.info('\n  3. Monitor CloudWatch Logs:');
      logger.info('     - Check for processing errors');
      logger.info('     - Verify OpenSearch connection');
    } else {
      logger.info('  ✅ System is operating normally');
    }

    await publisher.cleanup();

  } catch (error) {
    logger.error('Diagnostics failed:', error);
    process.exit(1);
  }
}

diagnoseSQS().catch(error => {
  logger.error('Fatal error:', error);
  process.exit(1);
});
