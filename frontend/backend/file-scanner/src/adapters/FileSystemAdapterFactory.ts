/**
 * FileSystemAdapter Factory
 * 設定に基づいて適切なFileSystemAdapterを生成
 */

import { FileSystemAdapter } from './FileSystemAdapter';
import { MountedFileSystemAdapter } from './MountedFileSystemAdapter';
import { LocalFileSystemAdapter } from './LocalFileSystemAdapter';
import { MockFileSystemAdapter } from './MockFileSystemAdapter';
import { NASConfig } from '@/types';
import * as fs from 'fs';

/**
 * アダプタータイプ
 */
export type AdapterType = 'mounted' | 'local' | 'mock' | 'auto';

/**
 * ファクトリー設定
 */
export interface AdapterFactoryConfig {
  /**
   * アダプタータイプ
   */
  type?: AdapterType;

  /**
   * NAS設定
   */
  nasConfig?: NASConfig;

  /**
   * テスト用設定
   */
  testMode?: boolean;

  /**
   * モック用初期データ
   */
  mockData?: any;
}

/**
 * FileSystemAdapterFactory
 * 設定に基づいて適切なアダプターインスタンスを生成
 */
export class FileSystemAdapterFactory {
  /**
   * アダプターを作成
   */
  static create(config: AdapterFactoryConfig): FileSystemAdapter {
    const { type = 'auto', nasConfig, testMode = false, mockData } = config;

    // テストモードの場合はMockアダプターを返す
    if (testMode) {
      console.log('Creating MockFileSystemAdapter for test mode');
      return new MockFileSystemAdapter({
        initialFiles: mockData
      });
    }

    // 明示的にタイプが指定されている場合
    if (type !== 'auto') {
      return this.createByType(type, nasConfig);
    }

    // autoモード: 環境に応じて自動選択
    return this.autoDetect(nasConfig);
  }

  /**
   * タイプ指定でアダプターを作成
   */
  private static createByType(type: AdapterType, nasConfig?: NASConfig): FileSystemAdapter {
    switch (type) {
      case 'mounted':
        if (!nasConfig?.mountPath) {
          throw new Error('mountPath is required for mounted adapter');
        }
        console.log(`Creating MountedFileSystemAdapter for path: ${nasConfig.mountPath}`);
        return new MountedFileSystemAdapter({
          mountPath: nasConfig.mountPath
        });

      case 'local':
        const basePath = nasConfig?.mountPath || process.cwd();
        console.log(`Creating LocalFileSystemAdapter for path: ${basePath}`);
        return new LocalFileSystemAdapter({
          basePath,
          sandboxMode: true
        });

      case 'mock':
        console.log('Creating MockFileSystemAdapter');
        return new MockFileSystemAdapter();

      default:
        throw new Error(`Unknown adapter type: ${type}`);
    }
  }

  /**
   * 環境に応じて自動検出
   */
  private static autoDetect(nasConfig?: NASConfig): FileSystemAdapter {
    console.log('Auto-detecting appropriate FileSystem adapter...');

    // NAS設定が提供されている場合
    if (nasConfig) {
      // プロトコルに基づいて判断
      switch (nasConfig.protocol) {
        case 'mounted':
          console.log('NAS protocol is "mounted", using MountedFileSystemAdapter');
          return new MountedFileSystemAdapter({
            mountPath: nasConfig.mountPath
          });

        case 'smb':
        case 'nfs':
          // 将来的にSMB/NFS専用アダプターを実装予定
          console.log(`NAS protocol is "${nasConfig.protocol}", using MountedFileSystemAdapter (assuming OS-level mount)`);
          return new MountedFileSystemAdapter({
            mountPath: nasConfig.mountPath
          });

        case 'auto':
        default:
          // マウントパスが存在するか確認
          if (fs.existsSync(nasConfig.mountPath)) {
            console.log(`Mount path exists: ${nasConfig.mountPath}, using MountedFileSystemAdapter`);
            return new MountedFileSystemAdapter({
              mountPath: nasConfig.mountPath
            });
          } else {
            console.warn(`Mount path not found: ${nasConfig.mountPath}, falling back to LocalFileSystemAdapter`);
            return new LocalFileSystemAdapter({
              basePath: process.cwd(),
              sandboxMode: true
            });
          }
      }
    }

    // NAS設定がない場合はローカルアダプターを使用
    console.log('No NAS configuration provided, using LocalFileSystemAdapter');
    return new LocalFileSystemAdapter({
      basePath: process.cwd(),
      sandboxMode: true
    });
  }

  /**
   * 環境変数から設定を読み込んでアダプターを作成
   */
  static createFromEnv(): FileSystemAdapter {
    const nasConfig: NASConfig = {
      protocol: (process.env.NAS_PROTOCOL as any) || 'auto',
      mountPath: process.env.NAS_MOUNT_PATH || '/mnt/nas',
      host: process.env.NAS_HOST,
      username: process.env.NAS_USERNAME,
      password: process.env.NAS_PASSWORD,
      domain: process.env.NAS_DOMAIN
    };

    const testMode = process.env.NODE_ENV === 'test';

    return this.create({
      type: 'auto',
      nasConfig,
      testMode
    });
  }

  /**
   * 利用可能なアダプタータイプを取得
   */
  static getAvailableTypes(): AdapterType[] {
    return ['mounted', 'local', 'mock', 'auto'];
  }

  /**
   * アダプターの情報を取得
   */
  static getAdapterInfo(adapter: FileSystemAdapter): {
    name: string;
    connected: boolean;
    type: string;
  } {
    return {
      name: adapter.getName(),
      connected: adapter.isConnected(),
      type: adapter.constructor.name
    };
  }
}