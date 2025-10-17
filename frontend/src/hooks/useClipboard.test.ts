/**
 * @jest-environment jsdom
 */

import { renderHook, act, waitFor } from '@testing-library/react'

import { useClipboard } from './useClipboard'

describe('useClipboard', () => {
  const mockWriteText = jest.fn()

  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers()

    // Mock navigator.clipboard
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: mockWriteText,
      },
      writable: true,
      configurable: true,
    })
  })

  afterEach(() => {
    jest.runOnlyPendingTimers()
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  describe('初期状態', () => {
    it('copied は false で初期化される', () => {
      const { result } = renderHook(() => useClipboard())
      expect(result.current.copied).toBe(false)
    })

    it('error は null で初期化される', () => {
      const { result } = renderHook(() => useClipboard())
      expect(result.current.error).toBe(null)
    })

    it('copyToClipboard 関数が提供される', () => {
      const { result } = renderHook(() => useClipboard())
      expect(typeof result.current.copyToClipboard).toBe('function')
    })
  })

  describe('copyToClipboard 関数', () => {
    it('クリップボードにテキストをコピーできる', async () => {
      mockWriteText.mockResolvedValueOnce(undefined)
      const { result } = renderHook(() => useClipboard())

      await act(async () => {
        await result.current.copyToClipboard('test text')
      })

      expect(mockWriteText).toHaveBeenCalledWith('test text')
      expect(mockWriteText).toHaveBeenCalledTimes(1)
    })

    it('コピー成功時に copied が true になる', async () => {
      mockWriteText.mockResolvedValueOnce(undefined)
      const { result } = renderHook(() => useClipboard())

      await act(async () => {
        await result.current.copyToClipboard('test text')
      })

      expect(result.current.copied).toBe(true)
    })

    it('コピー成功時に error が null になる', async () => {
      const { result } = renderHook(() => useClipboard())

      // 先にエラーを発生させる
      mockWriteText.mockRejectedValueOnce(new Error('first error'))
      await act(async () => {
        await result.current.copyToClipboard('fail')
      })
      expect(result.current.error).not.toBe(null)

      // 成功時に error が null になることを確認
      mockWriteText.mockResolvedValueOnce(undefined)
      await act(async () => {
        await result.current.copyToClipboard('success')
      })

      expect(result.current.error).toBe(null)
    })

    it('デフォルトで 2 秒後に copied が false に戻る', async () => {
      mockWriteText.mockResolvedValueOnce(undefined)
      const { result } = renderHook(() => useClipboard())

      await act(async () => {
        await result.current.copyToClipboard('test text')
      })

      expect(result.current.copied).toBe(true)

      await act(async () => {
        jest.advanceTimersByTime(2000)
      })

      await waitFor(() => {
        expect(result.current.copied).toBe(false)
      })
    })

    it('カスタムタイムアウトが機能する', async () => {
      mockWriteText.mockResolvedValueOnce(undefined)
      const { result } = renderHook(() => useClipboard(5000))

      await act(async () => {
        await result.current.copyToClipboard('test text')
      })

      expect(result.current.copied).toBe(true)

      // 2秒後もまだ true
      await act(async () => {
        jest.advanceTimersByTime(2000)
      })
      await waitFor(() => {
        expect(result.current.copied).toBe(true)
      })

      // 5秒後に false
      await act(async () => {
        jest.advanceTimersByTime(3000)
      })
      await waitFor(() => {
        expect(result.current.copied).toBe(false)
      })
    })

    it('コピー失敗時に error がセットされる', async () => {
      const { result } = renderHook(() => useClipboard())

      const testError = new Error('Clipboard write failed')
      mockWriteText.mockRejectedValueOnce(testError)

      await act(async () => {
        await result.current.copyToClipboard('test text')
      })

      expect(result.current.error).toEqual(testError)
      expect(result.current.copied).toBe(false)
    })

    it('非 Error オブジェクトのエラーも Error に変換される', async () => {
      const { result } = renderHook(() => useClipboard())

      mockWriteText.mockRejectedValueOnce('string error')

      await act(async () => {
        await result.current.copyToClipboard('test text')
      })

      expect(result.current.error).toBeInstanceOf(Error)
      expect(result.current.error?.message).toBe('Failed to copy to clipboard')
    })

    it('エラー時にコンソールエラーが出力される', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation()
      const { result } = renderHook(() => useClipboard())

      const testError = new Error('Test error')
      mockWriteText.mockRejectedValueOnce(testError)

      await act(async () => {
        await result.current.copyToClipboard('test text')
      })

      expect(consoleSpy).toHaveBeenCalledWith('Failed to copy to clipboard:', testError)
      consoleSpy.mockRestore()
    })
  })

  describe('複数回のコピー操作', () => {
    it('連続してコピー操作ができる', async () => {
      mockWriteText.mockResolvedValue(undefined)
      const { result } = renderHook(() => useClipboard())

      await act(async () => {
        await result.current.copyToClipboard('first text')
      })
      expect(mockWriteText).toHaveBeenCalledWith('first text')

      await act(async () => {
        await result.current.copyToClipboard('second text')
      })
      expect(mockWriteText).toHaveBeenCalledWith('second text')
      expect(mockWriteText).toHaveBeenCalledTimes(2)
    })

    it('タイムアウト前に再度コピーすると copied が true のまま', async () => {
      mockWriteText.mockResolvedValue(undefined)
      const { result } = renderHook(() => useClipboard())

      await act(async () => {
        await result.current.copyToClipboard('first')
      })
      expect(result.current.copied).toBe(true)

      // 1秒経過（タイムアウト前）
      await act(async () => {
        jest.advanceTimersByTime(1000)
      })

      await act(async () => {
        await result.current.copyToClipboard('second')
      })
      expect(result.current.copied).toBe(true)

      // 最後のコピーから2秒後に false
      await act(async () => {
        jest.advanceTimersByTime(2000)
      })
      await waitFor(() => {
        expect(result.current.copied).toBe(false)
      })
    })
  })

  describe('パフォーマンス最適化', () => {
    it('copyToClipboard 関数は timeout が変わらない限り同じ参照を保つ', () => {
      const { result, rerender } = renderHook(() => useClipboard(2000))
      const firstRef = result.current.copyToClipboard

      rerender()
      expect(result.current.copyToClipboard).toBe(firstRef)
    })

    it('timeout が変更されると copyToClipboard の参照が変わる', () => {
      const { result, rerender } = renderHook(({ timeout }) => useClipboard(timeout), {
        initialProps: { timeout: 2000 },
      })
      const firstRef = result.current.copyToClipboard

      rerender({ timeout: 5000 })
      expect(result.current.copyToClipboard).not.toBe(firstRef)
    })
  })
})
