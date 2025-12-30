/**
 * EmptyState Component
 *
 * データがない状態や検索結果0件時に表示するコンポーネント
 * アイコン、タイトル、説明、アクションボタンをサポート
 */

import { FC, ReactNode } from 'react';
import { motion } from 'framer-motion';

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

/**
 * EmptyState
 *
 * 検索結果0件、エラー、データなしなどの状態を表示
 *
 * @example
 * ```tsx
 * <EmptyState
 *   icon={<SearchIcon />}
 *   title="検索結果が見つかりません"
 *   description="別のキーワードで検索してみてください"
 *   action={<Button onClick={handleReset}>クリア</Button>}
 * />
 * ```
 */
export const EmptyState: FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  action,
  className = '',
}) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className={`flex flex-col items-center justify-center py-16 px-4 ${className}`}
    >
      {/* Icon */}
      {icon && (
        <div className="mb-4 text-[#6E6E73] dark:text-[#8E8E93]">
          {icon}
        </div>
      )}

      {/* Title */}
      <h3 className="text-xl font-semibold text-[#1D1D1F] dark:text-[#F5F5F7] mb-2">
        {title}
      </h3>

      {/* Description */}
      {description && (
        <p className="text-[#6E6E73] dark:text-[#8E8E93] text-center max-w-md mb-6">
          {description}
        </p>
      )}

      {/* Action */}
      {action && (
        <div>
          {action}
        </div>
      )}
    </motion.div>
  );
};
