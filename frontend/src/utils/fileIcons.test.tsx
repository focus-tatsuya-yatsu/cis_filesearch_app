/**
 * @jest-environment jsdom
 */

import { render } from '@testing-library/react'

import { getFileIcon } from './fileIcons'

describe('getFileIcon', () => {
  it('should render PDF icon with red color', () => {
    const { container } = render(<div>{getFileIcon('pdf')}</div>)
    const icon = container.querySelector('svg')
    expect(icon).toHaveClass('text-red-500')
  })

  it('should render Word document icon with blue color', () => {
    const { container } = render(<div>{getFileIcon('docx')}</div>)
    const icon = container.querySelector('svg')
    expect(icon).toHaveClass('text-blue-500')
  })

  it('should render Word legacy document icon with blue color', () => {
    const { container } = render(<div>{getFileIcon('doc')}</div>)
    const icon = container.querySelector('svg')
    expect(icon).toHaveClass('text-blue-500')
  })

  it('should render Excel icon with green color', () => {
    const { container } = render(<div>{getFileIcon('xlsx')}</div>)
    const icon = container.querySelector('svg')
    expect(icon).toHaveClass('text-green-500')
  })

  it('should render Excel legacy icon with green color', () => {
    const { container } = render(<div>{getFileIcon('xls')}</div>)
    const icon = container.querySelector('svg')
    expect(icon).toHaveClass('text-green-500')
  })

  it('should render default icon with gray color for unknown file types', () => {
    const { container } = render(<div>{getFileIcon('unknown')}</div>)
    const icon = container.querySelector('svg')
    expect(icon).toHaveClass('text-gray-500')
  })

  it('should handle case-insensitive file types', () => {
    const { container: containerUppercase } = render(<div>{getFileIcon('PDF')}</div>)
    const iconUppercase = containerUppercase.querySelector('svg')
    expect(iconUppercase).toHaveClass('text-red-500')

    const { container: containerMixed } = render(<div>{getFileIcon('DoCx')}</div>)
    const iconMixed = containerMixed.querySelector('svg')
    expect(iconMixed).toHaveClass('text-blue-500')
  })

  it('should have consistent icon size (h-5 w-5)', () => {
    const fileTypes = ['pdf', 'docx', 'xlsx', 'unknown']
    fileTypes.forEach((type) => {
      const { container } = render(<div>{getFileIcon(type)}</div>)
      const icon = container.querySelector('svg')
      expect(icon).toHaveClass('h-5')
      expect(icon).toHaveClass('w-5')
    })
  })

  it('should render FileText lucide-react icon', () => {
    const { container } = render(<div>{getFileIcon('pdf')}</div>)
    const icon = container.querySelector('svg')
    expect(icon).toBeTruthy()
    // lucide-react icons typically have specific attributes
    expect(icon?.tagName.toLowerCase()).toBe('svg')
  })
})
