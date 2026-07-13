import { useNavigate } from 'react-router-dom';
import type { UserStatsDto } from '@sim-waimai/shared';
import { useApi } from '../hooks/useApi';

export default function UserStatsPanel() {
  const navigate = useNavigate();
  const { data: stats, loading, error } = useApi<UserStatsDto>('/orders/stats');

  if (loading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-4 space-y-3">
        <div className="grid grid-cols-3 gap-2">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="h-16 bg-gray-50 dark:bg-gray-700 rounded-xl animate-pulse" />
          ))}
        </div>
        <div className="h-14 bg-gray-50 dark:bg-gray-700 rounded-xl animate-pulse" />
      </div>
    );
  }

  if (error || !stats) return null;

  if (stats.totalOrders === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-5 text-center">
        <div className="text-3xl mb-1">📊</div>
        <p className="text-gray-400 dark:text-gray-500 text-sm">还没有订单数据，去下第一单吧</p>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-4">
      <h2 className="font-bold text-gray-900 dark:text-gray-100 text-sm mb-3">生涯概况</h2>

      {/* Headline numbers */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-orange-50 dark:bg-orange-500/10 rounded-xl py-3 text-center">
          <div className="text-orange-500 font-black text-lg">{stats.totalOrders}</div>
          <div className="text-orange-400 text-[11px] mt-0.5">总点单数</div>
        </div>
        <div className="bg-amber-50 dark:bg-amber-500/10 rounded-xl py-3 text-center">
          <div className="text-amber-600 dark:text-amber-500 font-black text-lg">¥{stats.totalSaved.toFixed(0)}</div>
          <div className="text-amber-500 text-[11px] mt-0.5">省下的钱</div>
        </div>
        <div className="bg-red-50 dark:bg-red-500/10 rounded-xl py-3 text-center">
          <div className="text-red-500 font-black text-lg">{stats.totalCalories}</div>
          <div className="text-red-400 text-[11px] mt-0.5">省下的卡路里</div>
        </div>
      </div>

      {/* Highlights */}
      <div className="mt-3 space-y-2">
        {stats.topRestaurant && (
          <div
            className="flex items-center gap-2.5 bg-gray-50 dark:bg-gray-900 rounded-xl px-3 py-2.5 cursor-pointer"
            onClick={() => navigate(`/restaurant/${stats.topRestaurant!.id}`)}
          >
            <span className="text-lg">{stats.topRestaurant.emoji}</span>
            <div className="flex-1 min-w-0">
              <p className="text-gray-400 dark:text-gray-500 text-[11px]">最常点的商家</p>
              <p className="text-gray-800 dark:text-gray-100 text-sm font-medium truncate">
                {stats.topRestaurant.name}
                <span className="text-gray-400 dark:text-gray-500 font-normal ml-1">
                  · 点过{stats.topRestaurant.orderCount}次
                </span>
              </p>
            </div>
            <span className="text-gray-300 dark:text-gray-600">›</span>
          </div>
        )}

        {stats.topItem && (
          <div className="flex items-center gap-2.5 bg-gray-50 dark:bg-gray-900 rounded-xl px-3 py-2.5">
            <span className="text-lg">{stats.topItem.emoji}</span>
            <div className="flex-1 min-w-0">
              <p className="text-gray-400 dark:text-gray-500 text-[11px]">最常点的商品</p>
              <p className="text-gray-800 dark:text-gray-100 text-sm font-medium truncate">
                {stats.topItem.name}
                <span className="text-gray-400 dark:text-gray-500 font-normal ml-1">
                  · 共{stats.topItem.quantity}份
                </span>
              </p>
            </div>
          </div>
        )}

        {stats.biggestOrder && (
          <div
            className="flex items-center gap-2.5 bg-gray-50 dark:bg-gray-900 rounded-xl px-3 py-2.5 cursor-pointer"
            onClick={() => navigate(`/orders/${stats.biggestOrder!.id}`)}
          >
            <span className="text-lg">{stats.biggestOrder.restaurantEmoji}</span>
            <div className="flex-1 min-w-0">
              <p className="text-gray-400 dark:text-gray-500 text-[11px]">最大额的订单</p>
              <p className="text-gray-800 dark:text-gray-100 text-sm font-medium truncate">
                {stats.biggestOrder.restaurantName}
                <span className="text-orange-500 font-bold ml-1">¥{stats.biggestOrder.total.toFixed(2)}</span>
              </p>
            </div>
            <span className="text-gray-300 dark:text-gray-600">›</span>
          </div>
        )}
      </div>
    </div>
  );
}
