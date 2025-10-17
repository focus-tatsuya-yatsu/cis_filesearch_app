import { getContrastRatio, colorPalette, contrastTests } from './contrast-checker'

describe('contrast-checker', () => {
  describe('getContrastRatio', () => {
    it('黒と白のコントラスト比が21:1であること', () => {
      // Arrange
      const black = '#000000'
      const white = '#FFFFFF'

      // Act
      const ratio = getContrastRatio(black, white)

      // Assert
      expect(ratio).toBeCloseTo(21, 0)
    })

    it('同じ色のコントラスト比が1:1であること', () => {
      // Arrange
      const color = '#FF0000'

      // Act
      const ratio = getContrastRatio(color, color)

      // Assert
      expect(ratio).toBeCloseTo(1, 1)
    })

    it('白と白のコントラスト比が1:1であること', () => {
      // Arrange
      const white = '#FFFFFF'

      // Act
      const ratio = getContrastRatio(white, white)

      // Assert
      expect(ratio).toBeCloseTo(1, 1)
    })

    it('黒と黒のコントラスト比が1:1であること', () => {
      // Arrange
      const black = '#000000'

      // Act
      const ratio = getContrastRatio(black, black)

      // Assert
      expect(ratio).toBeCloseTo(1, 1)
    })

    it('#記号なしのhex値でも正しく計算されること', () => {
      // Arrange
      const black = '000000'
      const white = 'FFFFFF'

      // Act
      const ratio = getContrastRatio(black, white)

      // Assert
      expect(ratio).toBeCloseTo(21, 0)
    })

    it('小文字のhex値でも正しく計算されること', () => {
      // Arrange
      const black = '#000000'
      const white = '#ffffff'

      // Act
      const ratio = getContrastRatio(black, white)

      // Assert
      expect(ratio).toBeCloseTo(21, 0)
    })

    it('色の順序を入れ替えても同じ比率が返ること', () => {
      // Arrange
      const color1 = '#007AFF'
      const color2 = '#FFFFFF'

      // Act
      const ratio1 = getContrastRatio(color1, color2)
      const ratio2 = getContrastRatio(color2, color1)

      // Assert
      expect(ratio1).toBeCloseTo(ratio2, 2)
    })
  })

  describe('WCAG AAA基準 (7:1) のテスト', () => {
    describe('ライトモード', () => {
      it('Primary Text on White が WCAG AAA基準を満たすこと', () => {
        // Arrange
        const textColor = colorPalette.light.primaryText
        const bgColor = colorPalette.light.primaryBg

        // Act
        const ratio = getContrastRatio(textColor, bgColor)

        // Assert
        expect(ratio).toBeGreaterThanOrEqual(7.0)
      })

      it('Secondary Text on White が WCAG AAA基準を満たすこと', () => {
        // Arrange
        const textColor = colorPalette.light.secondaryText
        const bgColor = colorPalette.light.primaryBg

        // Act
        const ratio = getContrastRatio(textColor, bgColor)

        // Assert
        expect(ratio).toBeGreaterThanOrEqual(7.0)
      })

      it('System Blue on White が適切なコントラストを持つこと', () => {
        // Arrange
        const textColor = colorPalette.light.systemBlue
        const bgColor = colorPalette.light.primaryBg

        // Act
        const ratio = getContrastRatio(textColor, bgColor)

        // Assert
        // System Blue はアクセントカラーなので3:1以上のコントラストがあること
        expect(ratio).toBeGreaterThanOrEqual(3.0)
      })

      it('White on System Blue が適切なコントラストを持つこと', () => {
        // Arrange
        const textColor = colorPalette.light.primaryBg
        const bgColor = colorPalette.light.systemBlue

        // Act
        const ratio = getContrastRatio(textColor, bgColor)

        // Assert
        // ボタンなどで使用されるため、最低でもWCAG AA (3:1) を満たすこと
        expect(ratio).toBeGreaterThanOrEqual(3.0)
      })
    })

    describe('ダークモード', () => {
      it('Primary Text on Black が WCAG AAA基準を満たすこと', () => {
        // Arrange
        const textColor = colorPalette.dark.primaryText
        const bgColor = colorPalette.dark.primaryBg

        // Act
        const ratio = getContrastRatio(textColor, bgColor)

        // Assert
        expect(ratio).toBeGreaterThanOrEqual(7.0)
      })

      it('Secondary Text on Black が WCAG AAA基準を満たすこと', () => {
        // Arrange
        const textColor = colorPalette.dark.secondaryText
        const bgColor = colorPalette.dark.primaryBg

        // Act
        const ratio = getContrastRatio(textColor, bgColor)

        // Assert
        expect(ratio).toBeGreaterThanOrEqual(7.0)
      })

      it('System Blue on Black が十分なコントラストを持つこと', () => {
        // Arrange
        const textColor = colorPalette.dark.systemBlue
        const bgColor = colorPalette.dark.primaryBg

        // Act
        const ratio = getContrastRatio(textColor, bgColor)

        // Assert
        // System Blue (Dark) はアクセントカラーなので最低でもWCAG AA (4.5:1) を満たすこと
        expect(ratio).toBeGreaterThanOrEqual(4.5)
      })

      it('Primary Text on System Blue が適切なコントラストを持つこと', () => {
        // Arrange
        const textColor = colorPalette.dark.primaryText
        const bgColor = colorPalette.dark.systemBlue

        // Act
        const ratio = getContrastRatio(textColor, bgColor)

        // Assert
        // ボタンなどで使用されるため、最低でもWCAG AA (3:1) を満たすこと
        expect(ratio).toBeGreaterThanOrEqual(3.0)
      })

      it('Primary Text on Tertiary Bg が WCAG AAA基準を満たすこと', () => {
        // Arrange
        const textColor = colorPalette.dark.primaryText
        const bgColor = colorPalette.dark.tertiaryBg

        // Act
        const ratio = getContrastRatio(textColor, bgColor)

        // Assert
        expect(ratio).toBeGreaterThanOrEqual(7.0)
      })

      it('Primary Text on Quaternary Bg が WCAG AAA基準を満たすこと', () => {
        // Arrange
        const textColor = colorPalette.dark.primaryText
        const bgColor = colorPalette.dark.quaternaryBg

        // Act
        const ratio = getContrastRatio(textColor, bgColor)

        // Assert
        expect(ratio).toBeGreaterThanOrEqual(7.0)
      })
    })
  })

  describe('カラーパレット構造のテスト', () => {
    it('light モードの必須カラーが定義されていること', () => {
      // Assert
      expect(colorPalette.light).toHaveProperty('primaryText')
      expect(colorPalette.light).toHaveProperty('secondaryText')
      expect(colorPalette.light).toHaveProperty('mutedText')
      expect(colorPalette.light).toHaveProperty('placeholderText')
      expect(colorPalette.light).toHaveProperty('primaryBg')
      expect(colorPalette.light).toHaveProperty('systemBlue')
    })

    it('dark モードの必須カラーが定義されていること', () => {
      // Assert
      expect(colorPalette.dark).toHaveProperty('primaryText')
      expect(colorPalette.dark).toHaveProperty('secondaryText')
      expect(colorPalette.dark).toHaveProperty('mutedText')
      expect(colorPalette.dark).toHaveProperty('placeholderText')
      expect(colorPalette.dark).toHaveProperty('primaryBg')
      expect(colorPalette.dark).toHaveProperty('systemBlue')
    })

    it('すべてのカラー値が有効なHEX形式であること', () => {
      // Arrange
      const hexPattern = /^#?[0-9A-Fa-f]{6}$/

      // Act & Assert - Light mode
      Object.values(colorPalette.light).forEach((color) => {
        expect(color).toMatch(hexPattern)
      })

      // Act & Assert - Dark mode
      Object.values(colorPalette.dark).forEach((color) => {
        expect(color).toMatch(hexPattern)
      })
    })
  })

  describe('contrastTests構造のテスト', () => {
    it('lightModeテストケースが定義されていること', () => {
      // Assert
      expect(contrastTests.lightMode).toBeDefined()
      expect(Array.isArray(contrastTests.lightMode)).toBe(true)
      expect(contrastTests.lightMode.length).toBeGreaterThan(0)
    })

    it('darkModeテストケースが定義されていること', () => {
      // Assert
      expect(contrastTests.darkMode).toBeDefined()
      expect(Array.isArray(contrastTests.darkMode)).toBe(true)
      expect(contrastTests.darkMode.length).toBeGreaterThan(0)
    })

    it('各テストケースが必須プロパティを持つこと', () => {
      // Assert - Light mode
      contrastTests.lightMode.forEach((test) => {
        expect(test).toHaveProperty('name')
        expect(test).toHaveProperty('text')
        expect(test).toHaveProperty('bg')
        expect(typeof test.name).toBe('string')
        expect(typeof test.text).toBe('string')
        expect(typeof test.bg).toBe('string')
      })

      // Assert - Dark mode
      contrastTests.darkMode.forEach((test) => {
        expect(test).toHaveProperty('name')
        expect(test).toHaveProperty('text')
        expect(test).toHaveProperty('bg')
        expect(typeof test.name).toBe('string')
        expect(typeof test.text).toBe('string')
        expect(typeof test.bg).toBe('string')
      })
    })
  })

  describe('実用的なコントラスト比のテスト', () => {
    it('一般的なグレーの組み合わせのコントラストが計算できること', () => {
      // Arrange
      const lightGray = '#CCCCCC'
      const darkGray = '#333333'

      // Act
      const ratio = getContrastRatio(lightGray, darkGray)

      // Assert
      expect(ratio).toBeGreaterThan(1)
      expect(ratio).toBeLessThan(21)
    })

    it('赤と緑のコントラスト比が計算できること', () => {
      // Arrange
      const red = '#FF0000'
      const green = '#00FF00'

      // Act
      const ratio = getContrastRatio(red, green)

      // Assert
      expect(ratio).toBeGreaterThan(1)
      expect(ratio).toBeLessThan(21)
    })

    it('青と黄色のコントラスト比が計算できること', () => {
      // Arrange
      const blue = '#0000FF'
      const yellow = '#FFFF00'

      // Act
      const ratio = getContrastRatio(blue, yellow)

      // Assert
      expect(ratio).toBeGreaterThan(1)
      expect(ratio).toBeLessThan(21)
    })
  })

  describe('エッジケースのテスト', () => {
    it('無効なHEX値に対してもエラーにならないこと', () => {
      // Arrange
      const invalidHex = 'ZZZZZZ'
      const validHex = '#FFFFFF'

      // Act & Assert
      expect(() => getContrastRatio(invalidHex, validHex)).not.toThrow()
    })

    it('空文字列に対してもエラーにならないこと', () => {
      // Arrange
      const emptyString = ''
      const validHex = '#FFFFFF'

      // Act & Assert
      expect(() => getContrastRatio(emptyString, validHex)).not.toThrow()
    })

    it('短いHEX値に対してもエラーにならないこと', () => {
      // Arrange
      const shortHex = '#FFF'
      const validHex = '#FFFFFF'

      // Act & Assert
      expect(() => getContrastRatio(shortHex, validHex)).not.toThrow()
    })
  })

  describe('精度テスト', () => {
    it('コントラスト比の計算が十分な精度を持つこと', () => {
      // Arrange
      const color1 = '#007AFF'
      const color2 = '#FFFFFF'

      // Act
      const ratio1 = getContrastRatio(color1, color2)
      const ratio2 = getContrastRatio(color1, color2)

      // Assert - 同じ入力に対して同じ結果が返ること
      expect(ratio1).toBe(ratio2)
    })

    it('計算結果が常に正の数であること', () => {
      // Arrange
      const testPairs = [
        ['#000000', '#FFFFFF'],
        ['#FF0000', '#00FF00'],
        ['#0000FF', '#FFFF00'],
        ['#123456', '#ABCDEF'],
      ]

      // Act & Assert
      testPairs.forEach(([color1, color2]) => {
        const ratio = getContrastRatio(color1, color2)
        expect(ratio).toBeGreaterThan(0)
      })
    })

    it('コントラスト比が21を超えないこと', () => {
      // Arrange
      const testPairs = [
        ['#000000', '#FFFFFF'],
        ['#FFFFFF', '#000000'],
        ['#FF0000', '#FFFFFF'],
        ['#000000', '#00FF00'],
      ]

      // Act & Assert
      testPairs.forEach(([color1, color2]) => {
        const ratio = getContrastRatio(color1, color2)
        expect(ratio).toBeLessThanOrEqual(21)
      })
    })
  })
})
