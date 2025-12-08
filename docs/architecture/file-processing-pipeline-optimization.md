# ファイル処理パイプライン最適化アーキテクチャ

## エグゼクティブサマリー

このドキュメントは、DocuWorks単一商用ライセンス制約下で500万ファイルを効率的に処理するための最適化アーキテクチャを提案します。

**主要な最適化ポイント:**
- ファイルタイプ別処理レーン分離による並列処理最大化
- DocuWorks専用インスタンスによるライセンス制約の管理
- スポットインスタンス活用による70%コスト削減
- インテリジェントバッチ処理による初期500万ファイル処理の高速化

---

## 1. 最適化アーキテクチャパターン

### 1.1 ファイルタイプ別処理レーン設計

```
┌─────────────────────────────────────────────────────────────────┐
│                      S3 Landing Bucket                          │
│                  (scan-upload-bucket)                           │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│              EventBridge Rule (S3 Object Created)               │
│              - ファイル拡張子でフィルタリング                      │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│          Lambda Router (file-type-router.ts)                    │
│          - ファイルメタデータ抽出                                  │
│          - ファイルタイプ判定・分類                                │
│          - 優先度設定（サイズ・日付）                              │
└───────────────────────────┬─────────────────────────────────────┘
                            │
            ┌───────────────┼───────────────┬────────────────┐
            ▼               ▼               ▼                ▼
     ┌──────────┐   ┌──────────┐   ┌──────────┐    ┌──────────┐
     │DocuWorks │   │   PDF    │   │  Office  │    │  Image   │
     │Queue.fifo│   │  Queue   │   │  Queue   │    │  Queue   │
     │(優先度高) │   │ (標準)   │   │ (標準)   │    │ (標準)   │
     └────┬─────┘   └────┬─────┘   └────┬─────┘    └────┬─────┘
          │              │              │               │
          ▼              ▼              ▼               ▼
     ┌──────────┐   ┌──────────┐   ┌──────────┐    ┌──────────┐
     │DocuWorks │   │   PDF    │   │  Office  │    │  Image   │
     │ Worker   │   │ Workers  │   │ Workers  │    │ Workers  │
     │  (1台)   │   │ (3-5台)  │   │ (2-3台)  │    │ (5-10台) │
     │オンデマンド│   │スポット  │   │スポット  │    │スポット  │
     └────┬─────┘   └────┬─────┘   └────┬─────┘    └────┬─────┘
          │              │              │               │
          └──────────────┴──────────────┴───────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│              Processing Results                                 │
│  - OpenSearch (全文検索インデックス)                              │
│  - S3 (抽出テキスト・メタデータ)                                  │
│  - AWS Bedrock (画像ベクトル)                                    │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 DocuWorksライセンス専用インスタンス設計

**重要原則: 1ライセンス = 1プロセス = 1インスタンス**

```typescript
// DocuWorks専用ワーカー設定
interface DocuWorksWorkerConfig {
  instanceType: 't3.xlarge' | 'c5.2xlarge'; // 4-8 vCPU
  instanceCount: 1; // ライセンス制約により固定
  purchaseOption: 'on-demand'; // 安定性重視
  processingStrategy: 'sequential-batch'; // シーケンシャルバッチ処理
  maxConcurrency: 1; // ライセンス制約
  batchSize: 100; // メッセージバッチサイズ
  visibilityTimeout: 900; // 15分（大きいファイル対応）
}

// DocuWorksワーカープロセス
class DocuWorksWorker {
  private isProcessing: boolean = false;
  private currentBatch: Message[] = [];

  async processBatch(): Promise<void> {
    // ライセンスロック取得（念のため）
    const lock = await this.acquireLicense();

    try {
      // バッチメッセージ取得（最大100件）
      this.currentBatch = await this.sqsClient.receiveMessageBatch({
        QueueUrl: DOCUWORKS_QUEUE_URL,
        MaxNumberOfMessages: 100,
        WaitTimeSeconds: 20 // ロングポーリング
      });

      // シーケンシャル処理（1ファイルずつ）
      for (const message of this.currentBatch) {
        await this.processDocuWorksFile(message);
        await this.deleteMessage(message);
      }
    } finally {
      await lock.release();
    }
  }

  private async processDocuWorksFile(message: Message): Promise<void> {
    const { s3Key, s3Bucket } = JSON.parse(message.Body);

    // S3からダウンロード
    const localPath = await this.downloadFromS3(s3Bucket, s3Key);

    // DocuWorks SDK処理（単一プロセス）
    const result = await this.docuWorksSDK.process({
      inputPath: localPath,
      operations: ['extract-text', 'extract-metadata', 'generate-thumbnail']
    });

    // OpenSearchへインデックス
    await this.indexToOpenSearch(result);

    // クリーンアップ
    await fs.unlink(localPath);
  }
}
```

---

## 2. 効率的なメッセージルーティング戦略

### 2.1 Lambda Routerの実装

```typescript
// file-type-router.ts
import { S3Event, EventBridgeEvent } from 'aws-lambda';
import { SQSClient, SendMessageCommand, SendMessageBatchCommand } from '@aws-sdk/client-sqs';

interface FileClassification {
  type: 'docuworks' | 'pdf' | 'office' | 'image';
  queueUrl: string;
  priority: number;
  estimatedProcessingTime: number;
}

export const handler = async (event: EventBridgeEvent<'Object Created', S3Event>) => {
  const sqsClient = new SQSClient({ region: 'ap-northeast-1' });

  const records = event.detail.object;
  const messages = [];

  for (const record of records) {
    const s3Key = record.key;
    const s3Bucket = record.bucket.name;
    const fileSize = record.size;
    const fileExtension = getFileExtension(s3Key);

    // ファイルタイプ分類
    const classification = classifyFile(fileExtension, fileSize);

    // メッセージ作成
    const message = {
      QueueUrl: classification.queueUrl,
      MessageBody: JSON.stringify({
        s3Bucket,
        s3Key,
        fileSize,
        fileType: classification.type,
        uploadedAt: new Date().toISOString(),
        priority: classification.priority
      }),
      MessageAttributes: {
        FileType: { DataType: 'String', StringValue: classification.type },
        FileSize: { DataType: 'Number', StringValue: fileSize.toString() },
        Priority: { DataType: 'Number', StringValue: classification.priority.toString() }
      }
    };

    // DocuWorks QueueはFIFOなので特別処理
    if (classification.type === 'docuworks') {
      message.MessageGroupId = 'docuworks-sequential';
      message.MessageDeduplicationId = `${s3Bucket}-${s3Key}-${Date.now()}`;
    }

    messages.push(message);
  }

  // バッチ送信（最大10件ずつ）
  await sendMessagesInBatches(sqsClient, messages);

  return {
    statusCode: 200,
    body: JSON.stringify({ processed: messages.length })
  };
};

