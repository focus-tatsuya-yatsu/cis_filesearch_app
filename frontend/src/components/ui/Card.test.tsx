import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { Card } from './Card'

describe('Card', () => {
  describe('基本的な描画', () => {
    it('childrenが正しく表示される', () => {
      render(<Card>カードの内容</Card>)
      expect(screen.getByText('カードの内容')).toBeInTheDocument()
    })

    it('複雑なchildrenが表示される', () => {
      render(
        <Card>
          <h1>タイトル</h1>
          <p>本文</p>
        </Card>
      )
      expect(screen.getByText('タイトル')).toBeInTheDocument()
      expect(screen.getByText('本文')).toBeInTheDocument()
    })

    it('デフォルトのスタイルクラスが適用される', () => {
      const { container } = render(<Card>内容</Card>)
      const card = container.firstChild as HTMLElement
      expect(card).toHaveClass('bg-white')
      expect(card).toHaveClass('rounded-xl')
      expect(card).toHaveClass('shadow-md')
      expect(card).toHaveClass('p-6')
    })
  })

  describe('hover prop', () => {
    it('hover=falseの場合、ホバー効果がない', () => {
      const { container } = render(<Card hover={false}>内容</Card>)
      const card = container.firstChild as HTMLElement
      expect(card).not.toHaveClass('hover:scale-[1.01]')
      expect(card).not.toHaveClass('hover:shadow-lg')
    })

    it('hover=trueの場合、ホバー効果のクラスが適用される', () => {
      const { container } = render(<Card hover={true}>内容</Card>)
      const card = container.firstChild as HTMLElement
      expect(card).toHaveClass('hover:scale-[1.01]')
      expect(card).toHaveClass('hover:shadow-lg')
      expect(card).toHaveClass('transition-all')
    })

    it('hoverが未指定の場合、デフォルトでfalse', () => {
      const { container } = render(<Card>内容</Card>)
      const card = container.firstChild as HTMLElement
      expect(card).not.toHaveClass('hover:scale-[1.01]')
    })
  })

  describe('onClick prop', () => {
    it('onClickが指定された場合、cursor-pointerが適用される', () => {
      const { container } = render(<Card onClick={() => {}}>内容</Card>)
      const card = container.firstChild as HTMLElement
      expect(card).toHaveClass('cursor-pointer')
    })

    it('onClickが未指定の場合、cursor-pointerがない', () => {
      const { container } = render(<Card>内容</Card>)
      const card = container.firstChild as HTMLElement
      expect(card).not.toHaveClass('cursor-pointer')
    })

    it('クリック時にonClickが呼ばれる', async () => {
      const user = userEvent.setup()
      const onClick = jest.fn()
      const { container } = render(<Card onClick={onClick}>クリック可能</Card>)

      const card = container.firstChild as HTMLElement
      await user.click(card)

      expect(onClick).toHaveBeenCalledTimes(1)
    })

    it('複数回クリックできる', async () => {
      const user = userEvent.setup()
      const onClick = jest.fn()
      const { container } = render(<Card onClick={onClick}>クリック可能</Card>)

      const card = container.firstChild as HTMLElement
      await user.click(card)
      await user.click(card)
      await user.click(card)

      expect(onClick).toHaveBeenCalledTimes(3)
    })
  })

  describe('className prop', () => {
    it('カスタムclassNameが適用される', () => {
      const { container } = render(<Card className="custom-class">内容</Card>)
      const card = container.firstChild as HTMLElement
      expect(card).toHaveClass('custom-class')
    })

    it('デフォルトクラスとカスタムクラスが併存する', () => {
      const { container } = render(<Card className="custom-class">内容</Card>)
      const card = container.firstChild as HTMLElement
      expect(card).toHaveClass('custom-class')
      expect(card).toHaveClass('bg-white')
      expect(card).toHaveClass('rounded-xl')
    })

    it('複数のカスタムクラスが適用される', () => {
      const { container } = render(<Card className="class1 class2 class3">内容</Card>)
      const card = container.firstChild as HTMLElement
      expect(card).toHaveClass('class1')
      expect(card).toHaveClass('class2')
      expect(card).toHaveClass('class3')
    })
  })

  describe('複合ケース', () => {
    it('すべてのpropsが同時に使用できる', async () => {
      const user = userEvent.setup()
      const onClick = jest.fn()
      const { container } = render(
        <Card className="custom" hover={true} onClick={onClick}>
          コンテンツ
        </Card>
      )

      const card = container.firstChild as HTMLElement

      expect(card).toHaveClass('custom')
      expect(card).toHaveClass('hover:scale-[1.01]')
      expect(card).toHaveClass('cursor-pointer')
      expect(screen.getByText('コンテンツ')).toBeInTheDocument()

      await user.click(card)
      expect(onClick).toHaveBeenCalled()
    })

    it('hover効果とクリック可能なカード', async () => {
      const user = userEvent.setup()
      const onClick = jest.fn()
      const { container } = render(
        <Card hover={true} onClick={onClick}>
          インタラクティブなカード
        </Card>
      )

      const card = container.firstChild as HTMLElement

      expect(card).toHaveClass('hover:scale-[1.01]')
      expect(card).toHaveClass('cursor-pointer')

      await user.click(card)
      expect(onClick).toHaveBeenCalled()
    })
  })
})
