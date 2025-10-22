import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'

import { Input } from './Input'

describe('Input', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('基本的な描画', () => {
    it('入力フィールドが正しく描画される', () => {
      render(<Input />)
      const input = screen.getByRole('textbox')
      expect(input).toBeInTheDocument()
    })

    it('labelが表示される', () => {
      render(<Input label="ユーザー名" />)
      expect(screen.getByText('ユーザー名')).toBeInTheDocument()
    })

    it('labelがない場合は表示されない', () => {
      const { container } = render(<Input />)
      const label = container.querySelector('label')
      expect(label).not.toBeInTheDocument()
    })

    it('placeholderが設定される', () => {
      render(<Input placeholder="入力してください" />)
      expect(screen.getByPlaceholderText('入力してください')).toBeInTheDocument()
    })
  })

  describe('エラー状態', () => {
    it('エラーメッセージが表示される', () => {
      render(<Input error="このフィールドは必須です" />)
      expect(screen.getByText('このフィールドは必須です')).toBeInTheDocument()
    })

    it('エラーがない場合は表示されない', () => {
      const { container } = render(<Input />)
      const errorText = container.querySelector('.text-red-600')
      expect(errorText).not.toBeInTheDocument()
    })

    it('エラー時に赤い境界線が適用される', () => {
      render(<Input error="エラー" />)
      const input = screen.getByRole('textbox')
      expect(input).toHaveClass('border-red-500')
    })
  })

  describe('アイコン', () => {
    it('アイコンが表示される', () => {
      const icon = <span data-testid="test-icon">🔍</span>
      render(<Input icon={icon} />)
      expect(screen.getByTestId('test-icon')).toBeInTheDocument()
    })

    it('アイコンがない場合は表示されない', () => {
      const { container } = render(<Input />)
      const iconContainer = container.querySelector('.absolute.inset-y-0')
      expect(iconContainer).not.toBeInTheDocument()
    })

    it('アイコンがある場合は左パディングが適用される', () => {
      const icon = <span data-testid="test-icon">🔍</span>
      render(<Input icon={icon} />)
      const input = screen.getByRole('textbox')
      expect(input).toHaveClass('pl-10')
    })
  })

  describe('入力操作', () => {
    it('テキスト入力が正しく反映される', async () => {
      const user = userEvent.setup()
      render(<Input />)
      const input = screen.getByRole('textbox')

      await user.type(input, 'test input')

      expect(input).toHaveValue('test input')
    })

    it('valueプロパティで値が設定される', () => {
      render(<Input value="初期値" onChange={() => {}} />)
      const input = screen.getByRole('textbox')
      expect(input).toHaveValue('初期値')
    })

    it('onChangeが呼ばれる', async () => {
      const user = userEvent.setup()
      const onChange = jest.fn()
      render(<Input onChange={onChange} />)
      const input = screen.getByRole('textbox')

      await user.type(input, 'a')

      expect(onChange).toHaveBeenCalled()
    })
  })

  describe('disabled状態', () => {
    it('disabled属性が設定される', () => {
      render(<Input disabled />)
      const input = screen.getByRole('textbox')
      expect(input).toBeDisabled()
    })

    it('disabled時に背景色が変わる', () => {
      render(<Input disabled />)
      const input = screen.getByRole('textbox')
      expect(input).toHaveClass('disabled:bg-gray-50')
    })
  })

  describe('forwardRef', () => {
    it('refが正しく転送される', () => {
      const ref = createRef<HTMLInputElement>()
      render(<Input ref={ref} />)
      expect(ref.current).toBeInstanceOf(HTMLInputElement)
    })

    it('refを使って値にアクセスできる', () => {
      const ref = createRef<HTMLInputElement>()
      render(<Input ref={ref} value="test" onChange={() => {}} />)
      expect(ref.current?.value).toBe('test')
    })

    it('refを使ってフォーカスできる', () => {
      const ref = createRef<HTMLInputElement>()
      render(<Input ref={ref} />)
      ref.current?.focus()
      expect(ref.current).toHaveFocus()
    })
  })

  describe('その他のHTML属性', () => {
    it('type属性が設定される', () => {
      render(<Input type="email" />)
      const input = screen.getByRole('textbox')
      expect(input).toHaveAttribute('type', 'email')
    })

    it('name属性が設定される', () => {
      render(<Input name="username" />)
      const input = screen.getByRole('textbox')
      expect(input).toHaveAttribute('name', 'username')
    })

    it('required属性が設定される', () => {
      render(<Input required />)
      const input = screen.getByRole('textbox')
      expect(input).toBeRequired()
    })

    it('maxLength属性が設定される', () => {
      render(<Input maxLength={10} />)
      const input = screen.getByRole('textbox')
      expect(input).toHaveAttribute('maxLength', '10')
    })
  })

  describe('カスタムclassName', () => {
    it('カスタムclassNameが適用される', () => {
      render(<Input className="custom-class" />)
      const input = screen.getByRole('textbox')
      expect(input).toHaveClass('custom-class')
    })

    it('デフォルトのクラスとカスタムクラスが併存する', () => {
      render(<Input className="custom-class" />)
      const input = screen.getByRole('textbox')
      expect(input).toHaveClass('custom-class')
      expect(input).toHaveClass('rounded-lg')
    })
  })

  describe('複合ケース', () => {
    it('label、icon、errorがすべて表示される', () => {
      const icon = <span data-testid="test-icon">🔍</span>
      render(<Input label="検索" icon={icon} error="検索キーワードを入力してください" />)

      expect(screen.getByText('検索')).toBeInTheDocument()
      expect(screen.getByTestId('test-icon')).toBeInTheDocument()
      expect(screen.getByText('検索キーワードを入力してください')).toBeInTheDocument()
    })

    it('label、placeholder、valueが同時に使用される', () => {
      render(
        <Input
          label="メールアドレス"
          placeholder="example@test.com"
          value="test@test.com"
          onChange={() => {}}
        />
      )

      expect(screen.getByText('メールアドレス')).toBeInTheDocument()
      expect(screen.getByPlaceholderText('example@test.com')).toBeInTheDocument()
      expect(screen.getByDisplayValue('test@test.com')).toBeInTheDocument()
    })
  })
})
