# CIS File Search Application - UI/UX Improvement Specification

## 📋 Document Overview

**Version**: 1.0.0
**Date**: 2025-10-21
**Design Philosophy**: Apple Human Interface Guidelines
**Target**: Production-ready Next.js 15 Application

---

## 🎯 Design Objectives

1. **Simplicity First**: Remove unnecessary visual elements, focus on core search functionality
2. **Content Deference**: Let search results take center stage
3. **Smooth Interactions**: Implement fluid transitions with Apple-style animations
4. **Enterprise-Grade UX**: Professional, accessible, performant interface
5. **Responsive Excellence**: Flawless experience across all devices

---

## 📐 Design System Foundation

### Color Palette

#### Light Mode
```typescript
const colors = {
  // Background
  primary: '#FFFFFF',        // Main content background
  secondary: '#F5F5F7',      // Page background
  tertiary: '#FBFBFD',       // Subtle elevated surfaces

  // Text
  primary: '#1D1D1F',        // Primary text
  secondary: '#424245',      // Secondary text
  tertiary: '#6E6E73',       // Tertiary text/placeholders
  quaternary: '#8E8E93',     // Disabled/metadata

  // Borders & Dividers
  separator: '#D1D1D6',      // Primary borders
  separatorLight: '#E5E5EA', // Lighter dividers

  // Accents
  blue: '#007AFF',           // Primary actions
  blueHover: '#0051D5',      // Hover state
  blueActive: '#004CCC',     // Active state
  blueFocus: '#007AFF1A',    // Focus ring (10% opacity)

  // Status Colors
  success: '#34C759',
  warning: '#FF9500',
  error: '#FF3B30',
}
```

#### Dark Mode
```typescript
const darkColors = {
  // Background
  primary: '#1C1C1E',        // Main content background
  secondary: '#000000',      // Page background
  tertiary: '#2C2C2E',       // Elevated surfaces

  // Text
  primary: '#F5F5F7',        // Primary text
  secondary: '#C7C7CC',      // Secondary text
  tertiary: '#98989D',       // Tertiary text/placeholders
  quaternary: '#8E8E93',     // Disabled/metadata

  // Borders & Dividers
  separator: '#38383A',      // Primary borders
  separatorLight: '#48484A', // Lighter dividers

  // Accents
  blue: '#0A84FF',           // Primary actions
  blueHover: '#0066FF',      // Hover state
  blueActive: '#004DE6',     // Active state
  blueFocus: '#0A84FF1A',    // Focus ring (10% opacity)

  // Status Colors
  success: '#32D74B',
  warning: '#FF9F0A',
  error: '#FF453A',
}
```

### Typography System

#### Font Family
```css
font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', 'Segoe UI', 'Helvetica Neue', sans-serif;
```

#### Type Scale (rem units)
```typescript
const typeScale = {
  // Display (Hero headings)
  display1: { size: '3.5rem', lineHeight: 1.1, weight: 600, letterSpacing: '-0.02em' },  // 56px
  display2: { size: '3rem', lineHeight: 1.1, weight: 600, letterSpacing: '-0.02em' },    // 48px

  // Headings
  h1: { size: '2rem', lineHeight: 1.2, weight: 600, letterSpacing: '-0.01em' },          // 32px
  h2: { size: '1.5rem', lineHeight: 1.3, weight: 600, letterSpacing: '-0.01em' },        // 24px
  h3: { size: '1.25rem', lineHeight: 1.3, weight: 600, letterSpacing: '0' },             // 20px
  h4: { size: '1.125rem', lineHeight: 1.4, weight: 600, letterSpacing: '0' },            // 18px

  // Body
  bodyLarge: { size: '1.0625rem', lineHeight: 1.5, weight: 400, letterSpacing: '0' },    // 17px
  body: { size: '1rem', lineHeight: 1.5, weight: 400, letterSpacing: '0' },              // 16px
  bodySmall: { size: '0.9375rem', lineHeight: 1.5, weight: 400, letterSpacing: '0' },    // 15px

  // UI Elements
  caption: { size: '0.875rem', lineHeight: 1.4, weight: 400, letterSpacing: '0' },       // 14px
  footnote: { size: '0.8125rem', lineHeight: 1.4, weight: 400, letterSpacing: '0' },     // 13px
  tiny: { size: '0.75rem', lineHeight: 1.3, weight: 400, letterSpacing: '0' },           // 12px
}
```

### Spacing System (8-point grid)

```typescript
const spacing = {
  0: '0',           // 0px
  1: '0.25rem',     // 4px
  2: '0.5rem',      // 8px
  3: '0.75rem',     // 12px
  4: '1rem',        // 16px
  5: '1.25rem',     // 20px
  6: '1.5rem',      // 24px
  8: '2rem',        // 32px
  10: '2.5rem',     // 40px
  12: '3rem',       // 48px
  16: '4rem',       // 64px
  20: '5rem',       // 80px
  24: '6rem',       // 96px
}
```

### Shadow System

```typescript
const shadows = {
  // Subtle elevation (cards, inputs)
  sm: '0 0.0625rem 0.1875rem rgba(0, 0, 0, 0.04), 0 0.0625rem 0.125rem rgba(0, 0, 0, 0.02)',

  // Medium elevation (dropdowns, tooltips)
  md: '0 0.25rem 0.5rem rgba(0, 0, 0, 0.08), 0 0.125rem 0.25rem rgba(0, 0, 0, 0.04)',

  // High elevation (modals, overlays)
  lg: '0 0.5rem 1rem rgba(0, 0, 0, 0.12), 0 0.25rem 0.5rem rgba(0, 0, 0, 0.06)',

  // Extra high (tooltips on hover, critical actions)
  xl: '0 1rem 2rem rgba(0, 0, 0, 0.16), 0 0.5rem 1rem rgba(0, 0, 0, 0.08)',

  // Dark mode variants (stronger)
  darkSm: '0 0.0625rem 0.1875rem rgba(0, 0, 0, 0.2), 0 0.0625rem 0.125rem rgba(0, 0, 0, 0.1)',
  darkMd: '0 0.25rem 0.5rem rgba(0, 0, 0, 0.3), 0 0.125rem 0.25rem rgba(0, 0, 0, 0.15)',
  darkLg: '0 0.5rem 1rem rgba(0, 0, 0, 0.4), 0 0.25rem 0.5rem rgba(0, 0, 0, 0.2)',
  darkXl: '0 1rem 2rem rgba(0, 0, 0, 0.5), 0 0.5rem 1rem rgba(0, 0, 0, 0.25)',
}
```

### Border Radius

```typescript
const borderRadius = {
  none: '0',
  sm: '0.375rem',    // 6px - Small buttons, tags
  md: '0.5rem',      // 8px - Standard buttons
  lg: '0.75rem',     // 12px - Cards, panels
  xl: '1rem',        // 16px - Large cards
  '2xl': '1.25rem',  // 20px - Hero elements, search bar
  full: '9999px',    // Pills, circular buttons
}
```

### Animation Specifications

