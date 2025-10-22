import { FC, ReactNode } from 'react'

import { motion, AnimatePresence } from 'framer-motion'
import { X, ChevronRight } from 'lucide-react'

interface SidebarProps {
  isCollapsed: boolean
  onToggleCollapse: () => void
  children: ReactNode
  title?: string
}

/**
 * Sidebar Component (Collapsible)
 *
 * Collapsible sidebar with smooth animations
 *
 * Features:
 * - Collapsible to left edge (60px collapsed width)
 * - Close button in header
 * - Clickable tab when collapsed to expand
 * - Framer Motion slide animations
 * - Persistent state via useSidebarState hook (in parent)
 *
 * @example
 * ```tsx
 * const { isCollapsed, toggleCollapse } = useSidebarState()
 *
 * <Sidebar
 *   isCollapsed={isCollapsed}
 *   onToggleCollapse={toggleCollapse}
 *   title="フォルダ構造"
 * >
 *   <FolderTree {...props} />
 * </Sidebar>
 * ```
 */
export const Sidebar: FC<SidebarProps> = ({
  isCollapsed,
  onToggleCollapse,
  children,
  title = 'フォルダ構造',
}) => {
  return (
    <motion.div
      initial={false}
      animate={{
        width: isCollapsed ? '60px' : '300px',
      }}
      transition={{
        duration: 0.3,
        ease: [0.22, 1, 0.36, 1], // Apple's favorite easing
      }}
      className="relative h-full bg-[#F5F5F7] dark:bg-[#1C1C1E] border-r border-[#D1D1D6]/30 dark:border-[#38383A]/30 overflow-hidden"
    >
      <AnimatePresence mode="wait">
        {isCollapsed ? (
          // Collapsed State: Vertical Tab
          <motion.button
            key="collapsed"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onToggleCollapse}
            className="absolute inset-0 flex items-center justify-center hover:bg-[#E5E5EA] dark:hover:bg-[#2C2C2E] transition-colors cursor-pointer group"
            aria-label="サイドバーを開く"
          >
            <div className="flex flex-col items-center gap-2">
              <ChevronRight className="h-6 w-6 text-[#6E6E73] dark:text-[#8E8E93] group-hover:text-[#007AFF] dark:group-hover:text-[#0A84FF] transition-colors" />
              <div className="writing-mode-vertical text-xs font-medium text-[#6E6E73] dark:text-[#8E8E93] group-hover:text-[#007AFF] dark:group-hover:text-[#0A84FF] transition-colors whitespace-nowrap">
                {title}
              </div>
            </div>
          </motion.button>
        ) : (
          // Expanded State: Full Sidebar
          <motion.div
            key="expanded"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="h-full flex flex-col"
          >
            {/* Header */}
            <div className="px-4 py-3 border-b border-[#D1D1D6]/30 dark:border-[#38383A]/30 flex items-center justify-between bg-white/50 dark:bg-[#1C1C1E]/50 backdrop-blur-sm">
              <h3 className="text-sm font-semibold text-[#1D1D1F] dark:text-[#F5F5F7]">{title}</h3>
              <button
                onClick={onToggleCollapse}
                className="p-1.5 rounded-lg hover:bg-[#E5E5EA] dark:hover:bg-[#2C2C2E] transition-colors group"
                aria-label="サイドバーを閉じる"
              >
                <X className="h-4 w-4 text-[#6E6E73] dark:text-[#8E8E93] group-hover:text-[#1D1D1F] dark:group-hover:text-[#F5F5F7] transition-colors" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-2">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Vertical text styling for collapsed state */}
      <style jsx>{`
        .writing-mode-vertical {
          writing-mode: vertical-rl;
          text-orientation: mixed;
        }
      `}</style>
    </motion.div>
  )
}