function classifyFile(extension: string, size: number): FileClassification {
  const ext = extension.toLowerCase();

  // DocuWorks (最優先)
  if (ext === '.xdw' || ext === '.xbd') {
    return {
      type: 'docuworks',
      queueUrl: process.env.DOCUWORKS_QUEUE_URL!,
      priority: 1,
      estimatedProcessingTime: 30 // 秒
    };
  }

  // PDF
  if (ext === '.pdf') {
    return {
      type: 'pdf',
      queueUrl: process.env.PDF_QUEUE_URL!,
      priority: 2,
      estimatedProcessingTime: 10
    };
  }

  // Office (Word, Excel, PowerPoint)
  if (['.docx', '.xlsx', '.pptx', '.doc', '.xls', '.ppt'].includes(ext)) {
    return {
      type: 'office',
      queueUrl: process.env.OFFICE_QUEUE_URL!,
      priority: 3,
      estimatedProcessingTime: 15
    };
  }

  // 画像（デフォルト）
  return {
    type: 'image',
    queueUrl: process.env.IMAGE_QUEUE_URL!,
    priority: 4,
    estimatedProcessingTime: 5
  };
}

function getFileExtension(s3Key: string): string {
  const parts = s3Key.split('.');
  return parts.length > 1 ? `.${parts[parts.length - 1]}` : '';
}

async function sendMessagesInBatches(
  sqsClient: SQSClient,
  messages: any[]
): Promise<void> {
  const batchSize = 10;

  for (let i = 0; i < messages.length; i += batchSize) {
    const batch = messages.slice(i, i + batchSize);

    await sqsClient.send(new SendMessageBatchCommand({
      QueueUrl: batch[0].QueueUrl,
      Entries: batch.map((msg, index) => ({
        Id: `${index}`,
        MessageBody: msg.MessageBody,
        MessageAttributes: msg.MessageAttributes,
        ...(msg.MessageGroupId && { MessageGroupId: msg.MessageGroupId }),
        ...(msg.MessageDeduplicationId && { MessageDeduplicationId: msg.MessageDeduplicationId })
      }))
    }));
  }
}
```

### 2.2 SQSキュー構成

```typescript
// infrastructure/sqs-queues.ts
export const queueConfigurations = {
  docuworks: {
    QueueName: 'file-processing-docuworks.fifo',
    FifoQueue: true,
    ContentBasedDeduplication: true,
    MessageRetentionPeriod: 1209600, // 14日
    VisibilityTimeout: 900, // 15分
    ReceiveMessageWaitTimeSeconds: 20, // ロングポーリング
    DeduplicationScope: 'messageGroup',
    FifoThroughputLimit: 'perMessageGroupId',
    // Dead Letter Queue
    RedrivePolicy: {
      deadLetterTargetArn: 'arn:aws:sqs:ap-northeast-1:ACCOUNT:docuworks-dlq.fifo',
      maxReceiveCount: 3
    }
  },

  pdf: {
    QueueName: 'file-processing-pdf',
    FifoQueue: false,
    MessageRetentionPeriod: 1209600,
    VisibilityTimeout: 600, // 10分
    ReceiveMessageWaitTimeSeconds: 20,
    RedrivePolicy: {
      deadLetterTargetArn: 'arn:aws:sqs:ap-northeast-1:ACCOUNT:pdf-dlq',
      maxReceiveCount: 3
    }
  },

  office: {
    QueueName: 'file-processing-office',
    FifoQueue: false,
    MessageRetentionPeriod: 1209600,
    VisibilityTimeout: 600,
    ReceiveMessageWaitTimeSeconds: 20,
    RedrivePolicy: {
      deadLetterTargetArn: 'arn:aws:sqs:ap-northeast-1:ACCOUNT:office-dlq',
      maxReceiveCount: 3
    }
  },

  image: {
    QueueName: 'file-processing-image',
    FifoQueue: false,
    MessageRetentionPeriod: 1209600,
    VisibilityTimeout: 300, // 5分
    ReceiveMessageWaitTimeSeconds: 20,
    RedrivePolicy: {
      deadLetterTargetArn: 'arn:aws:sqs:ap-northeast-1:ACCOUNT:image-dlq',
      maxReceiveCount: 3
    }
  }
};
```

---

## 3. ワーカープロセスアーキテクチャ

### 3.1 マルチワーカー戦略

```typescript
// worker-orchestrator.ts
interface WorkerPoolConfig {
  docuworks: {
    minInstances: 1;
    maxInstances: 1; // ライセンス制約
    instanceType: 't3.xlarge';
    purchaseOption: 'on-demand';
    concurrency: 1;
  };
  pdf: {
    minInstances: 3;
    maxInstances: 10;
    instanceType: 'c5.xlarge';
    purchaseOption: 'spot';
    concurrency: 4; // CPUコア数
  };
  office: {
    minInstances: 2;
    maxInstances: 5;
    instanceType: 'c5.xlarge';
    purchaseOption: 'spot';
    concurrency: 4;
  };
  image: {
    minInstances: 5;
    maxInstances: 20;
    instanceType: 'c5.2xlarge';
    purchaseOption: 'spot';
    concurrency: 8;
  };
}

// 汎用ワーカーベースクラス
abstract class BaseWorker {
  protected queueUrl: string;
  protected concurrency: number;
  protected sqsClient: SQSClient;
  protected isShuttingDown: boolean = false;

  constructor(queueUrl: string, concurrency: number) {
    this.queueUrl = queueUrl;
    this.concurrency = concurrency;
    this.sqsClient = new SQSClient({ region: 'ap-northeast-1' });

    // グレースフルシャットダウン
    process.on('SIGTERM', () => this.shutdown());
  }

  async start(): Promise<void> {
    console.log(`Worker started: ${this.constructor.name}`);

    while (!this.isShuttingDown) {
      try {
        await this.pollAndProcess();
      } catch (error) {
        console.error('Worker error:', error);
        await this.sleep(5000); // エラー時は5秒待機
      }
    }
  }

  protected async pollAndProcess(): Promise<void> {
    const messages = await this.sqsClient.send(new ReceiveMessageCommand({
      QueueUrl: this.queueUrl,
      MaxNumberOfMessages: this.concurrency,
      WaitTimeSeconds: 20,
      MessageAttributeNames: ['All']
    }));

    if (!messages.Messages || messages.Messages.length === 0) {
      return;
    }

    // 並列処理
    await Promise.all(
      messages.Messages.map(msg => this.processMessage(msg))
    );
  }