```typescript
const animations = {
  // Easing Functions (Apple-style cubic-bezier)
  easing: {
    spring: 'cubic-bezier(0.22, 1, 0.36, 1)',      // Default smooth spring
    ease: 'cubic-bezier(0.25, 0.1, 0.25, 1)',      // Gentle ease
    swift: 'cubic-bezier(0.4, 0, 0.2, 1)',         // Quick action
    entrance: 'cubic-bezier(0, 0, 0.2, 1)',        // Elements entering
    exit: 'cubic-bezier(0.4, 0, 1, 1)',            // Elements exiting
  },

  // Duration Scale
  duration: {
    instant: '100ms',    // Immediate feedback
    fast: '200ms',       // Quick transitions
    normal: '300ms',     // Standard transitions
    slow: '500ms',       // Deliberate animations
    slower: '700ms',     // Complex transitions
  },

  // Common Transitions
  transitions: {
    // UI interactions
    button: 'all 200ms cubic-bezier(0.22, 1, 0.36, 1)',
    input: 'all 300ms cubic-bezier(0.22, 1, 0.36, 1)',
    panel: 'all 300ms cubic-bezier(0.22, 1, 0.36, 1)',

    // Layout changes
    collapse: 'all 300ms cubic-bezier(0.22, 1, 0.36, 1)',
    expand: 'all 300ms cubic-bezier(0.22, 1, 0.36, 1)',

    // Opacity fades
    fadeIn: 'opacity 300ms cubic-bezier(0, 0, 0.2, 1)',
    fadeOut: 'opacity 200ms cubic-bezier(0.4, 0, 1, 1)',
  },
}
```

---

## 🔧 Required Changes - Detailed Specifications

### 1. Hero Section Removal

#### Current State
```tsx
// Lines 137-226 in page.tsx - REMOVE ENTIRELY
<section className="relative overflow-hidden">
  {/* Hero content with title, stats, etc. */}
</section>
```

#### Required Action
1. **Complete removal** of hero section (lines 137-226)
2. **Remove** all feature cards
3. **Remove** statistics section (1.2M+ files, <0.5s, 99.9%)
4. **Remove** background gradients and decorative elements

#### Result
- Page starts directly with Header component
- Search bar positioned immediately below header
- Clean, focused interface

---

### 2. Search Bar Repositioning & Enhancement

#### New Layout Structure
```tsx
<div className="min-h-screen bg-[#F5F5F7] dark:bg-black">
  <Header />

  {/* NEW: Search Bar Section - Directly Below Header */}
  <section className="sticky top-16 z-40 bg-[#F5F5F7]/95 dark:bg-black/95 backdrop-blur-xl border-b border-[#D1D1D6]/30 dark:border-[#38383A]/30">
    <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-4">
      <SearchBar
        onSearch={handleSearch}
        placeholder="ファイル名・内容・タグを入力して下さい"
      />
    </div>
  </section>

  {/* Search History or Search Results */}
  {!hasSearched ? <SearchHistory /> : <SearchResults />}
</div>
```

#### Design Specifications

**Container**
```css
/* Sticky positioning for always-accessible search */
position: sticky;
top: 4rem; /* Header height */
z-index: 40;
background: rgba(245, 245, 247, 0.95); /* Semi-transparent for depth */
backdrop-filter: blur(1.5rem); /* Glass morphism effect */
border-bottom: 1px solid rgba(209, 209, 214, 0.3);
```

**SearchBar Component Updates**
```tsx
// Update placeholder
placeholder="ファイル名・内容・タグを入力して下さい"

// Size adjustment for prominence
className="
  w-full pl-12 pr-12 py-4
  text-[1.125rem] leading-[1.4] font-normal  /* Increased from 1.0625rem */
  /* ... rest of styles */
"
```

**Visual Hierarchy**
- Search bar: Primary focus with larger size (18px text vs 17px)
- High contrast against background
- Prominent shadow on focus: `shadow-lg` (0.5rem 1rem blur)
- Magnifying glass icon: 20px (increased from 18px)

#### Responsive Behavior
```typescript
const responsive = {
  mobile: {
    padding: '0.75rem 1rem',      // 12px 16px
    fontSize: '1rem',              // 16px
    iconSize: '1.125rem',          // 18px
  },
  tablet: {
    padding: '1rem 1.5rem',        // 16px 24px
    fontSize: '1.0625rem',         // 17px
    iconSize: '1.25rem',           // 20px
  },
  desktop: {
    padding: '1rem 1.5rem',        // 16px 24px
    fontSize: '1.125rem',          // 18px
    iconSize: '1.25rem',           // 20px
  },
}
```

---

### 3. Search History Feature (NEW)

#### Overview
Display recent 10 search queries when search input is empty/inactive. Smoothly transition to search results when search is executed.

#### Visual Design

**Search History Container**
```tsx
<section className="py-8 animate-fade-in">
  <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-4xl">
    {/* Header */}
    <div className="flex items-center justify-between mb-4">
      <h3 className="text-[1rem] font-semibold text-[#1D1D1F] dark:text-[#F5F5F7]">
        最近の検索
      </h3>
      <button
        onClick={handleClearAllHistory}
        className="text-[0.875rem] text-[#007AFF] dark:text-[#0A84FF] hover:text-[#0051D5] dark:hover:text-[#0066FF] transition-colors duration-200"
      >
        すべてクリア
      </button>
    </div>

    {/* History Items */}
    <div className="space-y-2">
      {historyItems.map((item, index) => (
        <SearchHistoryItem
          key={item.id}
          item={item}
          index={index}
          onSelect={handleHistorySelect}
          onDelete={handleHistoryDelete}
        />
      ))}
    </div>

    {/* Empty State */}
    {historyItems.length === 0 && <SearchHistoryEmpty />}
  </div>
</section>
```

**SearchHistoryItem Component**
```tsx
interface SearchHistoryItemProps {
  item: {
    id: string
    query: string
    timestamp: string
    resultCount?: number
  }
  index: number
  onSelect: (query: string) => void
  onDelete: (id: string) => void
}

const SearchHistoryItem: FC<SearchHistoryItemProps> = ({
  item,
  index,
  onSelect,
  onDelete
}) => {
  return (
    <div
      className="
        group
        flex items-center justify-between gap-4
        bg-white/90 dark:bg-[#1C1C1E]/90
        backdrop-blur-xl
        rounded-xl
        px-4 py-3
        border border-[#D1D1D6]/30 dark:border-[#38383A]/30
        hover:border-[#007AFF]/30 dark:hover:border-[#0A84FF]/30
        hover:shadow-md
        transition-all duration-200
        cursor-pointer
        animate-fade-in-fast
      "
      style={{ animationDelay: `${index * 50}ms` }}
      onClick={() => onSelect(item.query)}
    >
      {/* Left: Clock Icon + Query */}
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <Clock className="h-4 w-4 text-[#8E8E93] flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-[0.9375rem] font-medium text-[#1D1D1F] dark:text-[#F5F5F7] truncate">
            {item.query}
          </p>
          <div className="flex items-center gap-2 mt-0.5">
            <p className="text-[0.75rem] text-[#8E8E93]">
              {formatRelativeTime(item.timestamp)}
            </p>
            {item.resultCount !== undefined && (
              <>
                <span className="text-[#D1D1D6] dark:text-[#38383A]">•</span>
                <p className="text-[0.75rem] text-[#8E8E93]">
                  {item.resultCount}件の結果
                </p>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Right: Delete Button */}
      <button
        onClick={(e) => {
          e.stopPropagation()
          onDelete(item.id)
        }}
        className="
          opacity-0 group-hover:opacity-100
          p-2 rounded-lg
          hover:bg-[#FF3B30]/10 dark:hover:bg-[#FF453A]/10
          transition-all duration-200
        "
        aria-label="履歴を削除"
      >
        <X className="h-4 w-4 text-[#FF3B30] dark:text-[#FF453A]" />
      </button>
    </div>
  )
}
```

