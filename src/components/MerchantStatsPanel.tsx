import type { MerchantStatsDto } from '@sim-waimai/shared';

export default function MerchantStatsPanel({
  stats,
  loading,
}: {
  stats: MerchantStatsDto | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-4">
        <div className="grid grid-cols-2 gap-2">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="h-16 bg-gray-50 dark:bg-gray-700 rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (!stats) return null;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-4">
      <h2 className="font-bold text-gray-900 dark:text-gray-100 text-sm mb-3">经营概况</h2>
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-orange-50 dark:bg-orange-500/10 rounded-xl py-3 text-center">
          <div className="text-orange-500 font-black text-lg">¥{stats.totalRevenue.toFixed(2)}</div>
          <div className="text-orange-400 text-[11px] mt-0.5">总营收</div>
        </div>
        <div className="bg-amber-50 dark:bg-amber-500/10 rounded-xl py-3 text-center">
          <div className="text-amber-600 dark:text-amber-500 font-black text-lg">{stats.totalSales}</div>
          <div className="text-amber-500 text-[11px] mt-0.5">总销量</div>
        </div>
        <div className="bg-green-50 dark:bg-green-500/10 rounded-xl py-3 text-center">
          <div className="text-green-600 dark:text-green-500 font-black text-lg">¥{stats.todayRevenue.toFixed(2)}</div>
          <div className="text-green-500 text-[11px] mt-0.5">今日营收</div>
        </div>
        <div className="bg-blue-50 dark:bg-blue-500/10 rounded-xl py-3 text-center">
          <div className="text-blue-600 dark:text-blue-500 font-black text-lg">{stats.todaySales}</div>
          <div className="text-blue-500 text-[11px] mt-0.5">今日销量</div>
        </div>
      </div>
    </div>
  );
}