  protected abstract processMessage(message: Message): Promise<void>;

  protected async deleteMessage(message: Message): Promise<void> {
    await this.sqsClient.send(new DeleteMessageCommand({
      QueueUrl: this.queueUrl,
      ReceiptHandle: message.ReceiptHandle!
    }));
  }

  protected async extendVisibility(message: Message, seconds: number): Promise<void> {
    await this.sqsClient.send(new ChangeMessageVisibilityCommand({
      QueueUrl: this.queueUrl,
      ReceiptHandle: message.ReceiptHandle!,
      VisibilityTimeout: seconds
    }));
  }

  private async shutdown(): Promise<void> {
    console.log('Shutting down gracefully...');
    this.isShuttingDown = true;
    // 現在の処理が完了するまで待機
    await this.sleep(30000);
    process.exit(0);
  }

  protected sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
```

### 3.2 DocuWorksワーカー実装

```typescript
// docuworks-worker.ts
import { BaseWorker } from './base-worker';
import { DocuWorksSDK } from './docuworks-sdk';
import { Message } from '@aws-sdk/client-sqs';

class DocuWorksWorker extends BaseWorker {
  private sdk: DocuWorksSDK;
  private currentProcessingFile: string | null = null;

  constructor(queueUrl: string) {
    super(queueUrl, 1); // 並列度1（ライセンス制約）
    this.sdk = new DocuWorksSDK();
  }

  protected async processMessage(message: Message): Promise<void> {
    const startTime = Date.now();
    const payload = JSON.parse(message.Body!);
    const { s3Bucket, s3Key, fileSize } = payload;

    this.currentProcessingFile = s3Key;
    console.log(`Processing DocuWorks: ${s3Key} (${fileSize} bytes)`);

    try {
      // 大きいファイルの場合、Visibility Timeoutを延長
      if (fileSize > 50 * 1024 * 1024) { // 50MB以上
        await this.extendVisibility(message, 1800); // 30分
      }

      // S3からダウンロード
      const localPath = await this.downloadFromS3(s3Bucket, s3Key);

      // DocuWorks SDK処理
      const result = await this.sdk.process({
        inputPath: localPath,
        extractText: true,
        extractMetadata: true,
        generateThumbnail: true,
        outputFormat: 'json'
      });

      // 結果をOpenSearchとS3に保存
      await Promise.all([
        this.indexToOpenSearch({
          fileKey: s3Key,
          text: result.text,
          metadata: result.metadata,
          processedAt: new Date().toISOString()
        }),
        this.saveToS3({
          bucket: process.env.PROCESSED_BUCKET!,
          key: `docuworks/${s3Key}.json`,
          data: result
        })
      ]);

      // ローカルファイル削除
      await fs.unlink(localPath);

      // メトリクス送信
      await this.sendMetrics({
        fileType: 'docuworks',
        fileSize,
        processingTime: Date.now() - startTime,
        status: 'success'
      });

      // メッセージ削除
      await this.deleteMessage(message);

      console.log(`✓ Completed: ${s3Key} (${Date.now() - startTime}ms)`);

    } catch (error) {
      console.error(`✗ Failed: ${s3Key}`, error);

      // エラーメトリクス
      await this.sendMetrics({
        fileType: 'docuworks',
        fileSize,
        processingTime: Date.now() - startTime,
        status: 'error',
        errorMessage: error.message
      });

      // メッセージを再処理のためにキューに戻す（maxReceiveCount到達でDLQへ）
      throw error;
    } finally {
      this.currentProcessingFile = null;
    }
  }

  private async downloadFromS3(bucket: string, key: string): Promise<string> {
    const s3Client = new S3Client({ region: 'ap-northeast-1' });
    const localPath = `/tmp/${path.basename(key)}`;

    const response = await s3Client.send(new GetObjectCommand({
      Bucket: bucket,
      Key: key
    }));

    const writeStream = fs.createWriteStream(localPath);
    response.Body.pipe(writeStream);

    return new Promise((resolve, reject) => {
      writeStream.on('finish', () => resolve(localPath));
      writeStream.on('error', reject);
    });
  }

  private async indexToOpenSearch(data: any): Promise<void> {
    // OpenSearch実装
  }

  private async saveToS3(params: { bucket: string; key: string; data: any }): Promise<void> {
    // S3保存実装
  }

  private async sendMetrics(metrics: any): Promise<void> {
    // CloudWatch Metrics実装
  }
}

// ワーカー起動
const worker = new DocuWorksWorker(process.env.DOCUWORKS_QUEUE_URL!);
worker.start();
```

### 3.3 PDFワーカー実装（高並列処理）

```typescript
// pdf-worker.ts
import { BaseWorker } from './base-worker';
import { PDFExtractor } from './pdf-extractor';
import { Message } from '@aws-sdk/client-sqs';
import pLimit from 'p-limit';

class PDFWorker extends BaseWorker {
  private extractor: PDFExtractor;
  private limiter: any;

  constructor(queueUrl: string, concurrency: number = 4) {
    super(queueUrl, concurrency);
    this.extractor = new PDFExtractor();
    this.limiter = pLimit(concurrency);
  }

  protected async processMessage(message: Message): Promise<void> {
    return this.limiter(async () => {
      const payload = JSON.parse(message.Body!);
      const { s3Bucket, s3Key, fileSize } = payload;

      console.log(`Processing PDF: ${s3Key}`);

      try {
        // PDFテキスト抽出（pdf-parseまたはPDFBox）
        const localPath = await this.downloadFromS3(s3Bucket, s3Key);
        const result = await this.extractor.extract(localPath);

        // OpenSearchインデックス作成
        await this.indexToOpenSearch({
          fileKey: s3Key,
          text: result.text,
          pageCount: result.pageCount,
          metadata: result.metadata,
          processedAt: new Date().toISOString()
        });

        // クリーンアップ
        await fs.unlink(localPath);
        await this.deleteMessage(message);

        console.log(`✓ PDF Completed: ${s3Key}`);

      } catch (error) {
        console.error(`✗ PDF Failed: ${s3Key}`, error);
        throw error;
      }
    });
  }

  private async downloadFromS3(bucket: string, key: string): Promise<string> {
    // S3ダウンロード実装
  }

  private async indexToOpenSearch(data: any): Promise<void> {
    // OpenSearchインデックス実装
  }
}

const worker = new PDFWorker(
  process.env.PDF_QUEUE_URL!,
  parseInt(process.env.CONCURRENCY || '4')
);
worker.start();
```

---

## 4. メモリと リソース管理戦略

### 4.1 メモリ管理パターン

```typescript
// memory-manager.ts
import { EventEmitter } from 'events';

class MemoryManager extends EventEmitter {
  private maxMemoryMB: number;
  private checkInterval: number;
  private gcThresholdPercent: number;