**Empty State Component**
```tsx
const SearchHistoryEmpty: FC = () => {
  return (
    <div className="text-center py-16 animate-fade-in">
      <div className="mb-4 flex justify-center">
        <div className="p-4 bg-[#F5F5F7] dark:bg-[#1C1C1E] rounded-full">
          <Search className="h-8 w-8 text-[#8E8E93]" />
        </div>
      </div>
      <p className="text-[0.9375rem] text-[#6E6E73] dark:text-[#8E8E93]">
        検索履歴はまだありません
      </p>
      <p className="text-[0.8125rem] text-[#8E8E93] mt-1">
        ファイルを検索すると、ここに履歴が表示されます
      </p>
    </div>
  )
}
```

#### Data Structure
```typescript
interface SearchHistoryItem {
  id: string              // Unique identifier (UUID)
  query: string           // Search query text
  timestamp: string       // ISO 8601 timestamp
  resultCount?: number    // Number of results found (optional)
}

interface SearchHistoryState {
  items: SearchHistoryItem[]  // Max 10 items
  maxItems: 10
}
```

#### State Management
```typescript
// Custom hook for search history
const useSearchHistory = () => {
  const [history, setHistory] = useState<SearchHistoryItem[]>([])

  // Load from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem('searchHistory')
    if (stored) {
      setHistory(JSON.parse(stored))
    }
  }, [])

  // Add new search to history
  const addToHistory = useCallback((query: string, resultCount?: number) => {
    const newItem: SearchHistoryItem = {
      id: crypto.randomUUID(),
      query,
      timestamp: new Date().toISOString(),
      resultCount,
    }

    setHistory((prev) => {
      // Remove duplicate if exists
      const filtered = prev.filter(item => item.query !== query)
      // Add to beginning and limit to 10
      const updated = [newItem, ...filtered].slice(0, 10)
      localStorage.setItem('searchHistory', JSON.stringify(updated))
      return updated
    })
  }, [])

  // Delete single item
  const deleteHistoryItem = useCallback((id: string) => {
    setHistory((prev) => {
      const updated = prev.filter(item => item.id !== id)
      localStorage.setItem('searchHistory', JSON.stringify(updated))
      return updated
    })
  }, [])

  // Clear all history
  const clearAllHistory = useCallback(() => {
    setHistory([])
    localStorage.removeItem('searchHistory')
  }, [])

  return {
    history,
    addToHistory,
    deleteHistoryItem,
    clearAllHistory,
  }
}
```

#### Animations & Transitions

**History ↔ Results Transition**
```typescript
const SearchSection: FC = () => {
  const [showHistory, setShowHistory] = useState(true)
  const [showResults, setShowResults] = useState(false)

  const handleSearch = async (query: string) => {
    // 1. Fade out history
    setShowHistory(false)

    // 2. Wait for fade out (300ms)
    await new Promise(resolve => setTimeout(resolve, 300))

    // 3. Perform search
    await performSearch(query)

    // 4. Fade in results
    setShowResults(true)
  }

  return (
    <>
      {showHistory && (
        <div className="animate-fade-in">
          <SearchHistory />
        </div>
      )}

      {showResults && (
        <div className="animate-fade-in">
          <SearchResults />
        </div>
      )}
    </>
  )
}
```

**Staggered Entry Animation**
```css
/* Each history item appears with delay */
.search-history-item:nth-child(1) { animation-delay: 0ms; }
.search-history-item:nth-child(2) { animation-delay: 50ms; }
.search-history-item:nth-child(3) { animation-delay: 100ms; }
/* ... up to 10 items */
```

#### Accessibility Features

```tsx
// ARIA attributes
<div
  role="button"
  tabIndex={0}
  aria-label={`${item.query} の検索を再実行`}
  onKeyDown={(e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      onSelect(item.query)
    }
  }}
>
  {/* Content */}
</div>

// Screen reader announcements
<div role="status" aria-live="polite" className="sr-only">
  {history.length}件の検索履歴があります
</div>
```

#### Responsive Design

**Mobile (< 768px)**
- Full width container
- Reduced padding: `px-4 py-3` → `px-3 py-2.5`
- Hide result count on very small screens
- Single column layout

**Tablet (768px - 1024px)**
- Max width: 768px
- Standard padding
- Show all metadata

**Desktop (> 1024px)**
- Max width: 1024px (max-w-4xl)
- Generous spacing
- Hover effects fully enabled

---

### 4. Filter & Sort Improvements

#### Current Implementation Issues
1. Filters apply automatically on select (no user control)
2. Button labeled "降順" instead of "ソート"
3. No visual feedback for pending filter changes

#### Required Changes

**FilterPanel Component Update**
```tsx
const FilterPanel: FC<FilterPanelProps> = ({ onFilterChange }) => {
  const [pendingFilters, setPendingFilters] = useState<FilterOptions>(initialFilters)
  const [appliedFilters, setAppliedFilters] = useState<FilterOptions>(initialFilters)
  const [hasChanges, setHasChanges] = useState(false)

  // Track if filters have changed but not applied
  useEffect(() => {
    const changed = JSON.stringify(pendingFilters) !== JSON.stringify(appliedFilters)
    setHasChanges(changed)
  }, [pendingFilters, appliedFilters])

  // Apply filters when "ソート" button clicked
  const handleApplyFilters = () => {
    setAppliedFilters(pendingFilters)
    onFilterChange(pendingFilters)
    setHasChanges(false)
  }

  return (
    <div className="bg-white/90 dark:bg-[#1C1C1E]/90 backdrop-blur-xl rounded-2xl shadow-sm border border-[#D1D1D6]/30 dark:border-[#38383A]/30 p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Filter className="h-5 w-5 text-[#6E6E73] dark:text-[#8E8E93]" />
          <h3 className="font-semibold text-[#1D1D1F] dark:text-[#F5F5F7]">
            フィルター・ソート
          </h3>
          {/* Change indicator */}
          {hasChanges && (
            <span className="
              ml-2 px-2 py-0.5
              text-[0.75rem] font-medium
              bg-[#007AFF]/10 dark:bg-[#0A84FF]/10
              text-[#007AFF] dark:text-[#0A84FF]
              rounded-full
              animate-fade-in-scale
            ">
              未適用
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Reset button */}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleReset}
            className="text-[#6E6E73] dark:text-[#8E8E93] hover:bg-[#8E8E93]/10"
          >
            リセット
          </Button>

          {/* Apply button - Changed from "降順" to "ソート" */}
          <Button
            variant={hasChanges ? 'primary' : 'outline'}
            size="sm"
            onClick={handleApplyFilters}
            disabled={!hasChanges}
            className={`
              ${hasChanges
                ? 'bg-[#007AFF] hover:bg-[#0051D5] text-white shadow-md'
                : 'bg-transparent border-[#D1D1D6] dark:border-[#38383A] text-[#8E8E93]'
              }
              transition-all duration-300
            `}
          >
            <SortAsc className="h-4 w-4 mr-1" />
            ソート
          </Button>
        </div>
      </div>

      {/* Filter controls */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        <Select
          label="ファイルタイプ"
          value={pendingFilters.fileType}
          onChange={(value) => setPendingFilters(prev => ({ ...prev, fileType: value }))}
          options={FILE_TYPE_OPTIONS}
        />

        <Select
          label="更新日時"
          value={pendingFilters.dateRange}
          onChange={(value) => setPendingFilters(prev => ({ ...prev, dateRange: value }))}
          options={DATE_RANGE_OPTIONS}
        />

        <Select
          label="ファイルサイズ"
          value={pendingFilters.fileSize}
          onChange={(value) => setPendingFilters(prev => ({ ...prev, fileSize: value }))}
          options={FILE_SIZE_OPTIONS}
        />

        <Select
          label="並び替え"
          value={pendingFilters.sortBy}
          onChange={(value) => setPendingFilters(prev => ({ ...prev, sortBy: value }))}
          options={SORT_BY_OPTIONS}
        />
      </div>
    </div>
  )
}
```

