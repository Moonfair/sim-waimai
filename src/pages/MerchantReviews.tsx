import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { MerchantRestaurantDto, MerchantReviewDto, Page } from '@sim-waimai/shared';
import ZoomableImage from '../components/ZoomableImage';
import { useApi } from '../hooks/useApi';
import { api } from '../lib/api';

export default function MerchantReviews() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: shop, reload: reloadShop } = useApi<MerchantRestaurantDto>(
    id ? `/merchant/restaurants/${id}` : null,
  );
  const [items, setItems] = useState<MerchantReviewDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  /** 点了「隐藏」等待二次确认的评价 id */
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const loadPage = useCallback(
    async (cursor: string | null) => {
      const qs = cursor ? `?limit=10&cursor=${encodeURIComponent(cursor)}` : '?limit=10';
      const page = await api.get<Page<MerchantReviewDto>>(
        `/merchant/restaurants/${id}/reviews${qs}`,
      );
      setItems((prev) => (cursor ? [...prev, ...page.items] : page.items));
      setNextCursor(page.nextCursor);
    },
    [id],
  );

  useEffect(() => {
    loadPage(null)
      .catch((err) => setError(err instanceof Error ? err.message : '加载失败'))
      .finally(() => setLoading(false));
  }, [loadPage]);

  const handleLoadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      await loadPage(nextCursor);
    } finally {
      setLoadingMore(false);
    }
  };

  const handleToggleHidden = async (review: MerchantReviewDto, hidden: boolean) => {
    setBusyId(review.id);
    try {
      const updated = await api.patch<MerchantReviewDto>(
        `/merchant/restaurants/${id}/reviews/${review.id}`,
        { hidden },
      );
      setItems((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      setConfirmId(null);
      reloadShop(); // 评分/条数以后端为准
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
      setTimeout(() => setError(null), 2500);
    } finally {
      setBusyId(null);
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
          <div className="flex-1 min-w-0">
            <h1 className="text-gray-900 dark:text-gray-100 font-bold text-lg">评价管理</h1>
            {shop && (
              <p className="text-xs text-gray-400 dark:text-gray-500 truncate">
                {shop.emoji} {shop.name} · ⭐ {shop.rating}（{shop.ratingCount}条）
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="px-4 mt-4">
        <div className="bg-white dark:bg-gray-800 rounded-2xl p-4">
          {error && (
            <div className="mb-3 bg-red-50 dark:bg-red-500/10 text-red-500 text-xs rounded-xl px-3 py-2">
              {error}
            </div>
          )}
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }, (_, i) => (
                <div key={i} className="bg-gray-50 dark:bg-gray-700 rounded-xl h-16 animate-pulse" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <p className="text-gray-300 dark:text-gray-600 text-sm text-center py-6">
              还没有收到评价
            </p>
          ) : (
            <div className="space-y-4">
              {items.map((review) => (
                <div
                  key={review.id}
                  className={`border-b border-gray-50 dark:border-gray-700 pb-3 last:border-0 ${
                    review.hidden ? 'opacity-50' : ''
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-gray-800 dark:text-gray-200 text-sm font-medium truncate">
                        {review.username}
                      </span>
                      {review.hidden && (
                        <span className="text-xs text-gray-400 bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded-full flex-shrink-0">
                          已隐藏
                        </span>
                      )}
                    </div>
                    <span className="text-gray-300 dark:text-gray-600 text-xs flex-shrink-0">
                      {new Date(review.createdAt).toLocaleDateString('zh-CN')}
                    </span>
                  </div>
                  <div className="text-yellow-400 text-xs mt-0.5">
                    {'★'.repeat(review.rating)}
                    <span className="text-gray-200 dark:text-gray-600">{'★'.repeat(5 - review.rating)}</span>
                  </div>
                  {review.content && (
                    <p className="text-gray-600 dark:text-gray-300 text-sm mt-1">{review.content}</p>
                  )}
                  {review.photos.length > 0 && (
                    <div className="flex gap-2 mt-2 overflow-x-auto">
                      {review.photos.map((photo) => (
                        <ZoomableImage
                          key={photo}
                          src={photo}
                          alt="评价图片"
                          className="w-16 h-16 rounded-lg object-cover flex-shrink-0"
                        />
                      ))}
                    </div>
                  )}
                  <div className="flex justify-end gap-3 mt-2">
                    {review.hidden ? (
                      <button
                        className="text-xs text-green-500 px-2 py-1 disabled:opacity-50"
                        disabled={busyId === review.id}
                        onClick={() => handleToggleHidden(review, false)}
                      >
                        {busyId === review.id ? '恢复中…' : '恢复展示'}
                      </button>
                    ) : confirmId === review.id ? (
                      <>
                        <button
                          className="text-xs text-gray-400 px-2 py-1"
                          onClick={() => setConfirmId(null)}
                        >
                          取消
                        </button>
                        <button
                          className="text-xs text-red-400 px-2 py-1 disabled:opacity-50"
                          disabled={busyId === review.id}
                          onClick={() => handleToggleHidden(review, true)}
                        >
                          {busyId === review.id ? '隐藏中…' : '确认隐藏'}
                        </button>
                      </>
                    ) : (
                      <button
                        className="text-xs text-red-400 px-2 py-1"
                        onClick={() => setConfirmId(review.id)}
                      >
                        隐藏
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {nextCursor && (
                <button
                  className="w-full py-2 text-sm text-gray-500 dark:text-gray-400"
                  onClick={handleLoadMore}
                  disabled={loadingMore}
                >
                  {loadingMore ? '加载中…' : '加载更多评价'}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
