import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChevronLeft } from '@fortawesome/free-solid-svg-icons';
import type { AdminRole, AdminRoleListDto, AdminRoleUserDto } from '@sim-waimai/shared';
import { useApi } from '../hooks/useApi';
import { api } from '../lib/api';

const inputClass =
  'px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-orange-400 text-sm';

const ROLE_LABEL: Record<AdminRole, string> = { admin: '管理员', superadmin: '超级管理员' };

export default function AdminAdmins() {
  const navigate = useNavigate();
  const { data, loading, error, reload } = useApi<AdminRoleListDto>('/admin/admins');
  const items = data?.items ?? [];

  const [username, setUsername] = useState('');
  const [role, setRole] = useState<AdminRole>('admin');
  const [busy, setBusy] = useState(false);
  const [busyUsername, setBusyUsername] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const flash = (text: string) => {
    setMessage(text);
    setTimeout(() => setMessage(null), 2500);
  };

  const grant = async () => {
    if (!username.trim()) return;
    setBusy(true);
    try {
      await api.post<AdminRoleUserDto>('/admin/admins', { username: username.trim(), role });
      setUsername('');
      flash('已授权 ✓');
      reload();
    } catch (err) {
      flash(err instanceof Error ? err.message : '授权失败，请稍后重试');
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (name: string) => {
    setBusyUsername(name);
    try {
      await api.del(`/admin/admins/${encodeURIComponent(name)}`);
      flash('已移除 ✓');
      reload();
    } catch (err) {
      flash(err instanceof Error ? err.message : '移除失败，请稍后重试');
    } finally {
      setBusyUsername(null);
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
            <FontAwesomeIcon icon={faChevronLeft} />
          </button>
          <h1 className="text-gray-900 dark:text-gray-100 font-bold text-lg">管理员管理</h1>
        </div>
        <p className="text-gray-400 dark:text-gray-500 text-xs mt-2">
          普通管理员拥有全部日常运营权限（审核/店铺/用户/举报/公告）；超级管理员额外可以在这里授予或撤销其他人的角色。
        </p>
      </div>

      {message && (
        <p className="text-center text-xs text-orange-500 py-2 bg-orange-50 dark:bg-orange-500/10">{message}</p>
      )}

      <div className="px-4">
        <div className="bg-white dark:bg-gray-800 rounded-2xl p-4 mt-4">
          <div className="flex gap-2">
            <input
              className={`flex-1 ${inputClass}`}
              placeholder="输入用户名"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
            <select
              className={inputClass}
              value={role}
              onChange={(e) => setRole(e.target.value as AdminRole)}
            >
              <option value="admin">管理员</option>
              <option value="superadmin">超级管理员</option>
            </select>
            <button
              type="button"
              className="px-4 rounded-xl bg-orange-500 text-white text-sm font-medium disabled:opacity-50"
              disabled={busy || !username.trim()}
              onClick={grant}
            >
              授权
            </button>
          </div>
        </div>

        {loading ? (
          <div className="space-y-3 mt-4">
            {Array.from({ length: 2 }, (_, i) => (
              <div key={i} className="bg-white dark:bg-gray-800 rounded-2xl h-14 animate-pulse" />
            ))}
          </div>
        ) : error ? (
          <p className="text-center text-sm text-gray-400 dark:text-gray-500 py-10">{error}</p>
        ) : (
          <div className="bg-white dark:bg-gray-800 rounded-2xl mt-4 divide-y divide-gray-50 dark:divide-gray-700">
            {items.map((u) => {
              const busy = busyUsername === u.username;
              return (
                <div key={u.id} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{u.username}</span>
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          u.role === 'superadmin'
                            ? 'text-orange-500 bg-orange-50 dark:bg-orange-500/10'
                            : 'text-gray-500 bg-gray-100 dark:bg-gray-700 dark:text-gray-300'
                        }`}
                      >
                        {ROLE_LABEL[u.role]}
                      </span>
                    </div>
                    <p className="text-gray-400 dark:text-gray-500 text-xs mt-0.5">
                      注册于 {new Date(u.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="text-red-400 text-xs disabled:opacity-40"
                    disabled={busy}
                    onClick={() => revoke(u.username)}
                  >
                    移除
                  </button>
                </div>
              );
            })}
            {items.length === 0 && (
              <p className="px-4 py-6 text-center text-xs text-gray-400 dark:text-gray-500">暂无被授权的管理员</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
