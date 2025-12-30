/**
 * useToast Hook Unit Tests
 */

import { renderHook } from '@testing-library/react'
import { useToast } from './useToast'

describe('useToast', () => {
  it('should return toast methods', () => {
    const { result } = renderHook(() => useToast())

    expect(result.current).toHaveProperty('success')
    expect(result.current).toHaveProperty('error')
    expect(result.current).toHaveProperty('warning')
    expect(result.current).toHaveProperty('info')
    expect(result.current).toHaveProperty('loading')
    expect(result.current).toHaveProperty('dismiss')
    expect(result.current).toHaveProperty('promise')
  })

  it('should have all methods as functions', () => {
    const { result } = renderHook(() => useToast())

    expect(typeof result.current.success).toBe('function')
    expect(typeof result.current.error).toBe('function')
    expect(typeof result.current.warning).toBe('function')
    expect(typeof result.current.info).toBe('function')
    expect(typeof result.current.loading).toBe('function')
    expect(typeof result.current.dismiss).toBe('function')
    expect(typeof result.current.promise).toBe('function')
  })
})