#### Visual States

**Default State (No Changes)**
```css
/* ソート button - disabled appearance */
background: transparent;
border: 1px solid #D1D1D6; /* dark: #38383A */
color: #8E8E93;
opacity: 0.6;
cursor: not-allowed;
```

**Pending Changes State**
```css
/* ソート button - active appearance */
background: linear-gradient(180deg, #007AFF 0%, #0051D5 100%);
color: white;
box-shadow: 0 0.25rem 0.5rem rgba(0, 122, 255, 0.2);
cursor: pointer;

/* "未適用" badge */
background: rgba(0, 122, 255, 0.1);
color: #007AFF;
animation: fade-in-scale 200ms cubic-bezier(0.22, 1, 0.36, 1);
```

**Loading State (During Sort Operation)**
```tsx
<Button variant="primary" size="sm" disabled>
  <Spinner className="h-4 w-4 mr-2" />
  処理中...
</Button>
```

#### Button States Comparison

| State | Label | Background | Border | Text Color | Cursor | Shadow |
|-------|-------|------------|--------|------------|--------|--------|
| Default | ソート | Transparent | #D1D1D6 | #8E8E93 | not-allowed | None |
| Pending | ソート | #007AFF | None | White | pointer | md |
| Loading | 処理中... | #007AFF | None | White | wait | md |
| Success | ソート | Transparent | #D1D1D6 | #8E8E93 | not-allowed | None |

---

### 5. Sidebar Collapse Feature

#### Overview
Replace view toggle buttons (エクスプローラー/グリッド) with collapsible sidebar functionality. Sidebar collapses to left edge when close button clicked, expands when collapsed area clicked.

#### Layout Structure Changes

**Current (REMOVE)**
```tsx
{/* Top-right view toggle buttons - DELETE THIS */}
<div className="flex items-center gap-2">
  <Button variant={viewMode === 'explorer' ? 'primary' : 'outline'}>
    エクスプローラー
  </Button>
  <Button variant={viewMode === 'grid' ? 'primary' : 'outline'}>
    グリッド
  </Button>
</div>
```

**New Implementation**
```tsx
const ExplorerView: FC<ExplorerViewProps> = ({ searchResults, onPreview, onDownload }) => {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [isAnimating, setIsAnimating] = useState(false)

  const handleToggleSidebar = () => {
    setIsAnimating(true)
    setIsSidebarCollapsed(prev => !prev)
    setTimeout(() => setIsAnimating(false), 300) // Match animation duration
  }

  return (
    <div className="h-[600px] bg-white/90 dark:bg-[#1C1C1E]/90 backdrop-blur-xl border border-[#D1D1D6]/30 dark:border-[#38383A]/30 rounded-2xl overflow-hidden shadow-sm">
      <PanelGroup direction="horizontal">
        {/* Left Panel: Collapsible Sidebar */}
        <Panel
          defaultSize={25}
          minSize={isSidebarCollapsed ? 0 : 15}
          maxSize={isSidebarCollapsed ? 0 : 40}
          collapsible={true}
          collapsedSize={0}
          className={`
            transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]
            ${isSidebarCollapsed ? 'opacity-0' : 'opacity-100'}
          `}
        >
          <div className="h-full bg-[#F5F5F7] dark:bg-[#1C1C1E] border-r border-[#D1D1D6]/30 dark:border-[#38383A]/30">
            {/* Header with Close Button */}
            <div className="px-4 py-3 border-b border-[#D1D1D6]/30 dark:border-[#38383A]/30 flex items-center justify-between">
              <h3 className="text-[0.9375rem] font-semibold text-[#1D1D1F] dark:text-[#F5F5F7]">
                フォルダ構造
              </h3>

              {/* Close Button */}
              <button
                onClick={handleToggleSidebar}
                aria-label="サイドバーを閉じる"
                className="
                  p-1.5 rounded-lg
                  hover:bg-[#D1D1D6]/40 dark:hover:bg-[#38383A]/40
                  active:bg-[#D1D1D6]/60 dark:active:bg-[#38383A]/60
                  transition-all duration-200
                  group
                "
              >
                <ChevronsLeft className="
                  h-4 w-4
                  text-[#6E6E73] dark:text-[#8E8E93]
                  group-hover:text-[#1D1D1F] dark:group-hover:text-[#F5F5F7]
                  transition-colors duration-200
                " />
              </button>
            </div>

            {/* Tree View */}
            <div className="overflow-y-auto h-[calc(100%-3.25rem)] p-2">
              <FolderTree
                data={dummyFolderData}
                onSelectFolder={handleFolderSelect}
                selectedPath={selectedFolder}
              />
            </div>
          </div>
        </Panel>

        {/* Collapsed Sidebar Tab (shown when collapsed) */}
        {isSidebarCollapsed && (
          <div
            onClick={handleToggleSidebar}
            className="
              absolute left-0 top-0 bottom-0 w-10
              bg-[#F5F5F7]/95 dark:bg-[#1C1C1E]/95
              backdrop-blur-xl
              border-r border-[#D1D1D6]/30 dark:border-[#38383A]/30
              cursor-pointer
              hover:bg-[#F5F5F7] dark:hover:bg-[#1C1C1E]
              hover:shadow-lg
              transition-all duration-200
              flex items-center justify-center
              group
              animate-fade-in-fast
              z-10
            "
            role="button"
            tabIndex={0}
            aria-label="サイドバーを開く"
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                handleToggleSidebar()
              }
            }}
          >
            {/* Vertical Icon */}
            <div className="flex flex-col items-center gap-1">
              <ChevronsRight className="
                h-5 w-5
                text-[#6E6E73] dark:text-[#8E8E93]
                group-hover:text-[#007AFF] dark:group-hover:text-[#0A84FF]
                transition-all duration-200
                group-hover:scale-110
              " />

              {/* Vertical Text (optional - can be removed for cleaner look) */}
              <div className="
                text-[0.625rem] font-medium
                text-[#8E8E93]
                group-hover:text-[#007AFF] dark:group-hover:text-[#0A84FF]
                writing-mode-vertical-rl
                transition-colors duration-200
              ">
                フォルダ
              </div>
            </div>
          </div>
        )}

        {/* Resize Handle (hidden when collapsed) */}
        {!isSidebarCollapsed && (
          <PanelResizeHandle className="w-1 bg-[#D1D1D6]/30 dark:bg-[#38383A]/30 hover:bg-[#007AFF]/30 dark:hover:bg-[#0A84FF]/30 transition-colors cursor-col-resize flex items-center justify-center">
            <GripVertical className="w-4 h-4 text-[#8E8E93]" />
          </PanelResizeHandle>
        )}

        {/* Right Panel: Search Results */}
        <Panel defaultSize={75}>
          <div className="h-full bg-white/90 dark:bg-[#1C1C1E]/90">
            {/* Results Header */}
            <div className="px-4 py-3 border-b border-[#D1D1D6]/30 dark:border-[#38383A]/30 flex items-center justify-between">
              <h3 className="text-[0.9375rem] font-semibold text-[#1D1D1F] dark:text-[#F5F5F7]">
                検索結果
              </h3>
              <span className="text-[0.8125rem] text-[#6E6E73] dark:text-[#8E8E93]">
                {searchResults.length}件
              </span>
            </div>

            {/* Results List */}
            <div className="overflow-y-auto h-[calc(100%-3.25rem)] p-4 space-y-4">
              {searchResults.map((result) => (
                <SearchResultCard
                  key={result.id}
                  result={result}
                  onPreview={onPreview}
                  onDownload={onDownload}
                />
              ))}
            </div>
          </div>
        </Panel>
      </PanelGroup>
    </div>
  )
}
```

