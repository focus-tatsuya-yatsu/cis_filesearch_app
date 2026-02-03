/**
 * PowerShell Runner Service
 * Node.jsから安全にPowerShellスクリプトを実行するユーティリティ
 */

import { spawn, ChildProcess } from 'child_process';
import { createLogger } from '@/utils/logger';

const logger = createLogger('PowerShellRunner');

/**
 * PowerShellRunnerの設定
 */
export interface PowerShellRunnerConfig {
  /**
   * PowerShellスクリプトのパス
   */
  scriptPath: string;

  /**
   * 作業ディレクトリ
   */
  workingDirectory?: string;

  /**
   * タイムアウト（ミリ秒）- デフォルト4時間
   */
  timeout?: number;

  /**
   * 追加の環境変数
   */
  environment?: Record<string, string>;
}

/**
 * PowerShell実行結果
 */
export interface PowerShellResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  duration: number;
  success: boolean;
}

/**
 * 同期結果（nas-sync-improved.ps1の出力形式）
 */
export interface NasSyncResult {
  new_files: number;
  changed_files: number;
  deleted_files: number;
  synced: number;
  errors: number;
}

/**
 * 進捗コールバック
 */
export type ProgressCallback = (message: string) => void;

/**
 * PowerShellRunner
 * 安全にPowerShellスクリプトを実行
 */
export class PowerShellRunner {
  private readonly config: Required<PowerShellRunnerConfig>;
  private childProcess: ChildProcess | null = null;

  constructor(config: PowerShellRunnerConfig) {
    this.config = {
      workingDirectory: config.workingDirectory || process.cwd(),
      timeout: config.timeout || 4 * 60 * 60 * 1000, // 4時間
      environment: config.environment || {},
      ...config
    };
  }

  /**
   * PowerShellスクリプトを実行
   * @param args スクリプトに渡す引数（配列形式で安全に渡す）
   * @param onProgress 進捗コールバック（オプション）
   */
  async execute(args: string[] = [], onProgress?: ProgressCallback): Promise<PowerShellResult> {
    const startTime = Date.now();

    // 引数のバリデーション
    this.validateArgs(args);

    return new Promise((resolve, reject) => {
      // PowerShell実行引数を構築
      // -NoProfile: プロファイル読み込みをスキップ（高速化）
      // -ExecutionPolicy Bypass: スクリプト実行を許可
      // -File: スクリプトファイルを実行
      const psArgs = [
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-File', this.config.scriptPath,
        ...args
      ];

      logger.info(`Executing PowerShell: ${this.config.scriptPath}`);
      logger.debug(`Arguments: ${args.join(' ')}`);

      // spawn を使用（exec より安全 - シェルを介さない）
      this.childProcess = spawn('powershell.exe', psArgs, {
        cwd: this.config.workingDirectory,
        env: {
          ...process.env,
          ...this.config.environment
        },
        // Windows環境でのみ実行
        shell: false,
        // 標準入力を閉じる
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';

      // タイムアウト設定
      const timeoutId = setTimeout(() => {
        if (this.childProcess) {
          logger.error(`PowerShell execution timed out after ${this.config.timeout}ms`);
          this.childProcess.kill('SIGTERM');
          reject(new Error(`PowerShell execution timed out after ${this.config.timeout}ms`));
        }
      }, this.config.timeout);

      // 標準出力を収集
      this.childProcess.stdout?.on('data', (data: Buffer) => {
        const text = data.toString('utf8');
        stdout += text;

        // 進捗情報をコールバック
        if (onProgress) {
          const lines = text.split('\n');
          for (const line of lines) {
            if (line.trim()) {
              onProgress(line.trim());
            }
          }
        }
      });

      // 標準エラーを収集
      this.childProcess.stderr?.on('data', (data: Buffer) => {
        const text = data.toString('utf8');
        stderr += text;
        logger.debug(`PowerShell stderr: ${text}`);
      });

      // プロセス終了時
      this.childProcess.on('close', (code) => {
        clearTimeout(timeoutId);
        const duration = Date.now() - startTime;

        const result: PowerShellResult = {
          exitCode: code ?? -1,
          stdout,
          stderr,
          duration,
          success: code === 0
        };

        logger.info(`PowerShell completed: exitCode=${code}, duration=${duration}ms`);

        if (code === 0) {
          resolve(result);
        } else {
          logger.error(`PowerShell failed: exitCode=${code}`);
          logger.error(`stderr: ${stderr}`);
          resolve(result); // エラーでもresolveして、呼び出し側で処理
        }
      });

      // プロセスエラー
      this.childProcess.on('error', (error) => {
        clearTimeout(timeoutId);
        logger.error(`PowerShell process error: ${error.message}`);
        reject(error);
      });
    });
  }

  /**
   * NAS同期スクリプトを実行
   * nas-sync-improved.ps1 専用のラッパー
   */
  async executeNasSync(options: {
    fullSync?: boolean;
    dryRun?: boolean;
    onProgress?: ProgressCallback;
  } = {}): Promise<NasSyncResult> {
    const args: string[] = [];

    if (options.fullSync) {
      args.push('-FullSync');
    }

    if (options.dryRun) {
      args.push('-DryRun');
    }

    const result = await this.execute(args, options.onProgress);

    if (!result.success) {
      throw new Error(`NAS sync failed with exit code ${result.exitCode}: ${result.stderr}`);
    }

    // 出力からJSON結果をパース
    return this.parseNasSyncOutput(result.stdout);
  }

  /**
   * nas-sync-improved.ps1 の出力をパース
   */
  private parseNasSyncOutput(stdout: string): NasSyncResult {
    // PowerShellの出力からJSON部分を抽出
    // スクリプトは最後にハッシュテーブルを返すが、
    // PowerShellの出力形式によってはKey=Value形式になることがある

    // まず、stdout全体を確認
    logger.debug(`Parsing PowerShell output: ${stdout.substring(0, 500)}...`);

    // 方法1: JSON形式で出力されている場合
    try {
      // 最後の行からJSONを探す
      const lines = stdout.trim().split('\n');
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i]?.trim();
        if (line && line.startsWith('{') && line.endsWith('}')) {
          const parsed = JSON.parse(line);
          if ('new_files' in parsed || 'synced' in parsed) {
            return this.normalizeNasSyncResult(parsed);
          }
        }
      }
    } catch {
      // JSONパース失敗、次の方法を試す
    }

    // 方法2: PowerShellのハッシュテーブル形式をパース
    // @{new_files=10; changed_files=5; ...}
    const hashMatch = stdout.match(/@\{([^}]+)\}/);
    if (hashMatch && hashMatch[1]) {
      const entries = hashMatch[1].split(';').map(e => e.trim());
      const result: Record<string, number> = {};
      for (const entry of entries) {
        const parts = entry.split('=').map(s => s.trim());
        const key = parts[0];
        const value = parts[1];
        if (key && value) {
          result[key] = parseInt(value, 10) || 0;
        }
      }
      return this.normalizeNasSyncResult(result);
    }

