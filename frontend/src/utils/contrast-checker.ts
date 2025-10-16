/**
 * WCAG AAA Contrast Ratio Verification Utility
 * Ensures all text/background combinations meet the 7:1 contrast ratio requirement
 */

// Convert hex to RGB
const hexToRgb = (hex: string): { r: number; g: number; b: number } => {
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
const getLuminance = (rgb: { r: number; g: number; b: number }): number => {
  const [r, g, b] = [rgb.r, rgb.g, rgb.b].map((val) => {
    const v = val / 255
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

// Calculate contrast ratio
const getContrastRatio = (color1: string, color2: string): number => {
  const rgb1 = hexToRgb(color1)
  const rgb2 = hexToRgb(color2)
  const lum1 = getLuminance(rgb1)
  const lum2 = getLuminance(rgb2)
  const lighter = Math.max(lum1, lum2)
  const darker = Math.min(lum1, lum2)
  return (lighter + 0.05) / (darker + 0.05)
}

// Color palette for CIS File Search
export const colorPalette = {
  light: {
    // Text colors
    primaryText: '#1D1D1F', // Main text
    secondaryText: '#424245', // Secondary text
    mutedText: '#6E6E73', // Muted/label text
    placeholderText: '#8E8E93', // Placeholder text

    // Background colors
    primaryBg: '#FFFFFF', // Pure white
    secondaryBg: '#FBFBFD', // Near white
    tertiaryBg: '#F5F5F7', // Light gray
    cardBg: '#FFFFFF', // Card backgrounds (with opacity)

    // Accent colors
    systemBlue: '#007AFF',
    systemGreen: '#34C759',
    systemPurple: '#5856D6',

    // Semantic colors
    success: '#34C759',
    warning: '#FF9500',
    error: '#FF3B30',
  },
  dark: {
    // Text colors
    primaryText: '#F5F5F7', // Main text in dark mode
    secondaryText: '#C7C7CC', // Secondary text
    mutedText: '#8E8E93', // Muted/label text
    placeholderText: '#98989D', // Placeholder text

    // Background colors
    primaryBg: '#000000', // Pure black
    secondaryBg: '#0C0C0E', // Near black
    tertiaryBg: '#1C1C1E', // Dark gray
    cardBg: '#1C1C1E', // Card backgrounds (with opacity)
    quaternaryBg: '#2C2C2E', // Lighter dark gray

    // Accent colors
    systemBlue: '#0A84FF',
    systemGreen: '#32D74B',
    systemPurple: '#5E5CE6',

    // Semantic colors
    success: '#32D74B',
    warning: '#FF9F0A',
    error: '#FF453A',
  },
}

// Test combinations
export const contrastTests = {
  lightMode: [
    { name: 'Primary Text on White', text: colorPalette.light.primaryText, bg: colorPalette.light.primaryBg },
    { name: 'Primary Text on Secondary Bg', text: colorPalette.light.primaryText, bg: colorPalette.light.secondaryBg },
    { name: 'Primary Text on Tertiary Bg', text: colorPalette.light.primaryText, bg: colorPalette.light.tertiaryBg },
    { name: 'Secondary Text on White', text: colorPalette.light.secondaryText, bg: colorPalette.light.primaryBg },
    { name: 'Muted Text on White', text: colorPalette.light.mutedText, bg: colorPalette.light.primaryBg },
    { name: 'System Blue on White', text: colorPalette.light.systemBlue, bg: colorPalette.light.primaryBg },
    { name: 'White on System Blue', text: colorPalette.light.primaryBg, bg: colorPalette.light.systemBlue },
  ],
  darkMode: [
    { name: 'Primary Text on Black', text: colorPalette.dark.primaryText, bg: colorPalette.dark.primaryBg },
    { name: 'Primary Text on Secondary Bg', text: colorPalette.dark.primaryText, bg: colorPalette.dark.secondaryBg },
    { name: 'Primary Text on Tertiary Bg', text: colorPalette.dark.primaryText, bg: colorPalette.dark.tertiaryBg },
    { name: 'Primary Text on Quaternary Bg', text: colorPalette.dark.primaryText, bg: colorPalette.dark.quaternaryBg },
    { name: 'Secondary Text on Black', text: colorPalette.dark.secondaryText, bg: colorPalette.dark.primaryBg },
    { name: 'Muted Text on Black', text: colorPalette.dark.mutedText, bg: colorPalette.dark.primaryBg },
    { name: 'System Blue on Black', text: colorPalette.dark.systemBlue, bg: colorPalette.dark.primaryBg },
    { name: 'White on System Blue', text: colorPalette.dark.primaryText, bg: colorPalette.dark.systemBlue },
  ],
}

// Run contrast tests
export const runContrastTests = () => {
  console.log('🎨 WCAG AAA Contrast Ratio Tests (Target: 7.0+)\n')
  console.log('=' .repeat(60))

  console.log('\n📱 LIGHT MODE\n')
  contrastTests.lightMode.forEach(test => {
    const ratio = getContrastRatio(test.text, test.bg)
    const status = ratio >= 7.0 ? '✅' : ratio >= 4.5 ? '⚠️  (AA only)' : '❌'
    console.log(`${status} ${test.name}: ${ratio.toFixed(2)}:1`)
    console.log(`   Text: ${test.text} | Background: ${test.bg}`)
  })

  console.log('\n🌙 DARK MODE\n')
  contrastTests.darkMode.forEach(test => {
    const ratio = getContrastRatio(test.text, test.bg)
    const status = ratio >= 7.0 ? '✅' : ratio >= 4.5 ? '⚠️  (AA only)' : '❌'
    console.log(`${status} ${test.name}: ${ratio.toFixed(2)}:1`)
    console.log(`   Text: ${test.text} | Background: ${test.bg}`)
  })

  console.log('\n' + '=' .repeat(60))
  console.log('✅ = WCAG AAA (7:1+) | ⚠️  = WCAG AA (4.5:1+) | ❌ = Fail')
}

// Export for use in components
export { getContrastRatio }