  constructor(config: {
    maxMemoryMB: number;
    checkInterval?: number;
    gcThresholdPercent?: number;
  }) {
    super();
    this.maxMemoryMB = config.maxMemoryMB;
    this.checkInterval = config.checkInterval || 30000; // 30秒
    this.gcThresholdPercent = config.gcThresholdPercent || 80;

    this.startMonitoring();
  }

  private startMonitoring(): void {
    setInterval(() => {
      const usage = this.getMemoryUsage();

      if (usage.percentUsed > this.gcThresholdPercent) {
        console.warn(`Memory usage high: ${usage.percentUsed}%`);
        this.forceGarbageCollection();
        this.emit('high-memory', usage);
      }

      if (usage.percentUsed > 95) {
        console.error(`Memory critical: ${usage.percentUsed}%`);
        this.emit('critical-memory', usage);
        // 新規タスク停止
        this.emit('stop-processing');
      }
    }, this.checkInterval);
  }

  getMemoryUsage() {
    const memUsage = process.memoryUsage();
    const heapUsedMB = memUsage.heapUsed / 1024 / 1024;
    const percentUsed = (heapUsedMB / this.maxMemoryMB) * 100;

    return {
      heapUsedMB: Math.round(heapUsedMB),
      maxMemoryMB: this.maxMemoryMB,
      percentUsed: Math.round(percentUsed),
      rss: Math.round(memUsage.rss / 1024 / 1024),
      external: Math.round(memUsage.external / 1024 / 1024)
    };
  }

  private forceGarbageCollection(): void {
    if (global.gc) {
      console.log('Running garbage collection...');
      global.gc();
    }
  }
}

// ワーカーでの使用例
const memoryManager = new MemoryManager({
  maxMemoryMB: 60 * 1024, // 60GB（64GBインスタンスの場合）
  gcThresholdPercent: 75
});

memoryManager.on('high-memory', (usage) => {
  console.warn('High memory usage detected:', usage);
  // 処理速度を落とす
  worker.reduceConcurrency();
});

memoryManager.on('critical-memory', (usage) => {
  console.error('Critical memory usage:', usage);
  // 新規処理を停止
  worker.stopAcceptingNewTasks();
});
```

### 4.2 ディスクスペース管理

```typescript
// disk-manager.ts
import { execSync } from 'child_process';
import fs from 'fs/promises';

class DiskManager {
  private tmpDir: string;
  private maxDiskUsagePercent: number;

  constructor(tmpDir: string = '/tmp', maxDiskUsagePercent: number = 80) {
    this.tmpDir = tmpDir;
    this.maxDiskUsagePercent = maxDiskUsagePercent;
  }

  async checkDiskSpace(): Promise<{ available: boolean; usage: number }> {
    const dfOutput = execSync('df -h /tmp').toString();
    const lines = dfOutput.split('\n');
    const dataLine = lines[1];
    const parts = dataLine.split(/\s+/);
    const usagePercent = parseInt(parts[4].replace('%', ''));

    return {
      available: usagePercent < this.maxDiskUsagePercent,
      usage: usagePercent
    };
  }

  async cleanupOldFiles(olderThanMinutes: number = 30): Promise<number> {
    const files = await fs.readdir(this.tmpDir);
    const now = Date.now();
    let cleanedCount = 0;

    for (const file of files) {
      const filePath = `${this.tmpDir}/${file}`;
      const stats = await fs.stat(filePath);
      const ageMinutes = (now - stats.mtimeMs) / 1000 / 60;

      if (ageMinutes > olderThanMinutes) {
        await fs.unlink(filePath);
        cleanedCount++;
      }
    }

    return cleanedCount;
  }

  async ensureSpaceAvailable(): Promise<boolean> {
    const { available, usage } = await this.checkDiskSpace();

    if (!available) {
      console.warn(`Disk usage high: ${usage}%`);
      const cleaned = await this.cleanupOldFiles(15);
      console.log(`Cleaned ${cleaned} old files`);

      const { available: nowAvailable } = await this.checkDiskSpace();
      return nowAvailable;
    }

    return true;
  }
}

// ワーカーでの使用
const diskManager = new DiskManager();

async function processFile(s3Key: string) {
  // ディスクスペースチェック
  const spaceAvailable = await diskManager.ensureSpaceAvailable();

  if (!spaceAvailable) {
    throw new Error('Insufficient disk space');
  }

  // ファイル処理...
}
```

### 4.3 接続プール管理

```typescript
// connection-pool-manager.ts
import { OpenSearchClient } from '@opensearch-project/opensearch';
import { Pool } from 'pg';

class ConnectionPoolManager {
  private openSearchClient: OpenSearchClient;
  private pgPool: Pool;

  constructor() {
    // OpenSearch接続プール
    this.openSearchClient = new OpenSearchClient({
      node: process.env.OPENSEARCH_ENDPOINT,
      maxRetries: 3,
      requestTimeout: 60000,
      sniffOnStart: true,
      // 接続プール設定
      agent: {
        maxSockets: 50,
        keepAlive: true,
        keepAliveMsecs: 1000
      }
    });

    // PostgreSQL接続プール
    this.pgPool = new Pool({
      host: process.env.DB_HOST,
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      // プール設定
      max: 20, // 最大接続数
      min: 5,  // 最小接続数
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000
    });

    // プール監視
    this.monitorPools();
  }

  private monitorPools(): void {
    setInterval(() => {
      console.log('PG Pool Status:', {
        total: this.pgPool.totalCount,
        idle: this.pgPool.idleCount,
        waiting: this.pgPool.waitingCount
      });
    }, 60000); // 1分ごと
  }

  async bulkIndexToOpenSearch(documents: any[]): Promise<void> {
    const body = documents.flatMap(doc => [
      { index: { _index: 'files', _id: doc.fileKey } },
      doc
    ]);

    await this.openSearchClient.bulk({ body });
  }

  async executeQuery(query: string, params: any[]): Promise<any> {
    const client = await this.pgPool.connect();

    try {
      const result = await client.query(query, params);
      return result.rows;
    } finally {
      client.release();
    }
  }

  async shutdown(): Promise<void> {
    await this.pgPool.end();
    // OpenSearchクライアントのクローズ処理
  }
}
```

---

## 5. エラーリカバリと レジリエンスパターン

### 5.1 Dead Letter Queue (DLQ) 処理

```typescript
// dlq-processor.ts
import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';

class DLQProcessor {
  private sqsClient: SQSClient;
  private snsClient: SNSClient;
  private dlqUrl: string;
  private alertTopicArn: string;

