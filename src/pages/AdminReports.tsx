import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AdminReportDto, ResolveReportsResultDto } from '@sim-waimai/shared';
import { useApi } from '../hooks/useApi';
import { api } from '../lib/api';
import ZoomableImage from '../components/ZoomableImage';

const TARGET_TYPE_LABEL = { restaurant: '店铺', menuItem: '菜品', review: '评价' } as const;

export default function AdminReports() {
  const navigate = useNavigate();
  const { data: reportList, loading, error, reload } = useApi<AdminReportDto[]>('/admin/reports');
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchSubmitting, setBatchSubmitting] = useState(false);

  const allSelected = (reportList ?? []).length > 0 && (reportList ?? []).every((r) => selectedIds.has(r.id));

  const flash = (text: string) => {
    setMessage(text);
    setTimeout(() => setMessage(null), 2500);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const resolve = async (reportIds: string[], decision: 'approved' | 'rejected') => {
    if (reportIds.length === 0) return;
    try {
      const result = await api.post<ResolveReportsResultDto>('/admin/reports/resolve', { reportIds, decision });
      flash(
        result.failed.length === 0
          ? `${decision === 'approved' ? '已通过' : '已驳回'} ${result.succeeded} 条 ✓`
          : `成功 ${result.succeeded} 条，失败 ${result.failed.length} 条`,
      );
      setSelectedIds((prev) => {
        const next = new Set(prev);
        reportIds.forEach((id) => next.delete(id));
        return next;
      });
      reload();
    } catch (err) {
      flash(err instanceof Error ? err.message : '操作失败，请稍后重试');
    }
  };

  const resolveOne = async (id: string, decision: 'approved' | 'rejected') => {
    setSubmittingId(id);
    try {
      await resolve([id], decision);
    } finally {
      setSubmittingId(null);
    }
  };

  const resolveBatch = async (decision: 'approved' | 'rejected') => {
    setBatchSubmitting(true);
    try {
      await resolve(Array.from(selectedIds), decision);
    } finally {
      setBatchSubmitting(false);
    }
  };

  return (
    <div className={`app-container min-h-screen bg-gray-50 dark:bg-gray-900 ${selectedIds.size > 0 ? 'pb-32' : 'pb-10'}`}>
      <div className="bg-white dark:bg-gray-800 px-4 pt-10 pb-4 border-b border-gray-100 dark:border-gray-700">
        <div className="flex items-center gap-3">
          <button
            className="w-8 h-8 flex items-center justify-center text-gray-600 dark:text-gray-300"
            onClick={() => navigate(-1)}
          >
            ←
          </button>
          <h1 className="text-gray-900 dark:text-gray-100 font-bold text-lg">举报管理</h1>
        </div>
        <p className="text-gray-400 dark:text-gray-500 text-xs mt-2">
          通过=举报成立，目标将按驳回处理；驳回=举报不成立，不做任何处理。处理后该条从此列表移除
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
        ) : (reportList ?? []).length === 0 ? (
          <div className="py-16 text-center text-gray-400 dark:text-gray-500">
            <div className="text-5xl mb-3">🚩</div>
            <p className="text-sm">暂无举报</p>
          </div>
        ) : (
          <>
            <label className="flex items-center gap-2 mt-4 px-1 text-sm text-gray-600 dark:text-gray-300">
              <input
                type="checkbox"
                className="w-4 h-4 accent-orange-500"
                checked={allSelected}
                onChange={() =>
                  setSelectedIds(allSelected ? new Set() : new Set(reportList!.map((r) => r.id)))
                }
              />
              全选
              {selectedIds.size > 0 && <span className="text-xs text-orange-500">已选 {selectedIds.size} 条</span>}
            </label>
            <div className="space-y-3 mt-3">
              {reportList!.map((r) => {
                const busy = submittingId === r.id;
                return (
                  <div key={r.id} className="bg-white dark:bg-gray-800 rounded-2xl p-4">
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        className="w-4 h-4 mt-0.5 accent-orange-500 flex-shrink-0"
                        checked={selectedIds.has(r.id)}
                        onChange={() => toggleSelect(r.id)}
                      />
                      {r.image ? (
                        <ZoomableImage
                          src={r.image}
                          alt={r.name}
                          className="w-12 h-12 rounded-xl object-cover flex-shrink-0"
                        />
                      ) : (
                        <div className="w-12 h-12 rounded-xl bg-orange-50 dark:bg-orange-500/10 flex items-center justify-center text-2xl flex-shrink-0">
                          {r.emoji}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-gray-900 dark:text-gray-100 text-sm truncate">
                            {r.name}
                          </span>
                          <span className="text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 bg-orange-50 dark:bg-orange-500/10 text-orange-500">
                            {TARGET_TYPE_LABEL[r.targetType]}
                          </span>
                        </div>
                        <p className="text-gray-400 dark:text-gray-500 text-xs mt-1">
                          {r.targetType !== 'restaurant' && `${r.restaurantName} · `}
                          {r.category}
                        </p>
                        {r.description && (
                          <p className="text-gray-500 dark:text-gray-400 text-xs mt-1 line-clamp-2">{r.description}</p>
                        )}
                        {r.photos && r.photos.length > 0 && (
                          <div className="flex gap-1.5 mt-1.5 overflow-x-auto">
                            {r.photos.map((photo) => (
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
                          举报人：{r.reporterUsername} · {new Date(r.createdAt).toLocaleString('zh-CN')}
                        </p>
                        <p className="text-red-500 text-xs mt-1">举报原因：{r.reason}</p>
                      </div>
                    </div>

                    <div className="flex gap-2 mt-3">
                      <button
                        className="flex-1 border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 py-2.5 rounded-xl text-sm disabled:opacity-50"
                        disabled={busy}
                        onClick={() => resolveOne(r.id, 'rejected')}
                      >
                        {busy ? '提交中…' : '驳回'}
                      </button>
                      <button
                        className="flex-1 bg-green-500 text-white py-2.5 rounded-xl font-bold text-sm disabled:opacity-50"
                        disabled={busy}
                        onClick={() => resolveOne(r.id, 'approved')}
                      >
                        {busy ? '提交中…' : '通过'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {selectedIds.size > 0 && (
        <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[480px] bg-white dark:bg-gray-800 border-t border-gray-100 dark:border-gray-700 p-3">
          <div className="flex gap-2">
            <button
              className="flex-1 border border-red-200 dark:border-red-500/30 text-red-500 py-2.5 rounded-xl text-sm disabled:opacity-50"
              disabled={batchSubmitting}
              onClick={() => resolveBatch('rejected')}
            >
              {batchSubmitting ? '提交中…' : `批量驳回 ${selectedIds.size} 条`}
            </button>
            <button
              className="flex-1 bg-green-500 text-white py-2.5 rounded-xl font-bold text-sm disabled:opacity-50"
              disabled={batchSubmitting}
              onClick={() => resolveBatch('approved')}
            >
              {batchSubmitting ? '提交中…' : `批量通过 ${selectedIds.size} 条`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
