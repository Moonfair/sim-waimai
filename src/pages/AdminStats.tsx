import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { SiteStatsDto, SiteStatsTopRestaurantDto } from '@sim-waimai/shared';
import { useApi } from '../hooks/useApi';

const TREND_RANGES = [7, 30] as const;
type TrendRange = (typeof TREND_RANGES)[number];

function barWidth(value: number, max: number): string {
  if (max <= 0) return '0%';
  return `${Math.max((value / max) * 100, value > 0 ? 2 : 0)}%`;
}

function formatDay(date: string): string {
  const [, m, d] = date.split('-');
  return `${m}/${d}`;
}

function KpiTile({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className={`${color} rounded-xl py-3 text-center`}>
      <div className="font-black text-lg">{value}</div>
      <div className="text-[11px] mt-0.5 opacity-70">{label}</div>
    </div>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-4">
      <h2 className="font-bold text-gray-900 dark:text-gray-100 text-sm mb-3">{title}</h2>
      {children}
    </div>
  );
}

function BarList({
  rows,
  formatValue,
}: {
  rows: { label: string; value: number }[];
  formatValue: (v: number) => string;
}) {
  if (rows.length === 0) {
    return <p className="text-center text-xs text-gray-400 dark:text-gray-500 py-4">暂无数据</p>;
  }
  const max = Math.max(...rows.map((r) => r.value), 0);
  return (
    <div className="space-y-1.5">
      {rows.map((row) => (
        <div key={row.label} className="flex items-center gap-2 text-xs">
          <span className="w-12 flex-shrink-0 text-gray-400 dark:text-gray-500">{row.label}</span>
          <div className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-full h-3 overflow-hidden">
            <div className="h-full bg-orange-400 rounded-full" style={{ width: barWidth(row.value, max) }} />
          </div>
          <span className="w-14 flex-shrink-0 text-right text-gray-600 dark:text-gray-300 font-medium">
            {formatValue(row.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

function TopRestaurantList({
  items,
  metric,
  formatMetric,
}: {
  items: SiteStatsTopRestaurantDto[];
  metric: (r: SiteStatsTopRestaurantDto) => number;
  formatMetric: (v: number) => string;
}) {
  const navigate = useNavigate();
  if (items.length === 0) {
    return <p className="text-center text-xs text-gray-400 dark:text-gray-500 py-4">暂无数据</p>;
  }
  return (
    <div className="space-y-2">
      {items.map((r, i) => (
        <div
          key={r.id}
          className="flex items-center gap-2.5 bg-gray-50 dark:bg-gray-900 rounded-xl px-3 py-2 cursor-pointer"
          onClick={() => navigate(`/restaurant/${r.id}`)}
        >
          <span className="w-4 text-center text-xs text-gray-400 dark:text-gray-500 flex-shrink-0">{i + 1}</span>
          <span className="text-lg">{r.emoji}</span>
          <div className="flex-1 min-w-0">
            <p className="text-gray-800 dark:text-gray-100 text-sm font-medium truncate">{r.name}</p>
            <p className="text-gray-400 dark:text-gray-500 text-[11px]">{r.category}</p>
          </div>
          <span className="text-orange-500 font-bold text-sm flex-shrink-0">{formatMetric(metric(r))}</span>
        </div>
      ))}
    </div>
  );
}

function StatsSkeleton() {
  return (
    <div className="space-y-3 mt-4">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="bg-white dark:bg-gray-800 rounded-2xl h-32 animate-pulse" />
      ))}
    </div>
  );
}

export default function AdminStats() {
  const navigate = useNavigate();
  const { data: stats, loading, error } = useApi<SiteStatsDto>('/admin/stats');
  const [trendRange, setTrendRange] = useState<TrendRange>(7);
  const [topBy, setTopBy] = useState<'orders' | 'gmv'>('orders');

  const trendSlice = useMemo(() => (stats ? stats.trend.slice(-trendRange) : []), [stats, trendRange]);

  const merchantReviewTotal = stats
    ? stats.merchants.byReviewStatus.pending + stats.merchants.byReviewStatus.approved + stats.merchants.byReviewStatus.rejected
    : 0;
  const reviewerTotal = stats ? stats.merchants.reviewerSplit.ai + stats.merchants.reviewerSplit.human : 0;

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
          <h1 className="text-gray-900 dark:text-gray-100 font-bold text-lg">网站统计</h1>
        </div>
      </div>

      <div className="px-4">
        {loading ? (
          <StatsSkeleton />
        ) : error || !stats ? (
          <p className="text-center text-sm text-gray-400 dark:text-gray-500 py-10">{error ?? '加载失败'}</p>
        ) : (
          <div className="space-y-3 mt-4 lg:space-y-0 lg:grid lg:grid-cols-2 lg:gap-3 lg:items-start">
            {/* 核心概览 */}
            <SectionCard title="核心概览">
              <div className="grid grid-cols-3 gap-2">
                <KpiTile label="累计用户数" value={String(stats.overview.totalUsers)} color="bg-orange-50 dark:bg-orange-500/10 text-orange-500" />
                <KpiTile label="累计订单数" value={String(stats.overview.totalOrders)} color="bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-500" />
                <KpiTile label="累计GMV" value={`¥${stats.overview.gmv.toFixed(0)}`} color="bg-red-50 dark:bg-red-500/10 text-red-500" />
                <KpiTile label="客单价" value={`¥${stats.overview.aov.toFixed(1)}`} color="bg-blue-50 dark:bg-blue-500/10 text-blue-500" />
                <KpiTile
                  label="订单完成率"
                  value={`${(stats.overview.completionRate * 100).toFixed(0)}%`}
                  color="bg-green-50 dark:bg-green-500/10 text-green-500"
                />
              </div>
            </SectionCard>

            {/* 今日统计 */}
            <SectionCard title="今日统计">
              <div className="grid grid-cols-3 gap-2">
                <KpiTile label="今日新增用户" value={String(stats.today.newUsers)} color="bg-orange-50 dark:bg-orange-500/10 text-orange-500" />
                <KpiTile label="今日新增订单" value={String(stats.today.newOrders)} color="bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-500" />
                <KpiTile label="今日GMV" value={`¥${stats.today.gmv.toFixed(0)}`} color="bg-red-50 dark:bg-red-500/10 text-red-500" />
              </div>
            </SectionCard>

            {/* 趋势图 */}
            <SectionCard title="趋势图">
              <div className="flex gap-2 mb-3">
                {TREND_RANGES.map((range) => (
                  <button
                    key={range}
                    className={`text-xs px-3 py-1.5 rounded-full font-medium ${
                      trendRange === range
                        ? 'bg-orange-500 text-white'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                    }`}
                    onClick={() => setTrendRange(range)}
                  >
                    近{range}天
                  </button>
                ))}
              </div>
              <div className="space-y-4">
                <div>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mb-1.5">每日订单量</p>
                  <BarList
                    rows={trendSlice.map((d) => ({ label: formatDay(d.date), value: d.orders }))}
                    formatValue={(v) => String(v)}
                  />
                </div>
                <div>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mb-1.5">每日GMV</p>
                  <BarList
                    rows={trendSlice.map((d) => ({ label: formatDay(d.date), value: d.gmv }))}
                    formatValue={(v) => `¥${v.toFixed(0)}`}
                  />
                </div>
                <div>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mb-1.5">每日新增用户</p>
                  <BarList
                    rows={trendSlice.map((d) => ({ label: formatDay(d.date), value: d.newUsers }))}
                    formatValue={(v) => String(v)}
                  />
                </div>
              </div>
            </SectionCard>

            {/* 商家概况 */}
            <SectionCard title="商家概况">
              <div className="grid grid-cols-1 gap-2 mb-4">
                <KpiTile label="商家总数" value={String(stats.merchants.total)} color="bg-orange-50 dark:bg-orange-500/10 text-orange-500" />
              </div>

              <p className="text-xs text-gray-400 dark:text-gray-500 mb-1.5">审核状态分布</p>
              <BarList
                rows={[
                  { label: '待审核', value: stats.merchants.byReviewStatus.pending },
                  { label: '已通过', value: stats.merchants.byReviewStatus.approved },
                  { label: '已驳回', value: stats.merchants.byReviewStatus.rejected },
                ]}
                formatValue={(v) => (merchantReviewTotal > 0 ? `${v} (${((v / merchantReviewTotal) * 100).toFixed(0)}%)` : String(v))}
              />

              <p className="text-xs text-gray-400 dark:text-gray-500 mb-1.5 mt-4">AI自动通过 / 人工复核</p>
              <BarList
                rows={[
                  { label: 'AI', value: stats.merchants.reviewerSplit.ai },
                  { label: '人工', value: stats.merchants.reviewerSplit.human },
                ]}
                formatValue={(v) => (reviewerTotal > 0 ? `${v} (${((v / reviewerTotal) * 100).toFixed(0)}%)` : String(v))}
              />

              <p className="text-xs text-gray-400 dark:text-gray-500 mb-1.5 mt-4">按分类分布</p>
              <BarList
                rows={stats.merchants.byCategory.map((c) => ({ label: c.category, value: c.count }))}
                formatValue={(v) => String(v)}
              />

              <div className="flex items-center justify-between mt-4 mb-1.5">
                <p className="text-xs text-gray-400 dark:text-gray-500">Top 10 商家</p>
                <div className="flex gap-1.5">
                  <button
                    className={`text-[11px] px-2.5 py-1 rounded-full font-medium ${
                      topBy === 'orders'
                        ? 'bg-orange-500 text-white'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                    }`}
                    onClick={() => setTopBy('orders')}
                  >
                    按订单量
                  </button>
                  <button
                    className={`text-[11px] px-2.5 py-1 rounded-full font-medium ${
                      topBy === 'gmv'
                        ? 'bg-orange-500 text-white'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                    }`}
                    onClick={() => setTopBy('gmv')}
                  >
                    按GMV
                  </button>
                </div>
              </div>
              {topBy === 'orders' ? (
                <TopRestaurantList
                  items={stats.merchants.topByOrders}
                  metric={(r) => r.orderCount}
                  formatMetric={(v) => `${v}单`}
                />
              ) : (
                <TopRestaurantList
                  items={stats.merchants.topByGmv}
                  metric={(r) => r.gmv}
                  formatMetric={(v) => `¥${v.toFixed(0)}`}
                />
              )}
            </SectionCard>
          </div>
        )}
      </div>
    </div>
  );
}
