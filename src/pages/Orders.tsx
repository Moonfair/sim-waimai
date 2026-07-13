import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { OrderSummaryDto, Page } from '@sim-waimai/shared';
import BottomNav from '../components/BottomNav';
import { api } from '../lib/api';

const STATUS_LABEL: Record<OrderSummaryDto['status'], { text: string; className: string }> = {
  pending: { text: '待配送', className: 'text-orange-500 bg-orange-50 dark:bg-orange-500/10' },
  delivering: { text: '配送中', className: 'text-blue-500 bg-blue-50 dark:bg-blue-500/10' },
  completed: { text: '已完成', className: 'text-green-600 bg-green-50 dark:bg-green-500/10' },
};

export default function Orders() {
  const navigate = useNavigate();
  const [items, setItems] = useState<OrderSummaryDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPage = useCallback(async (cursor: string | null) => {
    const qs = cursor ? `?limit=20&cursor=${encodeURIComponent(cursor)}` : '?limit=20';
    const page = await api.get<Page<OrderSummaryDto>>(`/orders${qs}`);
    setItems((prev) => (cursor ? [...prev, ...page.items] : page.items));
    setNextCursor(page.nextCursor);
  }, []);

  useEffect(() => {
    loadPage(null)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : '加载失败'))
      .finally(() => setLoading(false));
  }, [loadPage]);

  const handleLoadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      await loadPage(nextCursor);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div className="app-container min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 px-4 pt-10 pb-4 border-b border-gray-100 dark:border-gray-700 sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <button
            className="w-8 h-8 flex items-center justify-center text-gray-600 dark:text-gray-300"
            onClick={() => navigate(-1)}
          >
            ←
          </button>
          <h1 className="text-gray-900 dark:text-gray-100 font-bold text-lg">我的订单</h1>
        </div>
      </div>

      <div className="px-4 pb-24">
        {loading ? (
          <div className="space-y-3 mt-4">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="bg-white dark:bg-gray-800 rounded-2xl h-24 animate-pulse" />
            ))}
          </div>
        ) : error ? (
          <div className="text-center py-16 text-gray-400 dark:text-gray-500">
            <div className="text-4xl mb-2">😵</div>
            <p className="text-sm">{error}</p>
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-20 text-gray-400 dark:text-gray-500">
            <div className="text-5xl mb-3">📋</div>
            <p className="text-sm">还没有订单，去点一单吧</p>
            <button className="mt-4 text-orange-500 font-medium" onClick={() => navigate('/')}>
              去点餐
            </button>
          </div>
        ) : (
          <>
            <div className="space-y-3 mt-4">
              {items.map((order) => {
                const status = STATUS_LABEL[order.status];
                return (
                  <div
                    key={order.id}
                    className="bg-white dark:bg-gray-800 rounded-2xl p-4 cursor-pointer active:scale-[0.98] transition-transform"
                    onClick={() => navigate(`/orders/${order.id}`)}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl flex-shrink-0"
                        style={{ background: `${order.restaurantBgColor}22` }}
                      >
                        {order.restaurantEmoji}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-gray-900 dark:text-gray-100 text-sm truncate">
                            {order.restaurantName}
                          </span>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${status.className}`}>
                            {status.text}
                          </span>
                        </div>
                        <p className="text-gray-400 dark:text-gray-500 text-xs mt-0.5 truncate">
                          {order.firstItemName}
                          {order.itemCount > 1 ? ` 等${order.itemCount}件` : ''}
                        </p>
                        <div className="flex items-center justify-between mt-1">
                          <span className="text-gray-300 dark:text-gray-600 text-xs">
                            {new Date(order.createdAt).toLocaleString('zh-CN', {
                              month: 'numeric',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                          <span className="text-gray-900 dark:text-gray-100 font-bold text-sm">
                            ¥{order.total.toFixed(2)}
                          </span>
                        </div>
                      </div>
                    </div>
                    {order.status === 'completed' && !order.hasReview && (
                      <div className="mt-3 pt-3 border-t border-gray-50 dark:border-gray-700 flex justify-end">
                        <span className="text-orange-500 text-xs font-medium">待评价 ›</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {nextCursor && (
              <button
                className="w-full mt-4 py-3 text-sm text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-800 rounded-2xl"
                onClick={handleLoadMore}
                disabled={loadingMore}
              >
                {loadingMore ? '加载中…' : '加载更多'}
              </button>
            )}
            {!nextCursor && items.length > 5 && (
              <p className="text-center text-gray-300 dark:text-gray-600 text-xs mt-4">没有更多订单了</p>
            )}
          </>
        )}
      </div>

      <BottomNav />
    </div>
  );
}
