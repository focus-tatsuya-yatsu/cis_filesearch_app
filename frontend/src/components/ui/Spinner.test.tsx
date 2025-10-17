import { render } from '@testing-library/react'

import { Spinner } from './Spinner'

describe('Spinner', () => {
  describe('基本的な描画', () => {
    it('スピナーが正しく描画される', () => {
      const { container } = render(<Spinner />)
      const svg = container.querySelector('svg')
      expect(svg).toBeInTheDocument()
    })

    it('アニメーションクラスが適用される', () => {
      const { container } = render(<Spinner />)
      const svg = container.querySelector('svg')
      expect(svg).toHaveClass('animate-spin')
    })

    it('SVGに正しいビューボックスが設定される', () => {
      const { container } = render(<Spinner />)
      const svg = container.querySelector('svg')
      expect(svg).toHaveAttribute('viewBox', '0 0 24 24')
    })

    it('circleとpathが描画される', () => {
      const { container } = render(<Spinner />)
      const circle = container.querySelector('circle')
      const path = container.querySelector('path')
      expect(circle).toBeInTheDocument()
      expect(path).toBeInTheDocument()
    })
  })

  describe('サイズバリエーション', () => {
    it('デフォルトサイズはmd', () => {
      const { container } = render(<Spinner />)
      const svg = container.querySelector('svg')
      expect(svg).toHaveClass('h-8')
      expect(svg).toHaveClass('w-8')
    })

    it('size="sm"の場合、小さいサイズが適用される', () => {
      const { container } = render(<Spinner size="sm" />)
      const svg = container.querySelector('svg')
      expect(svg).toHaveClass('h-4')
      expect(svg).toHaveClass('w-4')
    })

    it('size="md"の場合、中サイズが適用される', () => {
      const { container } = render(<Spinner size="md" />)
      const svg = container.querySelector('svg')
      expect(svg).toHaveClass('h-8')
      expect(svg).toHaveClass('w-8')
    })

    it('size="lg"の場合、大きいサイズが適用される', () => {
      const { container } = render(<Spinner size="lg" />)
      const svg = container.querySelector('svg')
      expect(svg).toHaveClass('h-12')
      expect(svg).toHaveClass('w-12')
    })
  })

  describe('カスタムclassName', () => {
    it('カスタムclassNameが適用される', () => {
      const { container } = render(<Spinner className="custom-class" />)
      const wrapper = container.querySelector('.flex')
      expect(wrapper).toHaveClass('custom-class')
    })

    it('デフォルトクラスとカスタムクラスが併存する', () => {
      const { container } = render(<Spinner className="custom-class" />)
      const wrapper = container.querySelector('.flex')
      expect(wrapper).toHaveClass('custom-class')
      expect(wrapper).toHaveClass('flex')
      expect(wrapper).toHaveClass('items-center')
      expect(wrapper).toHaveClass('justify-center')
    })
  })

  describe('スタイリング', () => {
    it('コンテナに中央寄せクラスが適用される', () => {
      const { container } = render(<Spinner />)
      const wrapper = container.querySelector('.flex')
      expect(wrapper).toHaveClass('flex')
      expect(wrapper).toHaveClass('items-center')
      expect(wrapper).toHaveClass('justify-center')
    })

    it('SVGにtext-primary-600クラスが適用される', () => {
      const { container } = render(<Spinner />)
      const svg = container.querySelector('svg')
      expect(svg).toHaveClass('text-primary-600')
    })

    it('circleに適切な不透明度が設定される', () => {
      const { container } = render(<Spinner />)
      const circle = container.querySelector('circle')
      expect(circle).toHaveClass('opacity-25')
    })

    it('pathに適切な不透明度が設定される', () => {
      const { container } = render(<Spinner />)
      const path = container.querySelector('path')
      expect(path).toHaveClass('opacity-75')
    })
  })

  describe('複合ケース', () => {
    it('サイズとカスタムクラスが同時に使用できる', () => {
      const { container } = render(<Spinner size="lg" className="custom-spinner" />)
      const svg = container.querySelector('svg')
      const wrapper = container.querySelector('.flex')

      expect(svg).toHaveClass('h-12')
      expect(svg).toHaveClass('w-12')
      expect(wrapper).toHaveClass('custom-spinner')
    })

    it('すべてのサイズでアニメーションが適用される', () => {
      const sizes: Array<'sm' | 'md' | 'lg'> = ['sm', 'md', 'lg']

      sizes.forEach((size) => {
        const { container } = render(<Spinner size={size} />)
        const svg = container.querySelector('svg')
        expect(svg).toHaveClass('animate-spin')
      })
    })
  })
})
