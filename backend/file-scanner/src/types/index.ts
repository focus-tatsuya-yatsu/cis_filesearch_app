/**
 * CIS File Scanner - Type Definitions
 */

// ============================================
// File System Types
// ============================================

/**
 * File metadata interface
 */
export interface FileMetadata {
  path: string;
  name: string;
  size: number;
  mimeType: string;
  modifiedAt: Date;
  createdAt?: Date;
  isDirectory: boolean;
  checksum?: string;
}

/**
 * File stats interface
 */
export interface FileStats {
  size: number;
  mtime: Date;
  ctime: Date;
  atime: Date;
  isFile: boolean;
  isDirectory: boolean;
  isSymbolicLink: boolean;
}

/**
 * Scan result interface
 */
export interface ScanResult {
  totalFiles: number;
  totalSize: number;
  totalDirectories: number;
  newFiles: FileMetadata[];
  modifiedFiles: FileMetadata[];
  deletedFiles: FileMetadata[];
  unchangedFiles: FileMetadata[];
  errors: ScanError[];
  scanDuration: number;
}

/**
 * Scan error interface
 */
export interface ScanError {
  path: string;
  error: string;
  timestamp: Date;
  recoverable: boolean;
}

// ============================================
// AWS Types
// ============================================

/**
 * S3 upload result
 */
export interface S3UploadResult {
  key: string;
  bucket: string;
  etag?: string;
  versionId?: string;
  size: number;
  uploadDuration: number;
}

/**
 * SQS message payload
 */
export interface FileProcessingMessage {
  eventType: 'FILE_UPLOADED' | 'FILE_MODIFIED' | 'FILE_DELETED';
  s3Bucket: string;
  s3Key: string;
  fileSize: number;
  mimeType: string;
  originalPath: string;
  checksum?: string;
  timestamp: string;
  metadata?: Record<string, any>;
}

// ============================================
// Configuration Types
// ============================================

/**
 * Scanner configuration
 */
export interface ScannerConfig {
  nasPath: string;
  s3Bucket: string;
  sqsQueueUrl: string;
  batchSize: number;
  parallelism: number;
  excludePatterns: string[];
  maxFileSize?: number;
  dryRun: boolean;
}

/**
 * AWS configuration
 */
export interface AWSConfig {
  region: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  s3: {
    bucket: string;
    uploadConcurrency: number;
    multipartThreshold: number;
    chunkSize: number;
  };
  sqs: {
    queueUrl: string;
    dlqUrl?: string;
  };
}

/**
 * NAS configuration
 */
export interface NASConfig {
  protocol: 'auto' | 'smb' | 'nfs' | 'mounted';
  mountPath: string;
  host?: string;
  username?: string;
  password?: string;
  domain?: string;
}

// ============================================
// Database Types
// ============================================

/**
 * File record in database
 */
export interface FileRecord {
  id?: number;
  path: string;
  size: number;
  mtime: number;
  checksum?: string;
  lastSynced: number;
  status: 'pending' | 'synced' | 'error';
  errorMessage?: string;
}

// ============================================
// Progress Types
// ============================================

/**
 * Progress event
 */
export interface ProgressEvent {
  type: 'scan' | 'upload' | 'process';
  current: number;
  total: number;
  percentage: number;
  message?: string;
  metadata?: any;
}

/**
 * Progress callback
 */
export type ProgressCallback = (event: ProgressEvent) => void;

// ============================================
// Sync Types (SQS Consumer)
// ============================================

/**
 * SQS sync message (from Lambda trigger)
 */
export interface SyncMessage {
  syncId: string;
  nasServers: string[];
  fullSync: boolean;
  triggeredBy: string;
  timestamp: string;
}

/**
 * Sync progress status
 */
export type SyncStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

/**
 * Sync progress stored in DynamoDB
 */
export interface SyncProgress {
  syncId: string;
  status: SyncStatus;
  createdAt: string;
  updatedAt: string;
  nasServers: string[];
  fullSync: boolean;
  triggeredBy: string;
  progress?: {
    current: number;
    total: number;
    currentNas?: string;
    processedFiles?: number;
    errors?: number;
  };
  result?: {
    newFiles: number;
    changedFiles: number;
    deletedFiles: number;
    syncedFiles: number;
    errors: number;
  };
  errorMessage?: string;
  ttl: number;
}

/**
 * Sync result from scan
 */
export interface SyncResult {
  newFiles: number;
  changedFiles: number;
  deletedFiles: number;
  syncedFiles: number;
  errors: number;
}