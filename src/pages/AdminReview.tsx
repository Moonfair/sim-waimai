import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { ModerationItemDto, ReviewStatus } from '@sim-waimai/shared';
import { useApi } from '../hooks/useApi';
import { api } from '../lib/api';
import ZoomableImage from '../components/ZoomableImage';
import { AI_VERDICT_BADGE, STATUS_BADGE } from '../lib/reviewBadges';

const STATUS_TABS: { value: ReviewStatus; label: string }[] = [
  { value: 'pending', label: '待审核' },
  { value: 'approved', label: '已通过' },
  { value: 'rejected', label: '已驳回' },
];

function reviewPath(item: ModerationItemDto): string {
  if (item.targetType === 'review') return `/admin/reviews/${item.reviewId}/review`;
  return item.targetType === 'restaurant'
    ? `/admin/restaurants/${item.restaurantId}/review`
    : `/admin/restaurants/${item.restaurantId}/items/${item.itemId}/review`;
}

function detailPath(item: ModerationItemDto): string {
  if (item.targetType === 'review') return `/admin/review/user-review/${item.reviewId}`;
  return item.targetType === 'restaurant'
    ? `/admin/review/restaurant/${item.restaurantId}`
    : `/admin/review/item/${item.restaurantId}/${item.itemId}`;
}

const TARGET_TYPE_LABEL = { restaurant: '店铺', menuItem: '菜品', review: '评价' } as const;

function itemKey(item: ModerationItemDto): string {
  return `${item.targetType}:${item.restaurantId}:${item.itemId ?? item.reviewId ?? ''}`;
}