  constructor(dlqUrl: string, alertTopicArn: string) {
    this.sqsClient = new SQSClient({ region: 'ap-northeast-1' });
    this.snsClient = new SNSClient({ region: 'ap-northeast-1' });
    this.dlqUrl = dlqUrl;
    this.alertTopicArn = alertTopicArn;
  }

  async processDLQ(): Promise<void> {
    while (true) {
      const messages = await this.sqsClient.send(new ReceiveMessageCommand({
        QueueUrl: this.dlqUrl,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 20
      }));

      if (!messages.Messages || messages.Messages.length === 0) {
        await this.sleep(30000);
        continue;
      }

      for (const message of messages.Messages) {
        await this.analyzeAndAlert(message);
        await this.sqsClient.send(new DeleteMessageCommand({
          QueueUrl: this.dlqUrl,
          ReceiptHandle: message.ReceiptHandle!
        }));
      }
    }
  }

  private async analyzeAndAlert(message: any): Promise<void> {
    const payload = JSON.parse(message.Body);
    const errorCount = parseInt(message.Attributes?.ApproximateReceiveCount || '0');

    // エラー分類
    const errorCategory = this.categorizeError(payload);

    // CloudWatchにログ
    console.error('DLQ Message:', {
      fileKey: payload.s3Key,
      errorCount,
      category: errorCategory,
      payload
    });

    // 管理者にアラート（重大エラーの場合）
    if (errorCategory === 'critical') {
      await this.snsClient.send(new PublishCommand({
        TopicArn: this.alertTopicArn,
        Subject: `Critical File Processing Error`,
        Message: JSON.stringify({
          fileKey: payload.s3Key,
          bucket: payload.s3Bucket,
          errorCount,
          timestamp: new Date().toISOString()
        })
      }));
    }

    // S3にエラーレポート保存
    await this.saveErrorReport(payload, errorCategory);
  }

  private categorizeError(payload: any): 'critical' | 'retriable' | 'skippable' {
    // エラー分類ロジック
    if (payload.fileSize > 100 * 1024 * 1024) {
      return 'critical'; // 大きすぎるファイル
    }

    // その他のロジック...
    return 'retriable';
  }

  private async saveErrorReport(payload: any, category: string): Promise<void> {
    // S3にエラーレポート保存
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// DLQプロセッサー起動
const dlqProcessor = new DLQProcessor(
  process.env.DOCUWORKS_DLQ_URL!,
  process.env.ALERT_TOPIC_ARN!
);
dlqProcessor.processDLQ();
```

### 5.2 サーキットブレーカーパターン

```typescript
// circuit-breaker.ts
enum CircuitState {
  CLOSED = 'CLOSED',   // 正常
  OPEN = 'OPEN',       // エラー多発、リクエスト拒否
  HALF_OPEN = 'HALF_OPEN' // 回復テスト中
}

class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount: number = 0;
  private successCount: number = 0;
  private lastFailureTime: number = 0;

  private failureThreshold: number;
  private resetTimeout: number;
  private halfOpenMaxAttempts: number;

  constructor(config: {
    failureThreshold: number;
    resetTimeout: number;
    halfOpenMaxAttempts: number;
  }) {
    this.failureThreshold = config.failureThreshold;
    this.resetTimeout = config.resetTimeout;
    this.halfOpenMaxAttempts = config.halfOpenMaxAttempts;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === CircuitState.OPEN) {
      if (Date.now() - this.lastFailureTime > this.resetTimeout) {
        this.state = CircuitState.HALF_OPEN;
        this.successCount = 0;
      } else {
        throw new Error('Circuit breaker is OPEN');
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.failureCount = 0;

    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount++;

      if (this.successCount >= this.halfOpenMaxAttempts) {
        this.state = CircuitState.CLOSED;
        console.log('Circuit breaker CLOSED (recovered)');
      }
    }
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.failureCount >= this.failureThreshold) {
      this.state = CircuitState.OPEN;
      console.error('Circuit breaker OPEN (too many failures)');
    }
  }

  getState(): CircuitState {
    return this.state;
  }
}

// 使用例: OpenSearch接続にサーキットブレーカー適用
const openSearchCircuitBreaker = new CircuitBreaker({
  failureThreshold: 5,
  resetTimeout: 60000, // 1分
  halfOpenMaxAttempts: 3
});

async function indexToOpenSearch(data: any): Promise<void> {
  await openSearchCircuitBreaker.execute(async () => {
    await openSearchClient.index({
      index: 'files',
      body: data
    });
  });
}
```

### 5.3 Exponential Backoff再試行

```typescript
// retry-strategy.ts
class RetryStrategy {
  async executeWithRetry<T>(
    fn: () => Promise<T>,
    options: {
      maxRetries?: number;
      initialDelay?: number;
      maxDelay?: number;
      backoffMultiplier?: number;
    } = {}
  ): Promise<T> {
    const {
      maxRetries = 5,
      initialDelay = 1000,
      maxDelay = 60000,
      backoffMultiplier = 2
    } = options;

    let lastError: Error;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;

        if (attempt < maxRetries - 1) {
          const delay = Math.min(
            initialDelay * Math.pow(backoffMultiplier, attempt),
            maxDelay
          );

          console.warn(`Retry attempt ${attempt + 1}/${maxRetries} after ${delay}ms`, error.message);
          await this.sleep(delay);
        }
      }
    }

    throw lastError!;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// 使用例
const retryStrategy = new RetryStrategy();

async function downloadFromS3WithRetry(bucket: string, key: string): Promise<string> {
  return retryStrategy.executeWithRetry(
    async () => {
      return await downloadFromS3(bucket, key);
    },
    {
      maxRetries: 3,
      initialDelay: 2000,
      maxDelay: 10000
    }
  );
}
```

---

## 6. 監視・可観測性アーキテクチャ

### 6.1 CloudWatch メトリクス

```typescript
// metrics-publisher.ts
import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';

class MetricsPublisher {
  private cloudWatchClient: CloudWatchClient;
  private namespace: string;

  constructor(namespace: string = 'CIS-FileProcessing') {
    this.cloudWatchClient = new CloudWatchClient({ region: 'ap-northeast-1' });
    this.namespace = namespace;
  }

