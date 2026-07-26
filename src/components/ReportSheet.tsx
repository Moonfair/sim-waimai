import { useState } from 'react';
import type { CreateReportRequestDto } from '@sim-waimai/shared';
import { api } from '../lib/api';

type ReportTarget =
  | { targetType: 'restaurant'; restaurantId: string }
  | { targetType: 'menuItem'; restaurantId: string; itemId: string }
  | { targetType: 'review'; reviewId: string };

interface Props {
  target: ReportTarget;
  onClose: () => void;
  onSubmitted: (message: string) => void;
}

const TITLE_BY_TARGET_TYPE: Record<ReportTarget['targetType'], string> = {
  restaurant: '举报店铺',
  menuItem: '举报商品',
  review: '举报评价',
};

export default function ReportSheet({ target, onClose, onSubmitted }: Props) {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    const trimmed = reason.trim();
    if (!trimmed) {
      setError('请填写举报原因');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await api.post('/reports', { ...target, reason: trimmed } as CreateReportRequestDto);
      onSubmitted('举报已提交，感谢反馈');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '提交失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/40" onClick={onClose} />
      <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[480px] z-50 bg-white dark:bg-gray-800 rounded-t-2xl flex flex-col">
        <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-gray-50 dark:border-gray-700">
          <span className="font-bold text-gray-900 dark:text-gray-100 text-sm">
            {TITLE_BY_TARGET_TYPE[target.targetType]}
          </span>
          <button
            className="w-7 h-7 flex items-center justify-center text-gray-400 dark:text-gray-500 text-lg"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="px-4 py-3">
          <textarea
            className="w-full border border-gray-100 dark:border-gray-700 dark:bg-gray-900 rounded-lg p-2.5 text-sm text-gray-700 dark:text-gray-200 resize-none outline-none focus:border-orange-300"
            rows={3}
            placeholder="请输入举报原因"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            autoFocus
          />
          {error && <p className="text-red-500 text-xs mt-1.5">{error}</p>}
        </div>

        <div className="px-4 pb-8 pt-1">
          <button
            className="w-full bg-orange-500 text-white py-3 rounded-2xl font-black active:scale-95 transition-transform disabled:opacity-50"
            disabled={submitting}
            onClick={handleSubmit}
          >
            {submitting ? '提交中…' : '提交举报'}
          </button>
        </div>
      </div>
    </>
  );
}
