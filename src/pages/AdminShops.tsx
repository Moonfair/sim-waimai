import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AdminShopDto, AdminShopListDto } from '@sim-waimai/shared';
import { SHOP_PRIORITY_LEVELS } from '@sim-waimai/shared';
import { useApi } from '../hooks/useApi';
import { useDebounce } from '../hooks/useDebounce';
import { api } from '../lib/api';
import { STATUS_BADGE } from '../lib/reviewBadges';

const PAGE_SIZE = 50;

export default function AdminShops() {
  const navigate = useNavigate();
  const [queryInput, setQueryInput] = useState('');
  const query = useDebounce(queryInput.trim(), 300);
  const [page, setPage] = useState(1);
  const listParams = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (query) listParams.set('q', query);
  const { data, loading, error, reload } = useApi<AdminShopListDto>(`/admin/shops?${listParams.toString()}`);
  const shops = data?.items;
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // Optimistic priority overrides, keyed by shop id; `shops` stays the source of truth for everything else.
  const [overrides, setOverrides] = useState<Record<string, number>>({});

  useEffect(() => {
    setPage(1);
  }, [query]);

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
        <div className="mt-3">
          <input
            className="w-full px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-orange-400 text-sm"
            placeholder="搜索店铺名 / 店主用户名"
            value={queryInput}
            onChange={(e) => setQueryInput(e.target.value)}
          />
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
                        {shop.lowActivity && (
                          <span className="text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 bg-amber-100 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400">
                            低活跃（商品数≤10）
                          </span>
                        )}
                      </div>
                      <p className="text-gray-400 dark:text-gray-500 text-xs mt-1">
                        店主：{shop.ownerUsername} · {shop.category}
                      </p>
                      <p className="text-gray-400 dark:text-gray-500 text-xs mt-1">
                        评分 {shop.rating.toFixed(1)} · 月销 {shop.monthlyOrders}
                      </p>
                      {shop.lowActivity && (
                        <p className="text-amber-600 dark:text-amber-400 text-xs mt-1">
                          {shop.recommendPriority > 0
                            ? '商品数≤10，已设置优先级豁免低活跃限制，仍会参与推荐'
                            : '商品数≤10，不会进入首页推荐（设为"较高"或"置顶"可豁免）'}
                        </p>
                      )}
                      <button
                        type="button"
                        className="block mt-1.5 text-xs text-orange-500"
                        onClick={() => navigate(`/restaurant/${shop.id}`)}
                      >
                        查看详情 ›
                      </button>
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
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-3 mt-4 text-sm">
            <button
              type="button"
              className="px-3 py-1.5 rounded-full border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 disabled:opacity-40"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              上一页
            </button>
            <span className="text-gray-400 dark:text-gray-500 text-xs">
              第 {page} / {totalPages} 页 · 共 {total} 条
            </span>
            <button
              type="button"
              className="px-3 py-1.5 rounded-full border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 disabled:opacity-40"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              下一页
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
