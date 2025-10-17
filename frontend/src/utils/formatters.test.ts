/**
 * @jest-environment jsdom
 */

import { formatFileSize, formatDate } from './formatters'

describe('formatFileSize', () => {
  it('should format 0 bytes correctly', () => {
    expect(formatFileSize(0)).toBe('0 B')
  })

  it('should format bytes (< 1KB) correctly', () => {
    expect(formatFileSize(500)).toBe('500 B')
    expect(formatFileSize(1023)).toBe('1023 B')
  })

  it('should format kilobytes correctly', () => {
    expect(formatFileSize(1024)).toBe('1 KB')
    expect(formatFileSize(1536)).toBe('1.5 KB')
    expect(formatFileSize(2048)).toBe('2 KB')
  })

  it('should format megabytes correctly', () => {
    expect(formatFileSize(1048576)).toBe('1 MB')
    expect(formatFileSize(2457600)).toBe('2.34 MB')
    expect(formatFileSize(5242880)).toBe('5 MB')
  })

  it('should format gigabytes correctly', () => {
    expect(formatFileSize(1073741824)).toBe('1 GB')
    expect(formatFileSize(2147483648)).toBe('2 GB')
  })

  it('should round to 2 decimal places', () => {
    expect(formatFileSize(1536000)).toBe('1.46 MB')
    expect(formatFileSize(1234567)).toBe('1.18 MB')
  })
})

describe('formatDate', () => {
  it('should format ISO date string to Japanese format', () => {
    const result = formatDate('2024-01-15T10:30:00')
    // Expected format: YYYY/MM/DD HH:mm (Japanese locale)
    expect(result).toMatch(/2024\/01\/15/)
    expect(result).toMatch(/10:30/)
  })

  it('should handle different date formats', () => {
    const result = formatDate('2024-12-31T23:59:59')
    expect(result).toMatch(/2024\/12\/31/)
    expect(result).toMatch(/23:59/)
  })

  it('should format single-digit months and days with leading zeros', () => {
    const result = formatDate('2024-01-05T09:15:00')
    expect(result).toMatch(/2024\/01\/05/)
    expect(result).toMatch(/09:15/)
  })

  it('should handle Date object input (via string conversion)', () => {
    const date = new Date('2024-06-15T14:20:00')
    const result = formatDate(date.toISOString())
    expect(result).toMatch(/2024\/06\/15/)
    expect(result).toMatch(/14:20/)
  })

  it('should handle midnight correctly', () => {
    const result = formatDate('2024-01-01T00:00:00')
    expect(result).toMatch(/2024\/01\/01/)
    expect(result).toMatch(/00:00/)
  })
})
