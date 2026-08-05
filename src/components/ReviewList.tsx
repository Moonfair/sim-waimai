import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faFlag } from '@fortawesome/free-solid-svg-icons';
import type { Page, ReviewDto } from '@sim-waimai/shared';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import { formatCount } from '../lib/displayStats';
import ReportSheet from './ReportSheet';
import ZoomableImage from './ZoomableImage';

interface Props {
  restaurantId: string;
  rating: number;
  /** 展示用的评论数(调用方已按首页卡片口径放大),不是数据库里的真实值。 */
  ratingCount: number;
}

export default function ReviewList({ restaurantId, rating, ratingCount }: Props) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<ReviewDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [reportingReviewId, setReportingReviewId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const flash = (text: string) => {
    setMessage(text);
    setTimeout(() => setMessage(null), 2500);
  };

  const handleReportClick = (reviewId: string) => {
    if (!user) {
      navigate(`/login?redirect=${encodeURIComponent(`/restaurant/${restaurantId}`)}`);
      return;
    }
    setReportingReviewId(reviewId);
  };

  const loadPage = useCallback(
    async (cursor: string | null) => {
      const qs = cursor ? `?limit=5&cursor=${encodeURIComponent(cursor)}` : '?limit=5';
      const page = await api.get<Page<ReviewDto>>(`/restaurants/${restaurantId}/reviews${qs}`);
      setItems((prev) => (cursor ? [...prev, ...page.items] : page.items));
      setNextCursor(page.nextCursor);
    },
    [restaurantId],
  );

  useEffect(() => {
    loadPage(null)
      .catch(() => {})
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

  return (
    <div className="bg-white dark:bg-gray-800 px-4 py-4 mt-2 pb-36">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-gray-900 dark:text-gray-100 font-bold text-base">用户评价</h3>
        <span className="text-sm">
          <span className="text-orange-500 font-bold">⭐ {rating}</span>
          <span className="text-gray-400 dark:text-gray-500 text-xs ml-1">({formatCount(ratingCount)}条)</span>
        </span>
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 2 }, (_, i) => (
            <div key={i} className="bg-gray-50 dark:bg-gray-700 rounded-xl h-16 animate-pulse" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="text-gray-300 dark:text-gray-600 text-sm text-center py-6">
          暂无评价，下单后来写第一条吧
        </p>
      ) : (
        <div className="space-y-4">
          {items.map((review) => (
            <div key={review.id} className="border-b border-gray-50 dark:border-gray-700 pb-3 last:border-0">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 min-w-0">
                  <span className="text-gray-800 dark:text-gray-200 text-sm font-medium truncate">
                    {review.username}
                  </span>
                  {/* 非 approved 的评价服务端只会返回给作者本人 */}
                  {review.reviewStatus === 'pending' && (
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 text-amber-600 bg-amber-50 dark:bg-amber-500/10">
                      审核中，仅自己可见
                    </span>
                  )}
                  {review.reviewStatus === 'rejected' && (
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 text-red-500 bg-red-50 dark:bg-red-500/10">
                      未通过
                    </span>
                  )}
                </span>
                <span className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-gray-300 dark:text-gray-600 text-xs">
                    {new Date(review.createdAt).toLocaleDateString('zh-CN')}
                  </span>
                  <button
                    className="text-xs text-gray-300 dark:text-gray-600"
                    onClick={() => handleReportClick(review.id)}
                    aria-label="举报评价"
                  >
                    <FontAwesomeIcon icon={faFlag} />
                  </button>
                </span>
              </div>
              {review.reviewStatus === 'rejected' && review.rejectReason && (
                <p className="text-red-500 text-xs mt-0.5">未通过原因：{review.rejectReason}</p>
              )}
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

      {message && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-gray-900/90 text-white text-xs px-4 py-2 rounded-full">
          {message}
        </div>
      )}

      {reportingReviewId && (
        <ReportSheet
          target={{ targetType: 'review', reviewId: reportingReviewId }}
          onClose={() => setReportingReviewId(null)}
          onSubmitted={flash}
        />
      )}
    </div>
  );
}