#### Close Button Design

**Visual Specifications**
```css
/* Close Button Container */
padding: 0.375rem;           /* 6px */
border-radius: 0.5rem;       /* 8px */
background: transparent;

/* Hover State */
background: rgba(209, 209, 214, 0.4);  /* Light mode */
background: rgba(56, 56, 58, 0.4);     /* Dark mode */

/* Active State */
background: rgba(209, 209, 214, 0.6);  /* Light mode */
background: rgba(56, 56, 58, 0.6);     /* Dark mode */
transform: scale(0.95);

/* Icon */
color: #6E6E73;              /* Light mode */
color: #8E8E93;              /* Dark mode */
size: 16px;                  /* 1rem */

/* Icon Hover */
color: #1D1D1F;              /* Light mode */
color: #F5F5F7;              /* Dark mode */
```

**Icon Choice**
```tsx
import { ChevronsLeft } from 'lucide-react'

// Double chevron indicates "collapse completely"
<ChevronsLeft className="h-4 w-4" />
```

#### Collapsed Tab Design

**Visual Specifications**
```css
/* Collapsed Tab */
position: absolute;
left: 0;
top: 0;
bottom: 0;
width: 2.5rem;               /* 40px */
z-index: 10;

background: rgba(245, 245, 247, 0.95);  /* Light mode */
background: rgba(28, 28, 30, 0.95);     /* Dark mode */
backdrop-filter: blur(1.5rem);

border-right: 1px solid rgba(209, 209, 214, 0.3);

/* Hover State */
background: rgb(245, 245, 247);         /* Solid background */
box-shadow: 0 0.5rem 1rem rgba(0, 0, 0, 0.12);

/* Icon in Tab */
color: #6E6E73;              /* Default */
color: #007AFF;              /* Hover */
transform: scale(1.1);       /* Hover - subtle pop */
```

**Tab Content Layout**
```tsx
{/* Vertical layout - centered */}
<div className="flex flex-col items-center justify-center gap-1 h-full">
  {/* Expand icon */}
  <ChevronsRight className="h-5 w-5" />

  {/* Optional: Vertical text */}
  <span className="text-[0.625rem] writing-mode-vertical-rl">
    フォルダ
  </span>
</div>
```

#### Animation Specifications

**Collapse Animation**
```typescript
// Tailwind config addition
keyframes: {
  'sidebar-collapse': {
    '0%': {
      width: '25%',
      opacity: '1',
    },
    '100%': {
      width: '0%',
      opacity: '0',
    },
  },
  'sidebar-expand': {
    '0%': {
      width: '0%',
      opacity: '0',
    },
    '100%': {
      width: '25%',
      opacity: '1',
    },
  },
}

animation: {
  'sidebar-collapse': 'sidebar-collapse 300ms cubic-bezier(0.22, 1, 0.36, 1) forwards',
  'sidebar-expand': 'sidebar-expand 300ms cubic-bezier(0.22, 1, 0.36, 1) forwards',
}
```

**State Transitions**
```typescript
// Transition flow
Expanded → Click Close → Start Collapse (300ms) → Collapsed State → Show Tab
Collapsed → Click Tab → Start Expand (300ms) → Expanded State → Hide Tab

// During animation
isAnimating = true → Disable click events → Animation complete → isAnimating = false
```

#### Accessibility Features

```tsx
// Close Button
<button
  onClick={handleToggleSidebar}
  aria-label="サイドバーを閉じる"
  aria-expanded={!isSidebarCollapsed}
  aria-controls="sidebar-panel"
>
  <ChevronsLeft />
</button>

// Collapsed Tab
<div
  onClick={handleToggleSidebar}
  role="button"
  tabIndex={0}
  aria-label="サイドバーを開く"
  aria-expanded={!isSidebarCollapsed}
  aria-controls="sidebar-panel"
  onKeyDown={(e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      handleToggleSidebar()
    }
  }}
>
  <ChevronsRight />
</div>

// Sidebar Panel
<div
  id="sidebar-panel"
  aria-hidden={isSidebarCollapsed}
  className={isSidebarCollapsed ? 'sr-only' : ''}
>
  {/* Sidebar content */}
</div>

// Screen reader announcements
<div role="status" aria-live="polite" className="sr-only">
  {isSidebarCollapsed ? 'サイドバーを閉じました' : 'サイドバーを開きました'}
</div>
```

#### Responsive Behavior

**Mobile (< 768px)**
```typescript
// Sidebar defaults to collapsed on mobile
const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(
  window.innerWidth < 768
)

// Collapsed tab width: 32px (smaller)
// Tab text: Hidden (icon only)
```

**Tablet (768px - 1024px)**
```typescript
// Sidebar visible by default
// Collapsed tab width: 40px
// Tab text: Visible
```

**Desktop (> 1024px)**
```typescript
// Sidebar visible by default
// Collapsed tab width: 40px
// Tab text: Visible
// Hover effects: Fully enabled
```

#### Keyboard Navigation

```typescript
// Keyboard shortcuts
useEffect(() => {
  const handleKeyPress = (e: KeyboardEvent) => {
    // Cmd+B or Ctrl+B to toggle sidebar
    if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
      e.preventDefault()
      handleToggleSidebar()
    }

    // Escape to collapse if expanded
    if (e.key === 'Escape' && !isSidebarCollapsed) {
      handleToggleSidebar()
    }
  }

  window.addEventListener('keydown', handleKeyPress)
  return () => window.removeEventListener('keydown', handleKeyPress)
}, [isSidebarCollapsed])
```

---

## 🎨 Component Design Patterns

### Button States

```typescript
const buttonStates = {
  default: {
    background: '#007AFF',
    color: '#FFFFFF',
    shadow: 'sm',
    transform: 'scale(1)',
  },
  hover: {
    background: '#0051D5',
    shadow: 'md',
    transform: 'scale(1.02)',
  },
  active: {
    background: '#004CCC',
    shadow: 'sm',
    transform: 'scale(0.98)',
  },
  disabled: {
    background: '#D1D1D6',
    color: '#8E8E93',
    shadow: 'none',
    opacity: 0.6,
    cursor: 'not-allowed',
  },
  focus: {
    outline: 'none',
    ring: '4px solid rgba(0, 122, 255, 0.1)',
  },
}
```

### Input States

```typescript
const inputStates = {
  default: {
    background: 'rgba(255, 255, 255, 0.9)',
    border: '1px solid rgba(209, 209, 214, 0.3)',
    shadow: 'sm',
  },
  hover: {
    background: '#FFFFFF',
    shadow: 'md',
  },
  focus: {
    border: '1px solid #007AFF',
    ring: '4px solid rgba(0, 122, 255, 0.1)',
    shadow: 'md',
  },
  error: {
    border: '1px solid #FF3B30',
    ring: '4px solid rgba(255, 59, 48, 0.1)',
  },
  disabled: {
    background: '#F5F5F7',
    color: '#8E8E93',
    cursor: 'not-allowed',
    opacity: 0.6,
  },
}
```

