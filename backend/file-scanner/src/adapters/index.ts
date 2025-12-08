/**
 * FileSystem Adapters
 * 各種ファイルシステムアダプターのエクスポート
 */

// 基底クラス・インターフェース
export {
  BaseFileSystemAdapter
} from './FileSystemAdapter';

export type {
  FileSystemAdapter,
  ScanOptions
} from './FileSystemAdapter';

// 実装クラス
export {
  MountedFileSystemAdapter
} from './MountedFileSystemAdapter';

export type {
  MountedFileSystemConfig
} from './MountedFileSystemAdapter';

export {
  LocalFileSystemAdapter
} from './LocalFileSystemAdapter';

export type {
  LocalFileSystemConfig
} from './LocalFileSystemAdapter';

export {
  MockFileSystemAdapter
} from './MockFileSystemAdapter';

export type {
  MockFileSystemConfig
} from './MockFileSystemAdapter';

// ファクトリー
export {
  FileSystemAdapterFactory
} from './FileSystemAdapterFactory';

export type {
  AdapterType,
  AdapterFactoryConfig
} from './FileSystemAdapterFactory';

import { FileSystemAdapterFactory as Factory } from './FileSystemAdapterFactory';
import type { AdapterFactoryConfig as FactoryConfig } from './FileSystemAdapterFactory';
import { MockFileSystemAdapter as MockAdapter } from './MockFileSystemAdapter';
import type { MockFileSystemConfig as MockConfig } from './MockFileSystemAdapter';

/**
 * デフォルトエクスポート
 * 最も一般的な使用方法のための便利な関数
 */
export default {
  /**
   * 環境変数から自動的にアダプターを作成
   */
  createFromEnv: () => Factory.createFromEnv(),

  /**
   * 指定した設定でアダプターを作成
   */
  create: (config: FactoryConfig) => Factory.create(config),

  /**
   * テスト用のモックアダプターを作成
   */
  createMock: (config?: MockConfig) => new MockAdapter(config)
};