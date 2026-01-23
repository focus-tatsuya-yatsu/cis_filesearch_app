/**
 * Protocol Handler Utility
 *
 * CIS File Searchアプリケーションからカスタムプロトコル（cis-open://）を
 * 使用してNASファイルを開くためのユーティリティ
 */

/**
 * プロトコルハンドラーの設定
 */
export const PROTOCOL_CONFIG = {
  /** プロトコル名 */
  name: 'cis-open',
  /** プロトコルURL形式 */
  scheme: 'cis-open://',
  /** インストーラーのダウンロードパス */
  installerPath: '/downloads/CIS-FileHandler-Setup.zip',
  /** ハンドラーがインストールされているかチェックするためのローカルストレージキー */
  storageKey: 'cis-protocol-handler-installed',
  /** インストール案内を表示しないためのローカルストレージキー */
  dismissedKey: 'cis-protocol-handler-prompt-dismissed',
}

/**
 * ユーザーがハンドラーインストールを「インストール済み」としてマークしているか確認
 * 注: これは実際のインストール状態ではなく、ユーザーの自己申告
 */
export const isHandlerMarkedAsInstalled = (): boolean => {
  if (typeof window === 'undefined') return false
  return localStorage.getItem(PROTOCOL_CONFIG.storageKey) === 'true'
}

/**
 * ハンドラーを「インストール済み」としてマーク
 */
export const markHandlerAsInstalled = (): void => {
  if (typeof window === 'undefined') return
  localStorage.setItem(PROTOCOL_CONFIG.storageKey, 'true')
}

/**
 * ハンドラーの「インストール済み」マークを解除
 */
export const unmarkHandlerAsInstalled = (): void => {
  if (typeof window === 'undefined') return
  localStorage.removeItem(PROTOCOL_CONFIG.storageKey)
}

/**
 * インストール案内を非表示にするフラグを設定
 */
export const dismissInstallPrompt = (): void => {
  if (typeof window === 'undefined') return
  localStorage.setItem(PROTOCOL_CONFIG.dismissedKey, 'true')
}

/**
 * インストール案内が非表示に設定されているか確認
 */
export const isInstallPromptDismissed = (): boolean => {
  if (typeof window === 'undefined') return false
  return localStorage.getItem(PROTOCOL_CONFIG.dismissedKey) === 'true'
}

/**
 * インストール案内の非表示設定をリセット
 */
export const resetInstallPromptDismissed = (): void => {
  if (typeof window === 'undefined') return
  localStorage.removeItem(PROTOCOL_CONFIG.dismissedKey)
}

/**
 * プロトコルハンドラーが利用可能かどうかを検出
 *
 * 注: ブラウザのセキュリティ制限により、カスタムプロトコルハンドラーの
 * インストール状態を直接検出することはできません。この関数は
 * navigator.registerProtocolHandler APIの存在チェックのみ行います。
 *
 * 実際のインストール状態は、ユーザーが「ファイルを開く」を試行した後に
 * 自己申告で記録する方式を採用しています。
 */
export const canUseCustomProtocol = (): boolean => {
  if (typeof window === 'undefined') return false

  // Windows環境のチェック（カスタムプロトコルはWindows専用）
  const isWindows = navigator.platform.toLowerCase().includes('win')
  if (!isWindows) return false

  return true
}

/**
 * OSがWindowsかどうかを判定
 */
export const isWindowsOS = (): boolean => {
  if (typeof window === 'undefined') return false
  return navigator.platform.toLowerCase().includes('win')
}

/**
 * OSがMacかどうかを判定
 */
export const isMacOS = (): boolean => {
  if (typeof window === 'undefined') return false
  return navigator.platform.toLowerCase().includes('mac')
}

/**
 * カスタムプロトコルURLを生成
 */
export const createProtocolUrl = (uncPath: string): string => {
  // UNCパスをURLエンコード
  const encodedPath = encodeURIComponent(uncPath)
  return `${PROTOCOL_CONFIG.scheme}${encodedPath}`
}

/**
 * カスタムプロトコルでファイルを開く
 *
 * @param uncPath UNC形式のファイルパス (例: \\\\ts-server3\\share\\file.pdf)
 * @returns true: 正常に開いた（はず）、false: 開けなかった
 */
export const openWithProtocol = (uncPath: string): boolean => {
  if (!canUseCustomProtocol()) {
    return false
  }

  try {
    const protocolUrl = createProtocolUrl(uncPath)
    window.location.href = protocolUrl
    return true
  } catch (error) {
    console.error('Failed to open with custom protocol:', error)
    return false
  }
}

/**
 * インストール状態の表示テキストを取得
 */
export const getInstallStatusText = (): string => {
  if (isHandlerMarkedAsInstalled()) {
    return 'インストール済み'
  }
  if (isInstallPromptDismissed()) {
    return '後でインストール'
  }
  return '未インストール'
}