### Card States

```typescript
const cardStates = {
  default: {
    background: 'rgba(255, 255, 255, 0.9)',
    backdropFilter: 'blur(24px)',
    border: '1px solid rgba(209, 209, 214, 0.3)',
    borderRadius: '1.25rem', // 20px
    shadow: 'sm',
    transform: 'scale(1)',
  },
  hover: {
    border: '1px solid rgba(0, 122, 255, 0.3)',
    shadow: 'md',
    transform: 'scale(1.005)', // Subtle lift
  },
  active: {
    background: '#007AFF',
    color: '#FFFFFF',
    shadow: 'lg',
  },
}
```

---

## 📱 Responsive Breakpoints

```typescript
const breakpoints = {
  sm: '640px',    // Mobile landscape
  md: '768px',    // Tablet
  lg: '1024px',   // Desktop
  xl: '1280px',   // Large desktop
  '2xl': '1536px', // Extra large desktop
}

// Usage in components
const responsive = {
  mobile: '@media (max-width: 767px)',
  tablet: '@media (min-width: 768px) and (max-width: 1023px)',
  desktop: '@media (min-width: 1024px)',
}
```

---

## ♿ Accessibility Requirements

### WCAG 2.1 AA Compliance

#### Color Contrast
- **Normal text (< 18px)**: Minimum 4.5:1 contrast ratio
- **Large text (≥ 18px)**: Minimum 3:1 contrast ratio
- **UI components**: Minimum 3:1 contrast ratio

#### Contrast Ratios (Light Mode)
```typescript
const contrastRatios = {
  // Text on white background
  '#1D1D1F on #FFFFFF': 16.1,   // Primary text ✅
  '#424245 on #FFFFFF': 11.2,   // Secondary text ✅
  '#6E6E73 on #FFFFFF': 7.1,    // Tertiary text ✅
  '#8E8E93 on #FFFFFF': 4.9,    // Metadata ✅

  // Accent colors
  '#007AFF on #FFFFFF': 4.6,    // Blue accent ✅
  '#34C759 on #FFFFFF': 2.8,    // Success (large text only) ⚠️
  '#FF3B30 on #FFFFFF': 4.1,    // Error ✅
}
```

#### Keyboard Navigation
```typescript
// All interactive elements must support:
- Tab navigation (sequential focus)
- Enter/Space activation
- Escape dismissal (modals, dropdowns)
- Arrow keys (lists, menus)
- Cmd/Ctrl shortcuts (power users)

// Focus indicators (always visible)
focus-visible:ring-4 focus-visible:ring-[#007AFF]/10
focus-visible:outline-none
```

#### ARIA Labels
```tsx
// Search input
<input
  type="text"
  aria-label="ファイル検索"
  aria-describedby="search-description"
/>
<div id="search-description" className="sr-only">
  ファイル名、内容、またはタグを入力して検索できます
</div>

// Button with icon only
<button aria-label="サイドバーを閉じる">
  <ChevronsLeft />
</button>

// Loading state
<div role="status" aria-live="polite">
  <Spinner />
  <span className="sr-only">検索中です...</span>
</div>

// Search results count
<div role="status" aria-live="polite" aria-atomic="true">
  {searchResults.length}件の検索結果が見つかりました
</div>
```

#### Screen Reader Support
```tsx
// Skip navigation link
<a href="#main-content" className="sr-only focus:not-sr-only">
  メインコンテンツへスキップ
</a>

// Landmark regions
<header role="banner">...</header>
<nav role="navigation" aria-label="主要ナビゲーション">...</nav>
<main role="main" id="main-content">...</main>
<aside role="complementary" aria-label="サイドバー">...</aside>
<footer role="contentinfo">...</footer>

// Hidden text for context
<span className="sr-only">現在のページ:</span>
<span aria-current="page">検索結果</span>
```

#### Touch Targets
```typescript
// Minimum touch target size: 44x44px (iOS HIG)
const touchTargets = {
  minimum: '44px',
  recommended: '48px',

  // Apply to all interactive elements
  buttons: 'min-h-[2.75rem] min-w-[2.75rem]', // 44px
  links: 'min-h-[2.75rem] inline-block',
  checkboxes: 'h-[2.75rem] w-[2.75rem]',
}
```

---

## 🎬 Animation Library

### Keyframes (Tailwind Config)

```typescript
// tailwind.config.ts additions
export default {
  theme: {
    extend: {
      keyframes: {
        // Fade animations
        'fade-in': {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-out': {
          '0%': { opacity: '1', transform: 'translateY(0)' },
          '100%': { opacity: '0', transform: 'translateY(-10px)' },
        },
        'fade-in-scale': {
          '0%': { opacity: '0', transform: 'scale(0.95)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },

        // Slide animations
        'slide-in-left': {
          '0%': { opacity: '0', transform: 'translateX(-20px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        'slide-in-right': {
          '0%': { opacity: '0', transform: 'translateX(20px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        'slide-out-left': {
          '0%': { opacity: '1', transform: 'translateX(0)' },
          '100%': { opacity: '0', transform: 'translateX(-20px)' },
        },

        // Panel animations
        'panel-collapse': {
          '0%': { width: 'var(--panel-width)', opacity: '1' },
          '100%': { width: '0', opacity: '0' },
        },
        'panel-expand': {
          '0%': { width: '0', opacity: '0' },
          '100%': { width: 'var(--panel-width)', opacity: '1' },
        },

        // Pulse (loading indicators)
        'pulse-subtle': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.5' },
        },
      },

      animation: {
        // Fade
        'fade-in': 'fade-in 0.3s cubic-bezier(0.22, 1, 0.36, 1) forwards',
        'fade-in-fast': 'fade-in 0.2s cubic-bezier(0.22, 1, 0.36, 1) forwards',
        'fade-out': 'fade-out 0.2s cubic-bezier(0.4, 0, 1, 1) forwards',
        'fade-in-scale': 'fade-in-scale 0.3s cubic-bezier(0.22, 1, 0.36, 1) forwards',

        // Slide
        'slide-in-left': 'slide-in-left 0.3s cubic-bezier(0.22, 1, 0.36, 1) forwards',
        'slide-in-right': 'slide-in-right 0.3s cubic-bezier(0.22, 1, 0.36, 1) forwards',
        'slide-out-left': 'slide-out-left 0.2s cubic-bezier(0.4, 0, 1, 1) forwards',

        // Panel
        'panel-collapse': 'panel-collapse 0.3s cubic-bezier(0.22, 1, 0.36, 1) forwards',
        'panel-expand': 'panel-expand 0.3s cubic-bezier(0.22, 1, 0.36, 1) forwards',

        // Loading
        'pulse-subtle': 'pulse-subtle 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
    },
  },
}
```

### Framer Motion Variants

