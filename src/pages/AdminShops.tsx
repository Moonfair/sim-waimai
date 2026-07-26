import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AdminShopDto } from '@sim-waimai/shared';
import { SHOP_PRIORITY_LEVELS } from '@sim-waimai/shared';
import { useApi } from '../hooks/useApi';
import { api } from '../lib/api';
import { STATUS_BADGE } from '../lib/reviewBadges';

export default function AdminShops() {
  const navigate = useNavigate();
  const { data: shops, loading, error, reload } = useApi<AdminShopDto[]>('/admin/shops');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // Optimistic priority overrides, keyed by shop id; `shops` stays the source of truth for everything else.
  const [overrides, setOverrides] = useState<Record<string, number>>({});

  const list = shops?.map((s) => (s.id in overrides ? { ...s, recommendPriority: overrides[s.id]! } : s));

  const flash = (text: string) => {
    setMessage(text);
    setTimeout(() => setMessage(null), 2500);
  };

  const setPriority = async (shop: AdminShopDto, priority: number) => {
    if (shop.recommendPriority === priority) return;
    setBusyId(shop.id);
    try {
      const updated = await api.post<AdminShopDto>(`/admin/shops/${shop.id}/priority`, { priority });
      setOverrides((prev) => ({ ...prev, [shop.id]: updated.recommendPriority }));
      flash('已更新 ✓');
    } catch (err) {
      flash(err instanceof Error ? err.message : '操作失败，请稍后重试');
      reload();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="app-container min-h-screen bg-gray-50 dark:bg-gray-900 pb-10">
      <div className="bg-white dark:bg-gray-800 px-4 pt-10 pb-4 border-b border-gray-100 dark:border-gray-700">
        <div className="flex items-center gap-3">
          <button
            className="w-8 h-8 flex items-center justify-center text-gray-600 dark:text-gray-300"
            onClick={() => navigate(-1)}
          >
            ←
          </button>
          <h1 className="text-gray-900 dark:text-gray-100 font-bold text-lg">店铺管理</h1>
        </div>
        <p className="text-gray-400 dark:text-gray-500 text-xs mt-2">
          调整玩家自建店铺的推荐优先级，优先级越高越优先出现在首页推荐
        </p>
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
        ) : (list ?? []).length === 0 ? (
          <div className="py-16 text-center text-gray-400 dark:text-gray-500">
            <div className="text-5xl mb-3">🏬</div>
            <p className="text-sm">暂无玩家自建店铺</p>
          </div>
        ) : (
          <div className="space-y-3 mt-3">
            {list!.map((shop) => {
              const badge = STATUS_BADGE[shop.reviewStatus];
              const busy = busyId === shop.id;
              return (
                <div key={shop.id} className="bg-white dark:bg-gray-800 rounded-2xl p-4">
                  <div className="flex items-start gap-3">
                    <div
                      className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl flex-shrink-0"
                      style={{ backgroundColor: shop.bgColor }}
                    >
                      {shop.emoji}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-gray-900 dark:text-gray-100 text-sm truncate">
                          {shop.name}
                        </span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${badge.className}`}>
                          {badge.label}
                        </span>
                        {!shop.isActive && (
                          <span className="text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400">
                            已下架
                          </span>
                        )}
                      </div>
                      <p className="text-gray-400 dark:text-gray-500 text-xs mt-1">
                        店主：{shop.ownerUsername} · {shop.category}
                      </p>
                      <p className="text-gray-400 dark:text-gray-500 text-xs mt-1">
                        评分 {shop.rating.toFixed(1)} · 月销 {shop.monthlyOrders}
                      </p>
                    </div>
                  </div>

                  <div className="flex gap-2 mt-3">
                    {SHOP_PRIORITY_LEVELS.map((level) => (
                      <button
                        key={level.value}
                        type="button"
                        disabled={busy}
                        className={`flex-1 py-2 rounded-xl text-xs font-medium disabled:opacity-50 ${
                          shop.recommendPriority === level.value
                            ? 'bg-orange-500 text-white'
                            : 'border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400'
                        }`}
                        onClick={() => setPriority(shop, level.value)}
                      >
                        {level.label}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
