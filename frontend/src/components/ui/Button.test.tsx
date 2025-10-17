import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Button } from './Button'

describe('Button', () => {
  describe('描画テスト', () => {
    it('正しくレンダリングされること', () => {
      // Arrange & Act
      render(<Button>Click me</Button>)

      // Assert
      expect(screen.getByRole('button', { name: 'Click me' })).toBeInTheDocument()
    })

    it('子要素がレンダリングされること', () => {
      // Arrange & Act
      render(<Button>Test Button</Button>)

      // Assert
      expect(screen.getByText('Test Button')).toBeInTheDocument()
    })

    it('複雑な子要素がレンダリングされること', () => {
      // Arrange & Act
      render(
        <Button>
          <span>Complex</span> <strong>Content</strong>
        </Button>
      )

      // Assert
      expect(screen.getByText('Complex')).toBeInTheDocument()
      expect(screen.getByText('Content')).toBeInTheDocument()
    })
  })

  describe('variant props テスト', () => {
    it('デフォルトでprimaryバリアントが適用されること', () => {
      // Arrange & Act
      render(<Button>Primary Button</Button>)

      // Assert
      const button = screen.getByRole('button')
      expect(button).toHaveClass('bg-primary-600')
    })

    it('primaryバリアントが正しく適用されること', () => {
      // Arrange & Act
      render(<Button variant="primary">Primary</Button>)

      // Assert
      const button = screen.getByRole('button')
      expect(button).toHaveClass('bg-primary-600', 'text-white')
    })

    it('secondaryバリアントが正しく適用されること', () => {
      // Arrange & Act
      render(<Button variant="secondary">Secondary</Button>)

      // Assert
      const button = screen.getByRole('button')
      expect(button).toHaveClass('bg-gray-600', 'text-white')
    })

    it('outlineバリアントが正しく適用されること', () => {
      // Arrange & Act
      render(<Button variant="outline">Outline</Button>)

      // Assert
      const button = screen.getByRole('button')
      expect(button).toHaveClass('border-2', 'border-primary-600', 'text-primary-600')
    })

    it('ghostバリアントが正しく適用されること', () => {
      // Arrange & Act
      render(<Button variant="ghost">Ghost</Button>)

      // Assert
      const button = screen.getByRole('button')
      expect(button).toHaveClass('text-gray-600')
    })
  })

  describe('size props テスト', () => {
    it('デフォルトでmdサイズが適用されること', () => {
      // Arrange & Act
      render(<Button>Medium Button</Button>)

      // Assert
      const button = screen.getByRole('button')
      expect(button).toHaveClass('px-4', 'py-2', 'text-base')
    })

    it('smサイズが正しく適用されること', () => {
      // Arrange & Act
      render(<Button size="sm">Small</Button>)

      // Assert
      const button = screen.getByRole('button')
      expect(button).toHaveClass('px-3', 'py-1.5', 'text-sm')
    })

    it('mdサイズが正しく適用されること', () => {
      // Arrange & Act
      render(<Button size="md">Medium</Button>)

      // Assert
      const button = screen.getByRole('button')
      expect(button).toHaveClass('px-4', 'py-2', 'text-base')
    })

    it('lgサイズが正しく適用されること', () => {
      // Arrange & Act
      render(<Button size="lg">Large</Button>)

      // Assert
      const button = screen.getByRole('button')
      expect(button).toHaveClass('px-6', 'py-3', 'text-lg')
    })
  })

  describe('loading props テスト', () => {
    it('loading=falseの場合はスピナーが表示されないこと', () => {
      // Arrange & Act
      render(<Button loading={false}>Button</Button>)

      // Assert
      expect(screen.queryByRole('img', { hidden: true })).not.toBeInTheDocument()
      expect(screen.getByText('Button')).toBeInTheDocument()
    })

    it('loading=trueの場合はスピナーが表示されること', () => {
      // Arrange & Act
      render(<Button loading={true}>Loading Button</Button>)

      // Assert
      const button = screen.getByRole('button')
      const spinner = button.querySelector('svg.animate-spin')
      expect(spinner).toBeInTheDocument()
    })

    it('loading=trueの場合もchildrenが表示されること', () => {
      // Arrange & Act
      render(<Button loading={true}>Loading</Button>)

      // Assert
      expect(screen.getByText('Loading')).toBeInTheDocument()
    })

    it('loading=trueの場合はボタンがdisabledになること', () => {
      // Arrange & Act
      render(<Button loading={true}>Loading</Button>)

      // Assert
      const button = screen.getByRole('button')
      expect(button).toBeDisabled()
    })

    it('loading=trueの場合はonClickが発火しないこと', async () => {
      // Arrange
      const user = userEvent.setup()
      const handleClick = jest.fn()
      render(
        <Button loading={true} onClick={handleClick}>
          Loading
        </Button>
      )

      // Act
      await user.click(screen.getByRole('button'))

      // Assert
      expect(handleClick).not.toHaveBeenCalled()
    })
  })

  describe('icon props テスト', () => {
    it('iconが渡されない場合は表示されないこと', () => {
      // Arrange & Act
      render(<Button>No Icon</Button>)

      // Assert
      expect(screen.queryByTestId('button-icon')).not.toBeInTheDocument()
    })

    it('iconが正しく表示されること', () => {
      // Arrange & Act
      const icon = <span data-testid="test-icon">Icon</span>
      render(<Button icon={icon}>With Icon</Button>)

      // Assert
      expect(screen.getByTestId('test-icon')).toBeInTheDocument()
      expect(screen.getByText('With Icon')).toBeInTheDocument()
    })

    it('loading時はiconの代わりにスピナーが表示されること', () => {
      // Arrange & Act
      const icon = <span data-testid="test-icon">Icon</span>
      render(
        <Button icon={icon} loading={true}>
          Loading
        </Button>
      )

      // Assert
      expect(screen.queryByTestId('test-icon')).not.toBeInTheDocument()
      const button = screen.getByRole('button')
      const spinner = button.querySelector('svg.animate-spin')
      expect(spinner).toBeInTheDocument()
    })
  })

  describe('disabled props テスト', () => {
    it('disabled=falseの場合はボタンが有効であること', () => {
      // Arrange & Act
      render(<Button disabled={false}>Enabled</Button>)

      // Assert
      expect(screen.getByRole('button')).not.toBeDisabled()
    })

    it('disabled=trueの場合はボタンが無効になること', () => {
      // Arrange & Act
      render(<Button disabled={true}>Disabled</Button>)

      // Assert
      expect(screen.getByRole('button')).toBeDisabled()
    })

    it('disabled=trueの場合はonClickが発火しないこと', async () => {
      // Arrange
      const user = userEvent.setup()
      const handleClick = jest.fn()
      render(
        <Button disabled={true} onClick={handleClick}>
          Disabled
        </Button>
      )

      // Act
      await user.click(screen.getByRole('button'))

      // Assert
      expect(handleClick).not.toHaveBeenCalled()
    })

    it('disabled時は適切なスタイルが適用されること', () => {
      // Arrange & Act
      render(
        <Button variant="primary" disabled={true}>
          Disabled Primary
        </Button>
      )

      // Assert
      const button = screen.getByRole('button')
      expect(button).toHaveClass('disabled:bg-primary-300')
    })
  })

  describe('onClick イベントテスト', () => {
    it('ボタンクリック時にonClickが呼ばれること', async () => {
      // Arrange
      const user = userEvent.setup()
      const handleClick = jest.fn()
      render(<Button onClick={handleClick}>Click Me</Button>)

      // Act
      await user.click(screen.getByRole('button'))

      // Assert
      expect(handleClick).toHaveBeenCalledTimes(1)
    })

    it('複数回クリックすると複数回onClickが呼ばれること', async () => {
      // Arrange
      const user = userEvent.setup()
      const handleClick = jest.fn()
      render(<Button onClick={handleClick}>Click Me</Button>)

      // Act
      const button = screen.getByRole('button')
      await user.click(button)
      await user.click(button)
      await user.click(button)

      // Assert
      expect(handleClick).toHaveBeenCalledTimes(3)
    })

    it('onClickが渡されていない場合もエラーにならないこと', async () => {
      // Arrange
      const user = userEvent.setup()
      render(<Button>No Handler</Button>)

      // Act & Assert - エラーが発生しないことを確認
      await expect(user.click(screen.getByRole('button'))).resolves.not.toThrow()
    })
  })

  describe('type props テスト', () => {
    it('デフォルトでtype属性が設定されないこと', () => {
      // Arrange & Act
      render(<Button>Default Type</Button>)

      // Assert
      const button = screen.getByRole('button')
      expect(button.getAttribute('type')).toBeNull()
    })

    it('type="submit"が正しく設定されること', () => {
      // Arrange & Act
      render(<Button type="submit">Submit</Button>)

      // Assert
      expect(screen.getByRole('button')).toHaveAttribute('type', 'submit')
    })

    it('type="button"が正しく設定されること', () => {
      // Arrange & Act
      render(<Button type="button">Button</Button>)

      // Assert
      expect(screen.getByRole('button')).toHaveAttribute('type', 'button')
    })

    it('type="reset"が正しく設定されること', () => {
      // Arrange & Act
      render(<Button type="reset">Reset</Button>)

      // Assert
      expect(screen.getByRole('button')).toHaveAttribute('type', 'reset')
    })
  })

  describe('className props テスト', () => {
    it('カスタムclassNameが追加されること', () => {
      // Arrange & Act
      render(<Button className="custom-class">Custom</Button>)

      // Assert
      const button = screen.getByRole('button')
      expect(button).toHaveClass('custom-class')
    })

    it('カスタムclassNameが既存のクラスと共存すること', () => {
      // Arrange & Act
      render(
        <Button variant="primary" className="custom-class">
          Custom
        </Button>
      )

      // Assert
      const button = screen.getByRole('button')
      expect(button).toHaveClass('custom-class', 'bg-primary-600')
    })

    it('複数のカスタムclassNameが適用されること', () => {
      // Arrange & Act
      render(<Button className="class1 class2 class3">Multiple Classes</Button>)

      // Assert
      const button = screen.getByRole('button')
      expect(button).toHaveClass('class1', 'class2', 'class3')
    })
  })

  describe('その他のHTML属性テスト', () => {
    it('aria-label属性が正しく設定されること', () => {
      // Arrange & Act
      render(<Button aria-label="Custom Label">Button</Button>)

      // Assert
      expect(screen.getByRole('button')).toHaveAttribute('aria-label', 'Custom Label')
    })

    it('data-testid属性が正しく設定されること', () => {
      // Arrange & Act
      render(<Button data-testid="custom-button">Button</Button>)

      // Assert
      expect(screen.getByTestId('custom-button')).toBeInTheDocument()
    })

    it('title属性が正しく設定されること', () => {
      // Arrange & Act
      render(<Button title="Button Title">Button</Button>)

      // Assert
      expect(screen.getByRole('button')).toHaveAttribute('title', 'Button Title')
    })
  })

  describe('複合propsテスト', () => {
    it('複数のpropsが同時に適用されること', () => {
      // Arrange & Act
      render(
        <Button variant="outline" size="lg" disabled={true} className="custom">
          Complex Button
        </Button>
      )

      // Assert
      const button = screen.getByRole('button')
      expect(button).toHaveClass('border-2', 'border-primary-600', 'px-6', 'py-3', 'custom')
      expect(button).toBeDisabled()
    })

    it('loading + disabled + iconの組み合わせが正しく動作すること', () => {
      // Arrange & Act
      const icon = <span data-testid="icon">I</span>
      render(
        <Button loading={true} disabled={true} icon={icon}>
          Complex
        </Button>
      )

      // Assert
      const button = screen.getByRole('button')
      expect(button).toBeDisabled()
      expect(screen.queryByTestId('icon')).not.toBeInTheDocument()
      const spinner = button.querySelector('svg.animate-spin')
      expect(spinner).toBeInTheDocument()
    })
  })

  describe('基本CSSクラステスト', () => {
    it('基本クラスが常に適用されること', () => {
      // Arrange & Act
      render(<Button>Base Classes</Button>)

      // Assert
      const button = screen.getByRole('button')
      expect(button).toHaveClass(
        'inline-flex',
        'items-center',
        'justify-center',
        'font-medium',
        'rounded-lg',
        'focus:outline-none'
      )
    })

    it('disabled時はhover/activeクラスが適用されないこと', () => {
      // Arrange & Act
      render(<Button disabled={true}>Disabled</Button>)

      // Assert
      const button = screen.getByRole('button')
      expect(button.className).not.toContain('hover:scale')
      expect(button.className).not.toContain('active:scale')
    })

    it('loading時はhover/activeクラスが適用されないこと', () => {
      // Arrange & Act
      render(<Button loading={true}>Loading</Button>)

      // Assert
      const button = screen.getByRole('button')
      expect(button.className).not.toContain('hover:scale')
      expect(button.className).not.toContain('active:scale')
    })

    it('通常時はhover/activeクラスが適用されること', () => {
      // Arrange & Act
      render(<Button>Normal</Button>)

      // Assert
      const button = screen.getByRole('button')
      expect(button).toHaveClass('hover:scale-[1.02]', 'active:scale-[0.98]')
    })
  })
})