```typescript
// For complex animations using Framer Motion
import { Variants } from 'framer-motion'

// Search History Item
export const historyItemVariants: Variants = {
  hidden: {
    opacity: 0,
    y: 10,
    scale: 0.95,
  },
  visible: (index: number) => ({
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      delay: index * 0.05, // Stagger effect
      duration: 0.3,
      ease: [0.22, 1, 0.36, 1], // Apple spring curve
    },
  }),
  exit: {
    opacity: 0,
    x: -20,
    transition: {
      duration: 0.2,
      ease: [0.4, 0, 1, 1],
    },
  },
}

// Sidebar Panel
export const sidebarVariants: Variants = {
  collapsed: {
    width: 0,
    opacity: 0,
    transition: {
      duration: 0.3,
      ease: [0.22, 1, 0.36, 1],
    },
  },
  expanded: {
    width: 'auto',
    opacity: 1,
    transition: {
      duration: 0.3,
      ease: [0.22, 1, 0.36, 1],
    },
  },
}

// Modal/Overlay
export const overlayVariants: Variants = {
  hidden: {
    opacity: 0,
  },
  visible: {
    opacity: 1,
    transition: {
      duration: 0.2,
    },
  },
  exit: {
    opacity: 0,
    transition: {
      duration: 0.15,
    },
  },
}

// Modal Content
export const modalVariants: Variants = {
  hidden: {
    opacity: 0,
    scale: 0.95,
    y: 20,
  },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: {
      duration: 0.3,
      ease: [0.22, 1, 0.36, 1],
    },
  },
  exit: {
    opacity: 0,
    scale: 0.95,
    y: 20,
    transition: {
      duration: 0.2,
      ease: [0.4, 0, 1, 1],
    },
  },
}
```

---

## 📊 State Management Patterns

### Search History State

```typescript
// hooks/useSearchHistory.ts
import { useState, useEffect, useCallback } from 'react'

interface SearchHistoryItem {
  id: string
  query: string
  timestamp: string
  resultCount?: number
}

export const useSearchHistory = () => {
  const [history, setHistory] = useState<SearchHistoryItem[]>([])
  const [isLoading, setIsLoading] = useState(true)

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem('searchHistory')
      if (stored) {
        const parsed = JSON.parse(stored)
        setHistory(parsed)
      }
    } catch (error) {
      console.error('Failed to load search history:', error)
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Add to history
  const addToHistory = useCallback((query: string, resultCount?: number) => {
    const newItem: SearchHistoryItem = {
      id: crypto.randomUUID(),
      query,
      timestamp: new Date().toISOString(),
      resultCount,
    }

    setHistory((prev) => {
      // Remove duplicate
      const filtered = prev.filter(item => item.query !== query)
      // Add to beginning, limit to 10
      const updated = [newItem, ...filtered].slice(0, 10)

      // Persist to localStorage
      try {
        localStorage.setItem('searchHistory', JSON.stringify(updated))
      } catch (error) {
        console.error('Failed to save search history:', error)
      }

      return updated
    })
  }, [])

  // Delete item
  const deleteHistoryItem = useCallback((id: string) => {
    setHistory((prev) => {
      const updated = prev.filter(item => item.id !== id)

      try {
        localStorage.setItem('searchHistory', JSON.stringify(updated))
      } catch (error) {
        console.error('Failed to update search history:', error)
      }

      return updated
    })
  }, [])

  // Clear all
  const clearAllHistory = useCallback(() => {
    setHistory([])

    try {
      localStorage.removeItem('searchHistory')
    } catch (error) {
      console.error('Failed to clear search history:', error)
    }
  }, [])

  return {
    history,
    isLoading,
    addToHistory,
    deleteHistoryItem,
    clearAllHistory,
  }
}
```

### Filter State Management

```typescript
// hooks/useFilterState.ts
import { useState, useCallback, useEffect } from 'react'
import type { FilterOptions } from '@/types'

const DEFAULT_FILTERS: FilterOptions = {
  fileType: 'all',
  dateRange: 'all',
  fileSize: 'all',
  sortBy: 'relevance',
  sortOrder: 'desc',
}

export const useFilterState = (onFilterChange: (filters: FilterOptions) => void) => {
  const [pendingFilters, setPendingFilters] = useState<FilterOptions>(DEFAULT_FILTERS)
  const [appliedFilters, setAppliedFilters] = useState<FilterOptions>(DEFAULT_FILTERS)
  const [hasChanges, setHasChanges] = useState(false)

  // Detect changes
  useEffect(() => {
    const changed = JSON.stringify(pendingFilters) !== JSON.stringify(appliedFilters)
    setHasChanges(changed)
  }, [pendingFilters, appliedFilters])

  // Apply filters
  const applyFilters = useCallback(() => {
    setAppliedFilters(pendingFilters)
    onFilterChange(pendingFilters)
    setHasChanges(false)
  }, [pendingFilters, onFilterChange])

  // Reset to defaults
  const resetFilters = useCallback(() => {
    setPendingFilters(DEFAULT_FILTERS)
    setAppliedFilters(DEFAULT_FILTERS)
    onFilterChange(DEFAULT_FILTERS)
    setHasChanges(false)
  }, [onFilterChange])

  // Individual filter updaters
  const updateFilter = useCallback(<K extends keyof FilterOptions>(
    key: K,
    value: FilterOptions[K]
  ) => {
    setPendingFilters(prev => ({ ...prev, [key]: value }))
  }, [])

  return {
    pendingFilters,
    appliedFilters,
    hasChanges,
    applyFilters,
    resetFilters,
    updateFilter,
  }
}
```

### Sidebar Collapse State

```typescript
// hooks/useSidebarCollapse.ts
import { useState, useEffect, useCallback } from 'react'

export const useSidebarCollapse = () => {
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [isAnimating, setIsAnimating] = useState(false)

  // Responsive: Auto-collapse on mobile
  useEffect(() => {
    const checkWidth = () => {
      if (window.innerWidth < 768) {
        setIsCollapsed(true)
      }
    }

    checkWidth()
    window.addEventListener('resize', checkWidth)
    return () => window.removeEventListener('resize', checkWidth)
  }, [])

  // Toggle with animation lock
  const toggle = useCallback(() => {
    if (isAnimating) return

    setIsAnimating(true)
    setIsCollapsed(prev => !prev)

    // Reset animation lock after duration
    setTimeout(() => {
      setIsAnimating(false)
    }, 300) // Match animation duration
  }, [isAnimating])

  // Keyboard shortcut (Cmd+B / Ctrl+B)
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        e.preventDefault()
        toggle()
      }

      // Escape to collapse
      if (e.key === 'Escape' && !isCollapsed) {
        toggle()
      }
    }

    window.addEventListener('keydown', handleKeyPress)
    return () => window.removeEventListener('keydown', handleKeyPress)
  }, [toggle, isCollapsed])

  return {
    isCollapsed,
    isAnimating,
    toggle,
  }
}
```

---

## 🧪 Testing Specifications

### Visual Regression Testing

