/**
 * 画像アップロード機能テストページ
 *
 * アクセス: http://localhost:3000/test-upload
 *
 * このページは画像アップロード機能のデバッグ用です
 */

'use client'

import { useState } from 'react'

import { ImageUpload, ImageUploadResult, ImageUploadError } from '@/components/features/ImageUpload'

export default function TestUploadPage() {
  const [result, setResult] = useState<ImageUploadResult | null>(null)
  const [error, setError] = useState<ImageUploadError | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [logs, setLogs] = useState<string[]>([])

  // ログを追加
  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString()
    setLogs((prev) => [...prev, `[${timestamp}] ${message}`])
  }

  // アップロード成功時
  const handleUploadSuccess = (data: ImageUploadResult) => {
    setResult(data)
    setError(null)
    addLog('✓ アップロード成功')
    addLog(`  ファイル名: ${data.fileName}`)
    addLog(`  次元数: ${data.dimensions}`)
    addLog(`  ベクトル長: ${data.embedding.length}`)
  }

  // アップロード失敗時
  const handleUploadError = (err: ImageUploadError) => {
    setError(err)
    setResult(null)
    addLog('✗ アップロード失敗')
    addLog(`  エラー: ${err.error}`)
    addLog(`  コード: ${err.code}`)
    if (err.message) {
      addLog(`  詳細: ${err.message}`)
    }
  }

  // アップロード状態変更時
  const handleUploadingChange = (uploading: boolean) => {
    setIsUploading(uploading)
    if (uploading) {
      addLog('アップロード開始...')
    } else {
      addLog('アップロード完了')
    }
  }

  // ログをクリア
  const clearLogs = () => {
    setLogs([])
    setResult(null)
    setError(null)
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-6xl mx-auto">
        <div className="bg-white rounded-lg shadow-lg p-8">
          {/* ヘッダー */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">画像アップロード機能テスト</h1>
            <p className="text-gray-600">このページは画像アップロード機能のデバッグ用です</p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* 左側: アップロードエリア */}
            <div>
              <h2 className="text-xl font-semibold mb-4">画像アップロード</h2>

              <ImageUpload
                onUploadSuccess={handleUploadSuccess}
                onUploadError={handleUploadError}
                onUploadingChange={handleUploadingChange}
              />

              {/* 結果表示 */}
              {result && (
                <div className="mt-6 p-4 bg-green-50 border border-green-200 rounded-lg">
                  <h3 className="text-lg font-semibold text-green-800 mb-3">✓ アップロード成功</h3>
                  <div className="space-y-2 text-sm">
                    <div>
                      <span className="font-medium">ファイル名:</span> {result.fileName}
                    </div>
                    <div>
                      <span className="font-medium">サイズ:</span>{' '}
                      {(result.fileSize / 1024).toFixed(2)} KB
                    </div>
                    <div>
                      <span className="font-medium">タイプ:</span> {result.fileType}
                    </div>
                    <div>
                      <span className="font-medium">ベクトル次元:</span> {result.dimensions}
                    </div>
                    <div>
                      <span className="font-medium">ベクトル（最初の10要素）:</span>
                      <pre className="mt-1 p-2 bg-white rounded border border-green-300 text-xs overflow-x-auto">
                        {JSON.stringify(result.embedding.slice(0, 10), null, 2)}
                      </pre>
                    </div>
                  </div>
                </div>
              )}

              {/* エラー表示 */}
              {error && (
                <div className="mt-6 p-4 bg-red-50 border border-red-200 rounded-lg">
                  <h3 className="text-lg font-semibold text-red-800 mb-3">✗ エラー</h3>
                  <div className="space-y-2 text-sm">
                    <div>
                      <span className="font-medium">エラーメッセージ:</span> {error.error}
                    </div>
                    <div>
                      <span className="font-medium">エラーコード:</span> {error.code}
                    </div>
                    {error.message && (
                      <div>
                        <span className="font-medium">詳細:</span> {error.message}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* 右側: ログ表示 */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold">デバッグログ</h2>
                <button
                  onClick={clearLogs}
                  className="px-4 py-2 text-sm bg-gray-200 hover:bg-gray-300 rounded transition-colors"
                >
                  ログをクリア
                </button>
              </div>

              <div className="bg-gray-900 text-green-400 p-4 rounded-lg font-mono text-xs h-96 overflow-y-auto">
                {logs.length === 0 ? (
                  <div className="text-gray-500">
                    ログはまだありません。画像をアップロードしてください。
                  </div>
                ) : (
                  logs.map((log, index) => (
                    <div key={index} className="mb-1">
                      {log}
                    </div>
                  ))
                )}
              </div>

              {/* 状態表示 */}
              <div className="mt-4 p-3 bg-gray-100 rounded">
                <div className="text-sm space-y-1">
                  <div>
                    <span className="font-medium">アップロード中:</span>{' '}
                    {isUploading ? (
                      <span className="text-yellow-600">はい</span>
                    ) : (
                      <span className="text-gray-600">いいえ</span>
                    )}
                  </div>
                  <div>
                    <span className="font-medium">結果:</span>{' '}
                    {result ? (
                      <span className="text-green-600">成功</span>
                    ) : error ? (
                      <span className="text-red-600">エラー</span>
                    ) : (
                      <span className="text-gray-600">未実行</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* デバッグ情報 */}
          <div className="mt-8 pt-8 border-t border-gray-200">
            <h2 className="text-xl font-semibold mb-4">デバッグ情報</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div className="p-4 bg-gray-50 rounded">
                <h3 className="font-medium mb-2">環境変数</h3>
                <div className="space-y-1 text-xs">
                  <div>
                    <span className="font-mono">NODE_ENV:</span>{' '}
                    {process.env.NODE_ENV || 'undefined'}
                  </div>
                  <div>
                    <span className="font-mono">API Endpoint:</span> /api/image-embedding
                  </div>
                </div>
              </div>
              <div className="p-4 bg-gray-50 rounded">
                <h3 className="font-medium mb-2">チェックリスト</h3>
                <div className="space-y-1 text-xs">
                  <div>□ AWS認証情報が設定されているか</div>
                  <div>□ Bedrockモデルアクセスが有効か</div>
                  <div>□ .env.localファイルが存在するか</div>
                  <div>□ 開発サーバーが起動しているか</div>
                </div>
              </div>
            </div>
          </div>

          {/* ヘルプ */}
          <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded">
            <h3 className="font-medium text-blue-900 mb-2">トラブルシューティング</h3>
            <ul className="text-sm text-blue-800 space-y-1">
              <li>1. ブラウザのDeveloper Tools (F12) を開く</li>
              <li>2. Consoleタブでエラーメッセージを確認</li>
              <li>3. Networkタブで /api/image-embedding のレスポンスを確認</li>
              <li>4. ターミナルで開発サーバーのログを確認</li>
              <li>5. scripts/diagnose-image-upload.sh を実行して環境を診断</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
