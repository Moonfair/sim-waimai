import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AdminUserDto, BanUserResultDto } from '@sim-waimai/shared';
import { useApi } from '../hooks/useApi';
import { api } from '../lib/api';

export default function AdminUsers() {
  const navigate = useNavigate();
  const { data: users, loading, error, reload } = useApi<AdminUserDto[]>('/admin/users');
  const [banningId, setBanningId] = useState<string | null>(null);
  const [banReason, setBanReason] = useState('');
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const flash = (text: string) => {
    setMessage(text);
    setTimeout(() => setMessage(null), 2500);
  };

  const ban = async (user: AdminUserDto) => {
    setSubmittingId(user.id);
    try {
      const result = await api.post<BanUserResultDto>(`/admin/users/${user.id}/ban`, {
        ...(banReason.trim() ? { reason: banReason.trim() } : {}),
      });
      const { restaurants, menuItems, reviews } = result.rejectedCounts;
      flash(`已封禁 ✓ 驳回 ${restaurants} 个店铺 / ${menuItems} 个商品 / ${reviews} 条评价`);
      setBanningId(null);
      setBanReason('');
      reload();
    } catch (err) {
      flash(err instanceof Error ? err.message : '操作失败，请稍后重试');
    } finally {
      setSubmittingId(null);
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
          <h1 className="text-gray-900 dark:text-gray-100 font-bold text-lg">用户管理</h1>
        </div>
        <p className="text-gray-400 dark:text-gray-500 text-xs mt-2">
          封禁用户后，其名下历史店铺/商品/评价将批量驳回，之后提交的内容也会自动驳回
        </p>
      </div>

      {message && (
        <p className="text-center text-xs text-orange-500 py-2 bg-orange-50 dark:bg-orange-500/10">{message}</p>
      )}

      <div className="px-4">
        {loading ? (
          <div className="space-y-3 mt-4">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="bg-white dark:bg-gray-800 rounded-2xl h-20 animate-pulse" />
            ))}
          </div>
        ) : error ? (
          <p className="text-center text-sm text-gray-400 dark:text-gray-500 py-10">{error}</p>
        ) : (users ?? []).length === 0 ? (
          <div className="py-16 text-center text-gray-400 dark:text-gray-500">
            <div className="text-5xl mb-3">👤</div>
            <p className="text-sm">暂无用户</p>
          </div>
        ) : (
          <div className="space-y-3 mt-3">
            {users!.map((user) => {
              const busy = submittingId === user.id;
              return (
                <div key={user.id} className="bg-white dark:bg-gray-800 rounded-2xl p-4">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-gray-900 dark:text-gray-100 text-sm truncate">
                      {user.username}
                    </span>
                    {user.isBanned && (
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 text-red-500 bg-red-50 dark:bg-red-500/10">
                        已封禁
                      </span>
                    )}
                  </div>
                  <p className="text-gray-400 dark:text-gray-500 text-xs mt-1">
                    注册于 {new Date(user.createdAt).toLocaleDateString()}
                  </p>
                  {user.isBanned && (
                    <p className="text-gray-400 dark:text-gray-500 text-xs mt-1">
                      {user.bannedBy && `由 ${user.bannedBy} 封禁`}
                      {user.bannedReason && ` · 原因：${user.bannedReason}`}
                    </p>
                  )}

                  {!user.isBanned &&
                    (banningId === user.id ? (
                      <div className="mt-3 space-y-2">
                        <input
                          className="w-full px-3 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-red-400 text-sm"
                          placeholder="填写封禁原因（选填）"
                          value={banReason}
                          onChange={(e) => setBanReason(e.target.value)}
                          autoFocus
                        />
                        <div className="flex gap-2">
                          <button
                            className="flex-1 border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 py-2.5 rounded-xl text-sm"
                            onClick={() => {
                              setBanningId(null);
                              setBanReason('');
                            }}
                          >
                            取消
                          </button>
                          <button
                            className="flex-1 bg-red-500 text-white py-2.5 rounded-xl font-bold text-sm disabled:opacity-50"
                            disabled={busy}
                            onClick={() => ban(user)}
                          >
                            {busy ? '提交中…' : '确认封禁'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="mt-3 w-full border border-red-200 dark:border-red-500/30 text-red-500 py-2.5 rounded-xl text-sm"
                        onClick={() => {
                          setBanningId(user.id);
                          setBanReason('');
                        }}
                      >
                        封禁
                      </button>
                    ))}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
