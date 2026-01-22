/**
 * Sync API Client
 * NAS同期トリガーAPIを呼び出すクライアント
 */

import { fetchAuthSession } from 'aws-amplify/auth'

// Sync API 専用エンドポイント
const SYNC_API_URL = process.env.NEXT_PUBLIC_SYNC_API_URL || 'https://glwla2jrsf.execute-api.ap-northeast-1.amazonaws.com'

/**
 * Cognito認証トークンを取得
 */
const getAuthToken = async (): Promise<string> => {
  try {
    const session = await fetchAuthSession()
    const token = session.tokens?.idToken?.toString()
    if (!token) {
      throw new Error('No authentication token available')
    }
    return token
  } catch (error) {
    console.error('Failed to get auth token:', error)
    throw new Error('認証が必要です。ログインしてください。')
  }
}

export interface SyncRequest {
  nasServers?: string[]
  fullSync?: boolean
  triggeredBy?: string
}

export interface SyncProgress {
  current: number
  total: number
  currentNas?: string
  processedFiles?: number
  errors?: number
}

export interface SyncResult {
  newFiles: number
  changedFiles: number
  deletedFiles: number
  syncedFiles: number
  errors: number
}

export interface SyncResponse {
  syncId: string
  status: 'pending' | 'in_progress' | 'completed' | 'failed'
  message?: string
  nasServers?: string[]
  fullSync?: boolean
}

export interface SyncProgressResponse {
  syncId: string
  status: 'pending' | 'in_progress' | 'completed' | 'failed'
  createdAt: string
  updatedAt: string
  nasServers: string[]
  fullSync: boolean
  triggeredBy: string
  progress?: SyncProgress
  result?: SyncResult
  errorMessage?: string
}

export interface SyncError {
  error: string
  message?: string
  syncId?: string
}

/**
 * 同期ジョブを開始
 */
export const startSync = async (request: SyncRequest = {}): Promise<SyncResponse> => {
  const token = await getAuthToken()

  const response = await fetch(`${SYNC_API_URL}/sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      nasServers: request.nasServers || ['ts-server3', 'ts-server5', 'ts-server6', 'ts-server7'],
      fullSync: request.fullSync || false,
      triggeredBy: request.triggeredBy || 'web-ui',
    }),
  })

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('認証が必要です。ログインしてください。')
    }
    const errorData = await response.json().catch(() => ({}))
    throw new Error(errorData.error || `Sync request failed: ${response.status}`)
  }

  return response.json()
}

/**
 * 同期ジョブの進捗を取得
 */
export const getSyncProgress = async (syncId: string): Promise<SyncProgressResponse> => {
  const token = await getAuthToken()

  const response = await fetch(`${SYNC_API_URL}/sync/progress/${syncId}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
  })

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('認証が必要です。ログインしてください。')
    }
    const errorData = await response.json().catch(() => ({}))
    throw new Error(errorData.error || `Failed to get sync progress: ${response.status}`)
  }

  return response.json()
}

/**
 * ステータスに応じた表示テキストを取得
 */
export const getSyncStatusText = (status: SyncProgressResponse['status']): string => {
  switch (status) {
    case 'pending':
      return '待機中'
    case 'in_progress':
      return '同期中'
    case 'completed':
      return '完了'
    case 'failed':
      return '失敗'
    default:
      return '不明'
  }
}

/**
 * ステータスに応じた色を取得
 */
export const getSyncStatusColor = (
  status: SyncProgressResponse['status']
): 'gray' | 'blue' | 'green' | 'red' => {
  switch (status) {
    case 'pending':
      return 'gray'
    case 'in_progress':
      return 'blue'
    case 'completed':
      return 'green'
    case 'failed':
      return 'red'
    default:
      return 'gray'
  }
}
