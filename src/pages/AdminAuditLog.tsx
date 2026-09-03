import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChevronLeft } from '@fortawesome/free-solid-svg-icons';
import type { AdminAuditAction, AdminAuditLogListDto, AdminAuditTargetType } from '@sim-waimai/shared';
import { useApi } from '../hooks/useApi';
import { useDebounce } from '../hooks/useDebounce';

const PAGE_SIZE = 50;

const ACTION_LABEL: Record<AdminAuditAction, string> = {
  'moderation.review': '内容审核',
  'shop.priority_change': '店铺优先级调整',
  'user.ban': '用户封禁',
  'report.resolve': '举报处理',
  'changelog.create': '公告创建',
  'changelog.update': '公告更新',
  'changelog.delete': '公告删除',
  'changelog_editor.grant': '授予公告编辑者',
  'changelog_editor.revoke': '撤销公告编辑者',
  'admin_role.grant': '授予管理员角色',
  'admin_role.revoke': '撤销管理员角色',
};

const TARGET_TYPE_LABEL: Record<AdminAuditTargetType, string> = {
  restaurant: '店铺',
  menuItem: '商品',
  review: '评价',
  user: '用户',
  report: '举报',
  changelogEntry: '公告',
  changelogEditor: '公告编辑者',
};

const inputClass =
  'px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-orange-400 text-sm';

export default function AdminAuditLog() {
  const navigate = useNavigate();
  const [actorInput, setActorInput] = useState('');
  const actor = useDebounce(actorInput.trim(), 300);
  const [action, setAction] = useState('');
  const [targetType, setTargetType] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);

  const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (actor) params.set('actor', actor);
  if (action) params.set('action', action);
  if (targetType) params.set('targetType', targetType);
  if (dateFrom) params.set('dateFrom', dateFrom);
  if (dateTo) params.set('dateTo', dateTo);

  const { data, loading, error } = useApi<AdminAuditLogListDto>(`/admin/audit-log?${params.toString()}`);
  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  useEffect(() => {
    setPage(1);
  }, [actor, action, targetType, dateFrom, dateTo]);

  return (
    <div className="app-container min-h-screen bg-gray-50 dark:bg-gray-900 pb-10">
      <div className="bg-white dark:bg-gray-800 px-4 pt-10 pb-4 border-b border-gray-100 dark:border-gray-700">
        <div className="flex items-center gap-3">
          <button
            className="w-8 h-8 flex items-center justify-center text-gray-600 dark:text-gray-300"
            onClick={() => navigate(-1)}
          >
            <FontAwesomeIcon icon={faChevronLeft} />
          </button>
          <h1 className="text-gray-900 dark:text-gray-100 font-bold text-lg">操作日志</h1>
        </div>
        <p className="text-gray-400 dark:text-gray-500 text-xs mt-2">谁在什么时候对什么做了什么，供协作排查问题用。</p>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <input
            className={inputClass}
            placeholder="按操作人筛选"
            value={actorInput}
            onChange={(e) => setActorInput(e.target.value)}
          />
          <select className={inputClass} value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="">全部操作类型</option>
            {Object.entries(ACTION_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <select className={inputClass} value={targetType} onChange={(e) => setTargetType(e.target.value)}>
            <option value="">全部目标类型</option>
            {Object.entries(TARGET_TYPE_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <div className="flex gap-1">
            <input
              className={`flex-1 ${inputClass}`}
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
            <input
              className={`flex-1 ${inputClass}`}
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="px-4">
        {loading ? (
          <div className="space-y-3 mt-4">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="bg-white dark:bg-gray-800 rounded-2xl h-16 animate-pulse" />
            ))}
          </div>
        ) : error ? (
          <p className="text-center text-sm text-gray-400 dark:text-gray-500 py-10">{error}</p>
        ) : items.length === 0 ? (
          <div className="py-16 text-center text-gray-400 dark:text-gray-500">
            <p className="text-sm">暂无记录</p>
          </div>
        ) : (
          <div className="bg-white dark:bg-gray-800 rounded-2xl mt-4 divide-y divide-gray-50 dark:divide-gray-700">
            {items.map((entry) => (
              <div key={entry.id} className="px-4 py-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{entry.actorUsername}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium text-orange-500 bg-orange-50 dark:bg-orange-500/10">
                    {ACTION_LABEL[entry.action]}
                  </span>
                  {entry.targetType && (
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium text-gray-500 bg-gray-100 dark:bg-gray-700 dark:text-gray-300">
                      {TARGET_TYPE_LABEL[entry.targetType]}
                      {entry.targetLabel ? ` · ${entry.targetLabel}` : ''}
                    </span>
                  )}
                  <span className="text-gray-400 dark:text-gray-500 text-xs ml-auto">
                    {new Date(entry.createdAt).toLocaleString('zh-CN')}
                  </span>
                </div>
                {entry.detail && (
                  <p className="mt-1 text-xs text-gray-400 dark:text-gray-500 truncate">
                    {JSON.stringify(entry.detail)}
                  </p>
                )}
              </div>
            ))}
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
