'use client'

import { FC, useState } from 'react'
import { ChevronRight, ChevronDown, Folder, FolderOpen, File } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

interface TreeNode {
  id: string
  name: string
  type: 'folder' | 'file'
  children?: TreeNode[]
  path: string
}

interface FolderTreeProps {
  data: TreeNode[]
  onSelectFolder: (path: string) => void
  selectedPath?: string
}

interface TreeItemProps {
  node: TreeNode
  level: number
  onSelectFolder: (path: string) => void
  selectedPath?: string
}

const TreeItem: FC<TreeItemProps> = ({ node, level, onSelectFolder, selectedPath }) => {
  const [isExpanded, setIsExpanded] = useState(false)
  const hasChildren = node.type === 'folder' && node.children && node.children.length > 0

  const handleToggle = () => {
    if (node.type === 'folder') {
      setIsExpanded(!isExpanded)
      onSelectFolder(node.path)
    }
  }

  const isSelected = selectedPath === node.path

  return (
    <div>
      <div
        className={`
          flex items-center gap-1 px-2 py-1.5 cursor-pointer rounded-lg
          hover:bg-[#F5F5F7] dark:hover:bg-[#2C2C2E] transition-colors
          ${isSelected ? 'bg-[#007AFF]/10 dark:bg-[#0A84FF]/10' : ''}
        `}
        style={{ paddingLeft: `${level * 16 + 8}px` }}
        onClick={handleToggle}
      >
        {node.type === 'folder' && (
          <span className="w-4 h-4 flex items-center justify-center">
            {hasChildren && (
              isExpanded ?
                <ChevronDown className="w-3.5 h-3.5 text-[#6E6E73] dark:text-[#8E8E93]" /> :
                <ChevronRight className="w-3.5 h-3.5 text-[#6E6E73] dark:text-[#8E8E93]" />
            )}
          </span>
        )}
        {node.type === 'file' && <span className="w-4 h-4" />}

        {node.type === 'folder' ? (
          isExpanded ?
            <FolderOpen className="w-4 h-4 text-[#007AFF] dark:text-[#0A84FF]" /> :
            <Folder className="w-4 h-4 text-[#007AFF] dark:text-[#0A84FF]" />
        ) : (
          <File className="w-4 h-4 text-[#6E6E73] dark:text-[#8E8E93]" />
        )}

        <span className="text-sm text-[#1D1D1F] dark:text-[#F5F5F7] select-none">
          {node.name}
        </span>
      </div>

      <AnimatePresence>
        {isExpanded && hasChildren && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{ overflow: 'hidden' }}
          >
            {node.children!.map((child) => (
              <TreeItem
                key={child.id}
                node={child}
                level={level + 1}
                onSelectFolder={onSelectFolder}
                selectedPath={selectedPath}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export const FolderTree: FC<FolderTreeProps> = ({ data, onSelectFolder, selectedPath }) => {
  return (
    <div className="w-full">
      {data.map((node) => (
        <TreeItem
          key={node.id}
          node={node}
          level={0}
          onSelectFolder={onSelectFolder}
          selectedPath={selectedPath}
        />
      ))}
    </div>
  )
}