export default function AdminReview() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const statusParam = searchParams.get('status');
  const status: ReviewStatus = STATUS_TABS.some((t) => t.value === statusParam)
    ? (statusParam as ReviewStatus)
    : 'pending';
  const { data: items, loading, error, reload } = useApi<ModerationItemDto[]>(
    `/admin/moderation?status=${status}`,
  );
  const [submittingKey, setSubmittingKey] = useState<string | null>(null);
  const [rejectingKey, setRejectingKey] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const flash = (text: string) => {
    setMessage(text);
    setTimeout(() => setMessage(null), 2500);
  };

  const review = async (item: ModerationItemDto, decision: 'approved' | 'rejected', reason?: string) => {
    setSubmittingKey(itemKey(item));
    try {
      await api.post(reviewPath(item), { decision, ...(reason ? { reason } : {}) });
      flash(decision === 'approved' ? '已通过 ✓' : '已驳回 ✓');
      setRejectingKey(null);
      setRejectReason('');
      reload();
    } catch (err) {
      flash(err instanceof Error ? err.message : '操作失败，请稍后重试');
    } finally {
      setSubmittingKey(null);
    }
  };

  return (
    <div className="app-container min-h-screen bg-gray-50 dark:bg-gray-900 pb-10">
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 px-4 pt-10 pb-4 border-b border-gray-100 dark:border-gray-700">
        <div className="flex items-center gap-3">
          <button
            className="w-8 h-8 flex items-center justify-center text-gray-600 dark:text-gray-300"
            onClick={() => navigate(-1)}
          >
            ←
          </button>
          <h1 className="text-gray-900 dark:text-gray-100 font-bold text-lg">审核管理</h1>
        </div>
        {/* Status filter */}
        <div className="flex gap-2 mt-3">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.value}
              className={`text-xs px-3 py-1.5 rounded-full font-medium ${
                status === tab.value
                  ? 'bg-orange-500 text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
              }`}
              onClick={() => {
                setSearchParams({ status: tab.value }, { replace: true });
                setRejectingKey(null);
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {message && (
        <p className="text-center text-xs text-orange-500 py-2 bg-orange-50 dark:bg-orange-500/10">{message}</p>
      )}

      <div className="px-4">
        {loading ? (
          <div className="space-y-3 mt-4">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="bg-white dark:bg-gray-800 rounded-2xl h-24 animate-pulse" />
            ))}
          </div>
        ) : error ? (
          <p className="text-center text-sm text-gray-400 dark:text-gray-500 py-10">{error}</p>
        ) : (items ?? []).length === 0 ? (
          <div className="py-16 text-center text-gray-400 dark:text-gray-500">
            <div className="text-5xl mb-3">🛡️</div>
            <p className="text-sm">
              {status === 'pending' ? '暂无待审核内容' : `暂无${STATUS_BADGE[status].label}的内容`}
            </p>
          </div>
        ) : (
          <div className="space-y-3 mt-4">
            {items!.map((item) => {
              const key = itemKey(item);
              const badge = STATUS_BADGE[item.reviewStatus];
              const busy = submittingKey === key;
              return (
                <div key={key} className="bg-white dark:bg-gray-800 rounded-2xl p-4">
                  <div className="flex items-start gap-3">
                    {item.image ? (
                      <ZoomableImage
                        src={item.image}
                        alt={item.name}
                        className="w-12 h-12 rounded-xl object-cover flex-shrink-0"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-xl bg-orange-50 dark:bg-orange-500/10 flex items-center justify-center text-2xl flex-shrink-0">
                        {item.emoji}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-gray-900 dark:text-gray-100 text-sm truncate">
                          {item.name}
                        </span>
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 bg-orange-50 dark:bg-orange-500/10 text-orange-500">
                          {TARGET_TYPE_LABEL[item.targetType]}
                        </span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${badge.className}`}>
                          {badge.label}
                        </span>
                      </div>
                      <p className="text-gray-400 dark:text-gray-500 text-xs mt-1">
                        {item.targetType !== 'restaurant' && `${item.restaurantName} · `}
                        {item.category}
                        {item.tags?.length ? ` · ${item.tags.join(' / ')}` : ''}
                      </p>
                      {item.description && (
                        <p className="text-gray-500 dark:text-gray-400 text-xs mt-1 line-clamp-2">{item.description}</p>
                      )}
                      {item.photos && item.photos.length > 0 && (
                        <div className="flex gap-1.5 mt-1.5 overflow-x-auto">
                          {item.photos.map((photo) => (
                            <ZoomableImage
                              key={photo}
                              src={photo}
                              alt="评价图片"
                              className="w-12 h-12 object-cover rounded-lg flex-shrink-0"
                            />
                          ))}
                        </div>
                      )}
                      <p className="text-gray-400 dark:text-gray-500 text-xs mt-1">
                        发布者：{item.ownerUsername ?? '平台'}
                        {item.reviewedBy && ` · 审核人：${item.reviewedBy === 'ai' ? 'AI' : item.reviewedBy}`}
                      </p>
                      {item.reviewStatus === 'rejected' && item.rejectReason && (
                        <p className="text-red-500 text-xs mt-1">驳回原因：{item.rejectReason}</p>
                      )}
                      {item.aiVerdict && (
                        <span
                          className={`mt-1.5 inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${AI_VERDICT_BADGE[item.aiVerdict].className}`}
                        >
                          🤖 {AI_VERDICT_BADGE[item.aiVerdict].label}
                          {item.aiConfidence != null && ` · ${Math.round(item.aiConfidence * 100)}%`}
                        </span>
                      )}
                      <button
                        type="button"
                        className="block mt-1.5 text-xs text-orange-500"
                        onClick={() => navigate(detailPath(item))}
                      >
                        查看详情 ›
                      </button>
                    </div>
                  </div>

                  {rejectingKey === key ? (
                    <div className="mt-3 space-y-2">
                      <input
                        className="w-full px-3 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-red-400 text-sm"
                        placeholder="填写驳回原因（将展示给发布者）"
                        value={rejectReason}
                        onChange={(e) => setRejectReason(e.target.value)}
                        autoFocus
                      />
                      <div className="flex gap-2">
                        <button
                          className="flex-1 border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 py-2.5 rounded-xl text-sm"
                          onClick={() => {
                            setRejectingKey(null);
                            setRejectReason('');
                          }}
                        >
                          取消
                        </button>
                        <button
                          className="flex-1 bg-red-500 text-white py-2.5 rounded-xl font-bold text-sm disabled:opacity-50"
                          disabled={busy || !rejectReason.trim()}
                          onClick={() => review(item, 'rejected', rejectReason.trim())}
                        >
                          {busy ? '提交中…' : '确认驳回'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-2 mt-3">
                      {item.reviewStatus !== 'rejected' && (
                        <button
                          className="flex-1 border border-red-200 dark:border-red-500/30 text-red-500 py-2.5 rounded-xl text-sm disabled:opacity-50"
                          disabled={busy}
                          onClick={() => {
                            setRejectingKey(key);
                            setRejectReason('');
                          }}
                        >
                          驳回
                        </button>
                      )}
                      {item.reviewStatus !== 'approved' && (
                        <button
                          className="flex-1 bg-green-500 text-white py-2.5 rounded-xl font-bold text-sm disabled:opacity-50"
                          disabled={busy}
                          onClick={() => review(item, 'approved')}
                        >
                          {busy ? '提交中…' : '通过'}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