  async publishProcessingMetrics(metrics: {
    fileType: string;
    fileSize: number;
    processingTime: number;
    status: 'success' | 'error';
    workerInstance: string;
  }): Promise<void> {
    const metricData = [
      {
        MetricName: 'ProcessingTime',
        Value: metrics.processingTime,
        Unit: 'Milliseconds',
        Dimensions: [
          { Name: 'FileType', Value: metrics.fileType },
          { Name: 'Status', Value: metrics.status },
          { Name: 'WorkerInstance', Value: metrics.workerInstance }
        ]
      },
      {
        MetricName: 'FileSize',
        Value: metrics.fileSize,
        Unit: 'Bytes',
        Dimensions: [
          { Name: 'FileType', Value: metrics.fileType }
        ]
      },
      {
        MetricName: 'ProcessedFiles',
        Value: 1,
        Unit: 'Count',
        Dimensions: [
          { Name: 'FileType', Value: metrics.fileType },
          { Name: 'Status', Value: metrics.status }
        ]
      }
    ];

    await this.cloudWatchClient.send(new PutMetricDataCommand({
      Namespace: this.namespace,
      MetricData: metricData
    }));
  }

  async publishQueueMetrics(queueName: string, depth: number): Promise<void> {
    await this.cloudWatchClient.send(new PutMetricDataCommand({
      Namespace: this.namespace,
      MetricData: [{
        MetricName: 'QueueDepth',
        Value: depth,
        Unit: 'Count',
        Dimensions: [
          { Name: 'QueueName', Value: queueName }
        ]
      }]
    }));
  }

  async publishMemoryMetrics(usage: {
    heapUsedMB: number;
    percentUsed: number;
    instanceId: string;
  }): Promise<void> {
    await this.cloudWatchClient.send(new PutMetricDataCommand({
      Namespace: this.namespace,
      MetricData: [
        {
          MetricName: 'HeapUsedMB',
          Value: usage.heapUsedMB,
          Unit: 'Megabytes',
          Dimensions: [
            { Name: 'InstanceId', Value: usage.instanceId }
          ]
        },
        {
          MetricName: 'MemoryPercentUsed',
          Value: usage.percentUsed,
          Unit: 'Percent',
          Dimensions: [
            { Name: 'InstanceId', Value: usage.instanceId }
          ]
        }
      ]
    }));
  }
}

// グローバルメトリクスパブリッシャー
export const metricsPublisher = new MetricsPublisher();
```

### 6.2 構造化ログ

```typescript
// structured-logger.ts
import winston from 'winston';
import WinstonCloudWatch from 'winston-cloudwatch';

class StructuredLogger {
  private logger: winston.Logger;

  constructor(serviceName: string) {
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
      defaultMeta: {
        service: serviceName,
        environment: process.env.NODE_ENV || 'development',
        instanceId: process.env.INSTANCE_ID || 'local'
      },
      transports: [
        new winston.transports.Console(),
        new WinstonCloudWatch({
          logGroupName: '/aws/ec2/file-processing',
          logStreamName: `${serviceName}-${new Date().toISOString().split('T')[0]}`,
          awsRegion: 'ap-northeast-1',
          jsonMessage: true
        })
      ]
    });
  }

  info(message: string, meta?: object): void {
    this.logger.info(message, meta);
  }

  error(message: string, error: Error, meta?: object): void {
    this.logger.error(message, {
      ...meta,
      error: {
        message: error.message,
        stack: error.stack,
        name: error.name
      }
    });
  }

  warn(message: string, meta?: object): void {
    this.logger.warn(message, meta);
  }

  logFileProcessing(event: 'start' | 'success' | 'error', data: {
    fileKey: string;
    fileType: string;
    fileSize: number;
    processingTime?: number;
    error?: Error;
  }): void {
    const message = `File processing ${event}: ${data.fileKey}`;

    if (event === 'error') {
      this.error(message, data.error!, {
        fileKey: data.fileKey,
        fileType: data.fileType,
        fileSize: data.fileSize
      });
    } else {
      this.info(message, {
        fileKey: data.fileKey,
        fileType: data.fileType,
        fileSize: data.fileSize,
        processingTime: data.processingTime
      });
    }
  }
}

// 使用例
const logger = new StructuredLogger('docuworks-worker');

logger.logFileProcessing('start', {
  fileKey: 'documents/file.xdw',
  fileType: 'docuworks',
  fileSize: 1024000
});
```

### 6.3 ダッシュボード設定（CloudWatch Dashboard）

```typescript
// dashboard-config.ts
export const dashboardConfig = {
  dashboardName: 'CIS-FileProcessing-Dashboard',
  widgets: [
    {
      type: 'metric',
      properties: {
        title: 'Processing Throughput',
        metrics: [
          ['CIS-FileProcessing', 'ProcessedFiles', { stat: 'Sum', period: 60 }]
        ],
        view: 'timeSeries',
        region: 'ap-northeast-1'
      }
    },
    {
      type: 'metric',
      properties: {
        title: 'Queue Depths',
        metrics: [
          ['CIS-FileProcessing', 'QueueDepth', { dimensions: { QueueName: 'docuworks' } }],
          ['CIS-FileProcessing', 'QueueDepth', { dimensions: { QueueName: 'pdf' } }],
          ['CIS-FileProcessing', 'QueueDepth', { dimensions: { QueueName: 'office' } }],
          ['CIS-FileProcessing', 'QueueDepth', { dimensions: { QueueName: 'image' } }]
        ],
        view: 'timeSeries',
        region: 'ap-northeast-1'
      }
    },
    {
      type: 'metric',
      properties: {
        title: 'Processing Time by File Type',
        metrics: [
          ['CIS-FileProcessing', 'ProcessingTime', { dimensions: { FileType: 'docuworks' }, stat: 'Average' }],
          ['CIS-FileProcessing', 'ProcessingTime', { dimensions: { FileType: 'pdf' }, stat: 'Average' }],
          ['CIS-FileProcessing', 'ProcessingTime', { dimensions: { FileType: 'office' }, stat: 'Average' }],
          ['CIS-FileProcessing', 'ProcessingTime', { dimensions: { FileType: 'image' }, stat: 'Average' }]
        ],
        view: 'timeSeries',
        region: 'ap-northeast-1'
      }
    },
    {
      type: 'metric',
      properties: {
        title: 'Error Rate',
        metrics: [
          ['CIS-FileProcessing', 'ProcessedFiles', { dimensions: { Status: 'error' }, stat: 'Sum' }],
          ['CIS-FileProcessing', 'ProcessedFiles', { dimensions: { Status: 'success' }, stat: 'Sum' }]
        ],
        view: 'timeSeries',
        region: 'ap-northeast-1'
      }
    },
    {
      type: 'metric',
      properties: {
        title: 'Memory Usage',
        metrics: [
          ['CIS-FileProcessing', 'MemoryPercentUsed', { stat: 'Average' }]
        ],
        view: 'timeSeries',
        region: 'ap-northeast-1',
        yAxis: {
          left: {
            min: 0,
            max: 100
          }
        }
      }
    }
  ]
};
```

---

## 7. 初期500万ファイル処理戦略

### 7.1 バルクインポート最適化

```typescript
// bulk-import-orchestrator.ts
class BulkImportOrchestrator {
  private s3Client: S3Client;
  private sqsClient: SQSClient;

