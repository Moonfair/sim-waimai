import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { RiderStatsDto } from '@sim-waimai/shared';
import { useApi } from '../hooks/useApi';
import PosterShareSheet from '../components/PosterShareSheet';
import { homeUrl } from '../lib/share';

export default function RiderStats() {
  const navigate = useNavigate();
  const { data: stats, loading, error } = useApi<RiderStatsDto>('/rider-hall/stats/me');
  const [posterOpen, setPosterOpen] = useState(false);

  return (
    <div className="app-container min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 px-4 pt-10 pb-4 border-b border-gray-100 dark:border-gray-700">
        <div className="flex items-center gap-3">
          <button
            className="w-8 h-8 flex items-center justify-center text-gray-600 dark:text-gray-300"
            onClick={() => navigate(-1)}
          >
            ←
          </button>
          <h1 className="text-gray-900 dark:text-gray-100 font-bold text-lg">骑手统计</h1>
        </div>
      </div>

      <div className="px-4 pb-10 mt-4">
        {loading ? (
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-4 space-y-3">
            <div className="grid grid-cols-2 gap-2">
              {Array.from({ length: 2 }, (_, i) => (
                <div key={i} className="h-16 bg-gray-50 dark:bg-gray-700 rounded-xl animate-pulse" />
              ))}
            </div>
            <div className="h-12 bg-gray-50 dark:bg-gray-700 rounded-xl animate-pulse" />
          </div>
        ) : error || !stats ? (
          <div className="text-center py-16 text-gray-400 dark:text-gray-500">
            <div className="text-4xl mb-2">😵</div>
            <p className="text-sm">{error ?? '加载失败'}</p>
          </div>
        ) : stats.completedCount === 0 ? (
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-6 text-center">
            <div className="text-4xl mb-2">🛵</div>
            <p className="text-gray-800 dark:text-gray-100 font-medium text-sm">还没有派送记录</p>
            <p className="text-gray-400 dark:text-gray-500 text-xs mt-1">
              下次抢单大厅有单出现时，点右下角气泡试试手速
            </p>
          </div>
        ) : (
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-bold text-gray-900 dark:text-gray-100 text-sm">骑手概况</h2>
              <button
                className="text-gray-400 dark:text-gray-500 text-base"
                onClick={() => setPosterOpen(true)}
                aria-label="分享战绩"
              >
                🔗
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="bg-orange-50 dark:bg-orange-500/10 rounded-xl py-3 text-center">
                <div className="text-orange-500 font-black text-lg">{stats.completedCount}</div>
                <div className="text-orange-400 text-[11px] mt-0.5">已派送订单</div>
              </div>
              <div className="bg-amber-50 dark:bg-amber-500/10 rounded-xl py-3 text-center">
                <div className="text-amber-600 dark:text-amber-500 font-black text-lg">
                  ¥{stats.totalEarned.toFixed(0)}
                </div>
                <div className="text-amber-500 text-[11px] mt-0.5">累计获得配送费</div>
              </div>
            </div>

            <div className="mt-3 flex items-center gap-2.5 bg-gray-50 dark:bg-gray-900 rounded-xl px-3 py-3">
              <span className="text-lg">🏅</span>
              <div className="flex-1 min-w-0">
                <p className="text-gray-800 dark:text-gray-100 text-sm font-bold">{stats.tier}</p>
                {stats.nextTierThreshold !== null && (
                  <p className="text-gray-400 dark:text-gray-500 text-[11px] mt-0.5">
                    还差 {stats.nextTierThreshold - stats.completedCount} 单升级到下一称号
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {posterOpen && stats && (
        <PosterShareSheet
          payload={{
            type: 'riderStats',
            data: {
              completedCount: stats.completedCount,
              totalEarned: stats.totalEarned,
              tier: stats.tier,
            },
          }}
          linkUrl={homeUrl()}
          onClose={() => setPosterOpen(false)}
        />
      )}
    </div>
  );
}
