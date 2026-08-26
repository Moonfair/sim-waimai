import { useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChevronLeft, faChevronRight, faXmark } from '@fortawesome/free-solid-svg-icons';
import type { ChangelogListDto } from '@sim-waimai/shared';
import { useApi } from '../hooks/useApi';

interface Props {
  onClose: () => void;
}

export default function ChangelogModal({ onClose }: Props) {
  const { data, loading, error } = useApi<ChangelogListDto>('/changelog');
  const items = data?.items ?? [];
  const [index, setIndex] = useState(0);
  const current = items[index];

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-6" onClick={onClose}>
      <div
        className="w-full max-w-[340px] max-h-[80vh] flex flex-col bg-white dark:bg-gray-800 rounded-2xl p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-gray-900 dark:text-gray-100 font-bold text-base">更新日志</h2>
          <button
            className="w-7 h-7 flex items-center justify-center text-gray-400 dark:text-gray-500"
            onClick={onClose}
            aria-label="关闭"
          >
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </div>

        {loading ? (
          <div className="py-16 text-center text-gray-400 dark:text-gray-500 text-sm">加载中…</div>
        ) : error ? (
          <div className="py-16 text-center text-gray-400 dark:text-gray-500 text-sm">{error}</div>
        ) : !current ? (
          <div className="py-16 text-center text-gray-400 dark:text-gray-500 text-sm">暂无更新日志</div>
        ) : (
          <>
            <div className="flex items-baseline gap-2 mt-4">
              <span className="text-orange-500 font-bold text-sm">
                v{current.versionMajor}.{current.versionMinor}.{current.versionPatch}
              </span>
              <span className="text-gray-400 dark:text-gray-500 text-xs">
                {new Date(current.createdAt).toLocaleDateString('zh-CN')}
              </span>
            </div>
            <h3 className="mt-1 font-bold text-base text-gray-900 dark:text-gray-100">{current.title}</h3>
            <p className="flex-1 overflow-y-auto mt-2 text-sm text-gray-700 dark:text-gray-200 whitespace-pre-line">
              {current.content}
            </p>

            <div className="flex items-center justify-center gap-4 mt-4 pt-3 border-t border-gray-100 dark:border-gray-700">
              <button
                type="button"
                className="w-8 h-8 rounded-full flex items-center justify-center text-gray-500 dark:text-gray-400 disabled:opacity-30"
                disabled={index <= 0}
                onClick={() => setIndex((i) => i - 1)}
                aria-label="上一条"
              >
                <FontAwesomeIcon icon={faChevronLeft} />
              </button>
              <span className="text-gray-400 dark:text-gray-500 text-xs">
                第 {index + 1} / {items.length} 条
              </span>
              <button
                type="button"
                className="w-8 h-8 rounded-full flex items-center justify-center text-gray-500 dark:text-gray-400 disabled:opacity-30"
                disabled={index >= items.length - 1}
                onClick={() => setIndex((i) => i + 1)}
                aria-label="下一条"
              >
                <FontAwesomeIcon icon={faChevronRight} />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