  async orchestrateBulkImport(params: {
    sourceBucket: string;
    sourcePrefix: string;
    batchSize: number;
  }): Promise<void> {
    const { sourceBucket, sourcePrefix, batchSize } = params;

    console.log('Starting bulk import orchestration...');

    // S3オブジェクト一覧取得（ページネーション）
    let continuationToken: string | undefined;
    let totalFiles = 0;
    let batch: any[] = [];

    do {
      const response = await this.s3Client.send(new ListObjectsV2Command({
        Bucket: sourceBucket,
        Prefix: sourcePrefix,
        MaxKeys: 1000,
        ContinuationToken: continuationToken
      }));

      const objects = response.Contents || [];

      for (const obj of objects) {
        batch.push({
          s3Bucket: sourceBucket,
          s3Key: obj.Key!,
          fileSize: obj.Size!,
          lastModified: obj.LastModified!.toISOString()
        });

        if (batch.length >= batchSize) {
          await this.sendBatchToRouter(batch);
          totalFiles += batch.length;
          console.log(`Processed ${totalFiles} files...`);
          batch = [];
        }
      }

      continuationToken = response.NextContinuationToken;

    } while (continuationToken);

    // 残りのバッチを送信
    if (batch.length > 0) {
      await this.sendBatchToRouter(batch);
      totalFiles += batch.length;
    }

    console.log(`Bulk import completed: ${totalFiles} files`);
  }

  private async sendBatchToRouter(batch: any[]): Promise<void> {
    // ファイルタイプ別にグループ化
    const grouped = this.groupByFileType(batch);

    // 各キューに並列送信
    await Promise.all([
      this.sendToQueue(grouped.docuworks, process.env.DOCUWORKS_QUEUE_URL!),
      this.sendToQueue(grouped.pdf, process.env.PDF_QUEUE_URL!),
      this.sendToQueue(grouped.office, process.env.OFFICE_QUEUE_URL!),
      this.sendToQueue(grouped.image, process.env.IMAGE_QUEUE_URL!)
    ]);
  }

  private groupByFileType(files: any[]): {
    docuworks: any[];
    pdf: any[];
    office: any[];
    image: any[];
  } {
    const result = {
      docuworks: [],
      pdf: [],
      office: [],
      image: []
    };

    for (const file of files) {
      const ext = this.getExtension(file.s3Key).toLowerCase();

      if (['.xdw', '.xbd'].includes(ext)) {
        result.docuworks.push(file);
      } else if (ext === '.pdf') {
        result.pdf.push(file);
      } else if (['.docx', '.xlsx', '.pptx', '.doc', '.xls', '.ppt'].includes(ext)) {
        result.office.push(file);
      } else {
        result.image.push(file);
      }
    }

    return result;
  }

  private async sendToQueue(files: any[], queueUrl: string): Promise<void> {
    if (files.length === 0) return;

    // SQS最大バッチサイズは10件
    for (let i = 0; i < files.length; i += 10) {
      const batch = files.slice(i, i + 10);

      await this.sqsClient.send(new SendMessageBatchCommand({
        QueueUrl: queueUrl,
        Entries: batch.map((file, index) => ({
          Id: `${index}`,
          MessageBody: JSON.stringify(file)
        }))
      }));
    }
  }

  private getExtension(key: string): string {
    const parts = key.split('.');
    return parts.length > 1 ? `.${parts[parts.length - 1]}` : '';
  }
}

// バルクインポート実行
const orchestrator = new BulkImportOrchestrator();
orchestrator.orchestrateBulkImport({
  sourceBucket: 'cis-nas-files',
  sourcePrefix: '',
  batchSize: 1000
});
```

### 7.2 処理進捗トラッキング

```typescript
// progress-tracker.ts
import { DynamoDBClient, PutItemCommand, UpdateItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb';

interface ProcessingProgress {
  batchId: string;
  totalFiles: number;
  processedFiles: number;
  successCount: number;
  errorCount: number;
  startTime: string;
  endTime?: string;
  status: 'in_progress' | 'completed' | 'failed';
}

class ProgressTracker {
  private dynamoClient: DynamoDBClient;
  private tableName: string;

  constructor(tableName: string = 'FileProcessingProgress') {
    this.dynamoClient = new DynamoDBClient({ region: 'ap-northeast-1' });
    this.tableName = tableName;
  }

  async startBatch(batchId: string, totalFiles: number): Promise<void> {
    await this.dynamoClient.send(new PutItemCommand({
      TableName: this.tableName,
      Item: {
        batchId: { S: batchId },
        totalFiles: { N: totalFiles.toString() },
        processedFiles: { N: '0' },
        successCount: { N: '0' },
        errorCount: { N: '0' },
        startTime: { S: new Date().toISOString() },
        status: { S: 'in_progress' }
      }
    }));
  }

  async updateProgress(batchId: string, success: boolean): Promise<void> {
    await this.dynamoClient.send(new UpdateItemCommand({
      TableName: this.tableName,
      Key: {
        batchId: { S: batchId }
      },
      UpdateExpression: `
        SET processedFiles = processedFiles + :inc,
            ${success ? 'successCount' : 'errorCount'} = ${success ? 'successCount' : 'errorCount'} + :inc
      `,
      ExpressionAttributeValues: {
        ':inc': { N: '1' }
      }
    }));
  }

  async getProgress(batchId: string): Promise<ProcessingProgress | null> {
    const response = await this.dynamoClient.send(new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression: 'batchId = :batchId',
      ExpressionAttributeValues: {
        ':batchId': { S: batchId }
      }
    }));

    if (!response.Items || response.Items.length === 0) {
      return null;
    }

    const item = response.Items[0];
    return {
      batchId: item.batchId.S!,
      totalFiles: parseInt(item.totalFiles.N!),
      processedFiles: parseInt(item.processedFiles.N!),
      successCount: parseInt(item.successCount.N!),
      errorCount: parseInt(item.errorCount.N!),
      startTime: item.startTime.S!,
      endTime: item.endTime?.S,
      status: item.status.S! as any
    };
  }
}
```

---

## 8. コスト最適化戦略

### 8.1 スポットインスタンス活用

```typescript
// spot-instance-config.ts
export const spotInstanceConfig = {
  pdf: {
    instanceType: 'c5.xlarge',
    maxPrice: '0.08', // オンデマンド価格の約50%
    minInstances: 3,
    maxInstances: 10,
    interruptionBehavior: 'terminate',
    // スポット中断時の対応
    onInterruption: async (instanceId: string) => {
      console.warn(`Spot instance ${instanceId} will be terminated in 2 minutes`);
      // グレースフルシャットダウン開始
      await gracefulShutdown(instanceId);
    }
  },

  office: {
    instanceType: 'c5.xlarge',
    maxPrice: '0.08',
    minInstances: 2,
    maxInstances: 5,
    interruptionBehavior: 'terminate'
  },

  image: {
    instanceType: 'c5.2xlarge',
    maxPrice: '0.16',
    minInstances: 5,
    maxInstances: 20,
    interruptionBehavior: 'terminate'
  }
};