```typescript
// Playwright visual tests for UI changes
import { test, expect } from '@playwright/test'

test.describe('UI/UX Improvements', () => {
  test('search bar positioning below header', async ({ page }) => {
    await page.goto('/')

    // Verify search bar is sticky and below header
    const searchBar = page.locator('[aria-label="検索キーワード"]')
    await expect(searchBar).toBeVisible()

    // Check positioning
    const searchBarBox = await searchBar.boundingBox()
    const headerBox = await page.locator('header').boundingBox()

    expect(searchBarBox?.y).toBeGreaterThan(headerBox?.bottom ?? 0)
  })

  test('search history display and hide', async ({ page }) => {
    await page.goto('/')

    // Search history visible when no search performed
    const history = page.locator('[data-testid="search-history"]')
    await expect(history).toBeVisible()

    // Perform search
    await page.fill('[aria-label="検索キーワード"]', 'test')
    await page.click('button:has-text("検索")')

    // Search history hidden, results visible
    await expect(history).not.toBeVisible()
    await expect(page.locator('[data-testid="search-results"]')).toBeVisible()
  })

  test('filter apply button state', async ({ page }) => {
    await page.goto('/')
    await page.fill('[aria-label="検索キーワード"]', 'test')
    await page.click('button:has-text("検索")')

    const sortButton = page.locator('button:has-text("ソート")')

    // Initially disabled
    await expect(sortButton).toBeDisabled()

    // Select filter
    await page.selectOption('[aria-label="ファイルタイプ"]', 'pdf')

    // Now enabled
    await expect(sortButton).toBeEnabled()

    // After click, disabled again
    await sortButton.click()
    await expect(sortButton).toBeDisabled()
  })

  test('sidebar collapse and expand', async ({ page }) => {
    await page.goto('/')
    await page.fill('[aria-label="検索キーワード"]', 'test')
    await page.click('button:has-text("検索")')

    const sidebar = page.locator('[data-testid="sidebar"]')
    const collapseButton = page.locator('[aria-label="サイドバーを閉じる"]')

    // Initially visible
    await expect(sidebar).toBeVisible()

    // Click collapse
    await collapseButton.click()
    await page.waitForTimeout(350) // Wait for animation

    // Sidebar hidden, tab visible
    await expect(sidebar).not.toBeVisible()
    await expect(page.locator('[aria-label="サイドバーを開く"]')).toBeVisible()

    // Click tab to expand
    await page.click('[aria-label="サイドバーを開く"]')
    await page.waitForTimeout(350)

    // Sidebar visible again
    await expect(sidebar).toBeVisible()
  })
})
```

### Accessibility Testing

```typescript
// Axe-core integration
import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test('accessibility compliance', async ({ page }) => {
  await page.goto('/')

  const accessibilityScanResults = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()

  expect(accessibilityScanResults.violations).toEqual([])
})
```

### Performance Testing

```typescript
// Lighthouse CI for performance metrics
test('performance metrics', async ({ page }) => {
  await page.goto('/')

  // Measure Core Web Vitals
  const metrics = await page.evaluate(() => {
    return {
      fcp: performance.getEntriesByName('first-contentful-paint')[0]?.startTime,
      lcp: performance.getEntriesByType('largest-contentful-paint')[0]?.startTime,
      cls: performance.getEntriesByType('layout-shift').reduce((sum, entry) => sum + entry.value, 0),
    }
  })

  // Targets (Apple-level performance)
  expect(metrics.fcp).toBeLessThan(1000) // < 1s
  expect(metrics.lcp).toBeLessThan(2500) // < 2.5s
  expect(metrics.cls).toBeLessThan(0.1)  // < 0.1
})
```

---

## 📝 Implementation Checklist

### Phase 1: Structural Changes
- [ ] Remove hero section (lines 137-226 in page.tsx)
- [ ] Reposition SearchBar below Header
- [ ] Update SearchBar placeholder text
- [ ] Implement sticky positioning for search bar
- [ ] Add backdrop blur effect to search bar container

### Phase 2: Search History Feature
- [ ] Create SearchHistoryItem component
- [ ] Create SearchHistoryEmpty component
- [ ] Implement useSearchHistory hook
- [ ] Add localStorage integration
- [ ] Implement history item click to re-search
- [ ] Add delete individual item functionality
- [ ] Add clear all history functionality
- [ ] Implement show/hide logic based on search state
- [ ] Add staggered entry animations
- [ ] Add accessibility features (ARIA labels, keyboard nav)

### Phase 3: Filter Panel Updates
- [ ] Add pending vs applied filter state tracking
- [ ] Change "降順" button to "ソート"
- [ ] Implement "未適用" badge when filters changed
- [ ] Disable "ソート" button when no changes
- [ ] Add loading state during sort operation
- [ ] Update visual styles for button states
- [ ] Add success feedback after sort applied

### Phase 4: Sidebar Collapse Feature
- [ ] Remove view toggle buttons from page.tsx
- [ ] Add close button to sidebar header
- [ ] Implement useSidebarCollapse hook
- [ ] Create collapsed tab component
- [ ] Add collapse/expand animations
- [ ] Implement keyboard shortcuts (Cmd+B)
- [ ] Add accessibility features
- [ ] Handle responsive behavior (auto-collapse on mobile)
- [ ] Add animation locking to prevent rapid toggling

### Phase 5: Design Polish
- [ ] Update all color values to design system
- [ ] Verify typography scale consistency
- [ ] Ensure spacing follows 8-point grid
- [ ] Add all animation variants to Tailwind config
- [ ] Implement shadow system consistently
- [ ] Verify border radius values

### Phase 6: Testing & Quality Assurance
- [ ] Write unit tests for new hooks
- [ ] Write component tests for new components
- [ ] Add visual regression tests
- [ ] Run accessibility audit with Axe
- [ ] Test keyboard navigation thoroughly
- [ ] Test screen reader compatibility
- [ ] Verify touch target sizes on mobile
- [ ] Performance testing (Core Web Vitals)

### Phase 7: Documentation
- [ ] Update CLAUDE.md with new features
- [ ] Document new components in Storybook
- [ ] Add JSDoc comments to all new code
- [ ] Create usage examples for new hooks
- [ ] Update README with new UI features

---

## 🎯 Success Metrics

### User Experience
- **Search interaction time**: < 500ms from page load to search ready
- **Animation smoothness**: 60fps for all transitions
- **Perceived performance**: < 100ms for UI feedback on any interaction

### Accessibility
- **WCAG 2.1 AA**: 100% compliance
- **Keyboard navigation**: All features accessible without mouse
- **Screen reader**: Complete functionality with VoiceOver/NVDA

### Performance
- **First Contentful Paint (FCP)**: < 1.0s
- **Largest Contentful Paint (LCP)**: < 2.5s
- **Cumulative Layout Shift (CLS)**: < 0.1
- **Time to Interactive (TTI)**: < 3.0s

### Code Quality
- **Test coverage**: > 80% for new code
- **Type safety**: 100% TypeScript, no `any` types
- **Bundle size**: < 5KB increase for new features
- **A11y violations**: 0 (via axe-core)

---

## 📚 References

### Design
- [Apple Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/)
- [SF Pro Font Family](https://developer.apple.com/fonts/)
- [iOS Design Themes](https://developer.apple.com/design/human-interface-guidelines/foundations/app-icons/)

### Accessibility
- [WCAG 2.1 Guidelines](https://www.w3.org/WAI/WCAG21/quickref/)
- [ARIA Authoring Practices](https://www.w3.org/WAI/ARIA/apg/)
- [WebAIM Contrast Checker](https://webaim.org/resources/contrastchecker/)

### Performance
- [Web Vitals](https://web.dev/vitals/)
- [Lighthouse CI](https://github.com/GoogleChrome/lighthouse-ci)
- [Next.js Performance](https://nextjs.org/docs/pages/building-your-application/optimizing)

### Animation
- [Framer Motion Documentation](https://www.framer.com/motion/)
- [Easing Functions](https://easings.net/)
- [Apple Motion Guidelines](https://developer.apple.com/design/human-interface-guidelines/motion)

---

## 🔄 Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 1.0.0 | 2025-10-21 | Initial specification | Design Team |

---

## ✅ Approval & Sign-off

- [ ] **Client Review**: Approved by client stakeholder
- [ ] **Design Review**: Approved by design lead
- [ ] **Technical Review**: Approved by engineering lead
- [ ] **Accessibility Review**: Approved by a11y specialist
- [ ] **Product Review**: Approved by product manager

---

**Document End**