    // 方法3: 出力テキストから数値を抽出
    // "新規: 10", "変更: 5" などのパターン
    const newMatch = stdout.match(/新規[:\s]+(\d+)/);
    const changedMatch = stdout.match(/変更[:\s]+(\d+)/);
    const deletedMatch = stdout.match(/削除[:\s]+(\d+)/);
    const syncedMatch = stdout.match(/同期成功[:\s]+(\d+)/);
    const errorsMatch = stdout.match(/エラー[:\s]+(\d+)/);

    return {
      new_files: newMatch?.[1] ? parseInt(newMatch[1], 10) : 0,
      changed_files: changedMatch?.[1] ? parseInt(changedMatch[1], 10) : 0,
      deleted_files: deletedMatch?.[1] ? parseInt(deletedMatch[1], 10) : 0,
      synced: syncedMatch?.[1] ? parseInt(syncedMatch[1], 10) : 0,
      errors: errorsMatch?.[1] ? parseInt(errorsMatch[1], 10) : 0
    };
  }

  /**
   * 結果オブジェクトを正規化
   */
  private normalizeNasSyncResult(raw: Record<string, any>): NasSyncResult {
    return {
      new_files: parseInt(raw.new_files ?? raw.newFiles ?? 0, 10),
      changed_files: parseInt(raw.changed_files ?? raw.changedFiles ?? 0, 10),
      deleted_files: parseInt(raw.deleted_files ?? raw.deletedFiles ?? 0, 10),
      synced: parseInt(raw.synced ?? raw.syncedFiles ?? 0, 10),
      errors: parseInt(raw.errors ?? 0, 10)
    };
  }

  /**
   * 引数のバリデーション（セキュリティ対策）
   */
  private validateArgs(args: string[]): void {
    // 危険な文字パターン
    const dangerousPatterns = [
      /[;&|`$]/,           // シェルメタ文字
      /\$\(/,              // コマンド置換
      /`/,                 // バッククォート
      /<|>/,              // リダイレクト
      /\|\||\&\&/,        // 論理演算子
    ];

    for (const arg of args) {
      for (const pattern of dangerousPatterns) {
        if (pattern.test(arg)) {
          throw new Error(`Invalid argument: potentially dangerous characters detected in "${arg}"`);
        }
      }
    }
  }

  /**
   * 実行中のプロセスを強制終了
   */
  kill(): void {
    if (this.childProcess) {
      logger.warn('Killing PowerShell process');
      this.childProcess.kill('SIGTERM');
      this.childProcess = null;
    }
  }

  /**
   * Windows環境かどうかを確認
   */
  static isWindowsEnvironment(): boolean {
    return process.platform === 'win32';
  }
}