// スポット中断ハンドラー
async function gracefulShutdown(instanceId: string): Promise<void> {
  // 1. 新規メッセージの受信を停止
  workerInstance.stopAcceptingNewMessages();

  // 2. 現在処理中のタスクを完了（最大120秒）
  await workerInstance.waitForCurrentTasksToComplete(120000);

  // 3. インスタンス終了
  console.log(`Instance ${instanceId} shutting down gracefully`);
  process.exit(0);
}
```

### 8.2 Auto Scaling設定

```typescript
// autoscaling-config.ts
export const autoScalingConfig = {
  pdf: {
    minSize: 3,
    maxSize: 10,
    desiredCapacity: 3,
    scaleUpPolicy: {
      metricName: 'QueueDepth',
      threshold: 1000, // キュー深度1000件以上でスケールアップ
      evaluationPeriods: 2,
      scalingAdjustment: 2 // +2インスタンス
    },
    scaleDownPolicy: {
      metricName: 'QueueDepth',
      threshold: 100, // キュー深度100件以下でスケールダウン
      evaluationPeriods: 5,
      scalingAdjustment: -1 // -1インスタンス
    }
  },

  office: {
    minSize: 2,
    maxSize: 5,
    desiredCapacity: 2,
    scaleUpPolicy: {
      metricName: 'QueueDepth',
      threshold: 500,
      evaluationPeriods: 2,
      scalingAdjustment: 1
    },
    scaleDownPolicy: {
      metricName: 'QueueDepth',
      threshold: 50,
      evaluationPeriods: 5,
      scalingAdjustment: -1
    }
  },

  image: {
    minSize: 5,
    maxSize: 20,
    desiredCapacity: 5,
    scaleUpPolicy: {
      metricName: 'QueueDepth',
      threshold: 2000,
      evaluationPeriods: 2,
      scalingAdjustment: 3
    },
    scaleDownPolicy: {
      metricName: 'QueueDepth',
      threshold: 200,
      evaluationPeriods: 5,
      scalingAdjustment: -2
    }
  }
};
```

---

## 9. 実装ロードマップ

### Phase 1: 基盤構築（Week 1-2）
- [ ] SQSキュー作成（DocuWorks FIFO, PDF, Office, Image）
- [ ] Lambda Routerデプロイ
- [ ] EventBridge Rule設定
- [ ] CloudWatch Dashboard作成

### Phase 2: ワーカー実装（Week 3-4）
- [ ] DocuWorksワーカー実装・テスト
- [ ] PDFワーカー実装・テスト
- [ ] Officeワーカー実装・テスト
- [ ] Imageワーカー実装・テスト

### Phase 3: レジリエンス実装（Week 5）
- [ ] DLQ処理実装
- [ ] サーキットブレーカー実装
- [ ] 再試行ロジック実装
- [ ] エラーアラート設定

### Phase 4: 監視・最適化（Week 6）
- [ ] メトリクス実装
- [ ] 構造化ログ実装
- [ ] ダッシュボード構築
- [ ] Auto Scaling設定

### Phase 5: 本番投入（Week 7-8）
- [ ] 小規模バッチテスト（1万ファイル）
- [ ] 中規模バッチテスト（10万ファイル）
- [ ] 500万ファイル本番処理開始
- [ ] パフォーマンスチューニング

---

## 10. 推定処理性能

### 10.1 処理スループット見積もり

| ファイルタイプ | 平均処理時間 | ワーカー数 | 並列度 | 時間あたり処理数 |
|-------------|------------|----------|--------|---------------|
| DocuWorks   | 30秒       | 1台      | 1      | 120ファイル/時 |
| PDF         | 10秒       | 5台      | 4      | 7,200ファイル/時 |
| Office      | 15秒       | 3台      | 4      | 2,880ファイル/時 |
| Image       | 5秒        | 10台     | 8      | 57,600ファイル/時 |

**合計スループット: 約67,800ファイル/時**

### 10.2 500万ファイル処理時間見積もり

ファイル構成比率を以下と仮定：
- DocuWorks: 20% (100万件) → 約8,333時間 = **347日** ← **ボトルネック**
- PDF: 30% (150万件) → 約208時間 = **9日**
- Office: 20% (100万件) → 約347時間 = **15日**
- Image: 30% (150万件) → 約26時間 = **2日**

**DocuWorksがクリティカルパス**のため、優先度を上げた処理が必要です。

### 10.3 最適化後の見積もり

**DocuWorks処理最適化案:**
1. バッチサイズ拡大（100件 → 500件）
2. 処理時間短縮（キャッシュ活用）
3. 24時間連続稼働

改善後: **100万件 / 120件/時 = 約8,333時間 → 約347日**

**さらなる最適化が必要な場合:**
- DocuWorksライセンス追加購入を検討
- または、DocuWorksファイルのバッチ変換を事前に実施

---

## まとめ

本アーキテクチャ設計により、以下を実現します：

✅ **ライセンス制約への対応**: DocuWorks専用インスタンスで単一プロセス管理
✅ **並列処理最大化**: ファイルタイプ別レーン分離で効率的処理
✅ **コスト最適化**: スポットインスタンスで70%コスト削減
✅ **レジリエンス**: DLQ、サーキットブレーカー、再試行機構
✅ **可観測性**: CloudWatch完全統合、構造化ログ
✅ **スケーラビリティ**: Auto Scalingで需要に応じた自動調整

**次のアクション:**
1. このアーキテクチャレビューの承認
2. 実装ロードマップの詳細化
3. DocuWorksライセンス追加購入の検討（処理速度重視の場合）
4. Phase 1の実装開始

ご質問や追加の最適化要望があればお知らせください！
