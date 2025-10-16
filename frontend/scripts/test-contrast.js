#!/usr/bin/env node

/**
 * Standalone contrast ratio tester for WCAG AAA compliance
 */

// Convert hex to RGB
const hexToRgb = (hex) => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : { r: 0, g: 0, b: 0 }
}

// Calculate relative luminance
const getLuminance = (rgb) => {
  const [r, g, b] = [rgb.r, rgb.g, rgb.b].map((val) => {
    const v = val / 255
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

// Calculate contrast ratio
const getContrastRatio = (color1, color2) => {
  const rgb1 = hexToRgb(color1)
  const rgb2 = hexToRgb(color2)
  const lum1 = getLuminance(rgb1)
  const lum2 = getLuminance(rgb2)
  const lighter = Math.max(lum1, lum2)
  const darker = Math.min(lum1, lum2)
  return (lighter + 0.05) / (darker + 0.05)
}

// Test combinations
const tests = {
  'Light Mode': [
    { name: 'Primary Text (#1D1D1F) on White', text: '#1D1D1F', bg: '#FFFFFF' },
    { name: 'Primary Text on Near White (#FBFBFD)', text: '#1D1D1F', bg: '#FBFBFD' },
    { name: 'Primary Text on Light Gray (#F5F5F7)', text: '#1D1D1F', bg: '#F5F5F7' },
    { name: 'Secondary Text (#424245) on White', text: '#424245', bg: '#FFFFFF' },
    { name: 'Muted Text (#6E6E73) on White', text: '#6E6E73', bg: '#FFFFFF' },
    { name: 'Placeholder (#8E8E93) on White', text: '#8E8E93', bg: '#FFFFFF' },
    { name: 'System Blue (#007AFF) on White', text: '#007AFF', bg: '#FFFFFF' },
    { name: 'White on System Blue', text: '#FFFFFF', bg: '#007AFF' },
  ],
  'Dark Mode': [
    { name: 'Primary Text (#F5F5F7) on Black', text: '#F5F5F7', bg: '#000000' },
    { name: 'Primary Text on Near Black (#0C0C0E)', text: '#F5F5F7', bg: '#0C0C0E' },
    { name: 'Primary Text on Dark Gray (#1C1C1E)', text: '#F5F5F7', bg: '#1C1C1E' },
    { name: 'Primary Text on Lighter Gray (#2C2C2E)', text: '#F5F5F7', bg: '#2C2C2E' },
    { name: 'Secondary Text (#C7C7CC) on Black', text: '#C7C7CC', bg: '#000000' },
    { name: 'Muted Text (#8E8E93) on Black', text: '#8E8E93', bg: '#000000' },
    { name: 'Placeholder (#98989D) on Black', text: '#98989D', bg: '#000000' },
    { name: 'System Blue (#0A84FF) on Black', text: '#0A84FF', bg: '#000000' },
    { name: 'White on System Blue (Dark)', text: '#F5F5F7', bg: '#0A84FF' },
  ],
}

console.log('\n🎨 CIS File Search - WCAG AAA Contrast Ratio Verification')
console.log('=' .repeat(70))
console.log('Target: 7.0:1 for WCAG AAA compliance')
console.log('=' .repeat(70))

Object.entries(tests).forEach(([mode, modeTests]) => {
  console.log(`\n📱 ${mode.toUpperCase()}`)
  console.log('-'.repeat(70))

  let passCount = 0
  let warningCount = 0
  let failCount = 0

  modeTests.forEach(test => {
    const ratio = getContrastRatio(test.text, test.bg)
    let status, color

    if (ratio >= 7.0) {
      status = '✅ PASS (AAA)'
      color = '\x1b[32m'
      passCount++
    } else if (ratio >= 4.5) {
      status = '⚠️  WARN (AA only)'
      color = '\x1b[33m'
      warningCount++
    } else {
      status = '❌ FAIL'
      color = '\x1b[31m'
      failCount++
    }

    console.log(`${color}${status}\x1b[0m ${test.name.padEnd(45)} ${ratio.toFixed(2)}:1`)
  })

  console.log('\n📊 Summary:')
  console.log(`   ✅ WCAG AAA Pass: ${passCount}/${modeTests.length}`)
  console.log(`   ⚠️  WCAG AA Only: ${warningCount}/${modeTests.length}`)
  console.log(`   ❌ Failed: ${failCount}/${modeTests.length}`)
})

console.log('\n' + '=' .repeat(70))
console.log('✅ = WCAG AAA (7:1+) | ⚠️  = WCAG AA only (4.5:1+) | ❌ = Fail (<4.5:1)')
console.log('=' .repeat(70) + '\n')