import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChevronLeft, faPen, faTrash } from '@fortawesome/free-solid-svg-icons';
import type {
  ChangelogEditorListDto,
  ChangelogEntryDto,
  ChangelogListDto,
} from '@sim-waimai/shared';
import { useApi } from '../hooks/useApi';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';

/** ISO datetime -> "YYYY-MM-DD" for an `<input type="date">` value. */
function toDateInputValue(iso: string): string {
  return iso.slice(0, 10);
}

const inputClass =
  'px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-orange-400 text-sm';

export default function AdminChangelog() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data, loading, error, reload } = useApi<ChangelogListDto>('/changelog');
  const items = data?.items ?? [];

  const [newTitle, setNewTitle] = useState('');
  const [newVersion, setNewVersion] = useState('');
  const [newDate, setNewDate] = useState('');
  const [newContent, setNewContent] = useState('');
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editVersion, setEditVersion] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editContent, setEditContent] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const flash = (text: string) => {
    setMessage(text);
    setTimeout(() => setMessage(null), 2500);
  };

  const create = async () => {
    if (!newContent.trim()) return;
    setCreating(true);
    try {
      await api.post<ChangelogEntryDto>('/admin/changelog', {
        title: newTitle,
        version: newVersion,
        date: newDate,
        content: newContent.trim(),
      });
      setNewTitle('');
      setNewVersion('');
      setNewDate('');
      setNewContent('');
      flash('已发布 ✓');
      reload();
    } catch (err) {
      flash(err instanceof Error ? err.message : '发布失败，请稍后重试');
    } finally {
      setCreating(false);
    }
  };

  const startEdit = (entry: ChangelogEntryDto) => {
    setEditingId(entry.id);
    setEditTitle(entry.title);
    setEditVersion(String(entry.version));
    setEditDate(toDateInputValue(entry.createdAt));
    setEditContent(entry.content);
  };

  const saveEdit = async (id: string) => {
    if (!editContent.trim()) return;
    setBusyId(id);
    try {
      await api.patch<ChangelogEntryDto>(`/admin/changelog/${id}`, {
        title: editTitle,
        version: editVersion,
        date: editDate,
        content: editContent.trim(),
      });
      setEditingId(null);
      flash('已更新 ✓');
      reload();
    } catch (err) {
      flash(err instanceof Error ? err.message : '更新失败，请稍后重试');
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (id: string) => {
    setBusyId(id);
    try {
      await api.del(`/admin/changelog/${id}`);
      flash('已删除 ✓');
      reload();
    } catch (err) {
      flash(err instanceof Error ? err.message : '删除失败，请稍后重试');
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
            <FontAwesomeIcon icon={faChevronLeft} />
          </button>
          <h1 className="text-gray-900 dark:text-gray-100 font-bold text-lg">更新日志管理</h1>
        </div>
        <p className="text-gray-400 dark:text-gray-500 text-xs mt-2">
          标题/日期/版本号可手动填写，留空时分别取默认标题「更新公告」、当前日期、当前最大版本号+1；内容为必填项
        </p>
      </div>

      {message && (
        <p className="text-center text-xs text-orange-500 py-2 bg-orange-50 dark:bg-orange-500/10">{message}</p>
      )}

      <div className="px-4">
        <div className="bg-white dark:bg-gray-800 rounded-2xl p-4 mt-4">
          <input
            className={`w-full ${inputClass}`}
            placeholder="标题（留空则用「更新公告」）"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
          />
          <div className="flex gap-2 mt-2">
            <input
              className={`flex-1 ${inputClass}`}
              type="number"
              min={1}
              placeholder="版本号（留空自动递增）"
              value={newVersion}
              onChange={(e) => setNewVersion(e.target.value)}
            />
            <input
              className={`flex-1 ${inputClass}`}
              type="date"
              placeholder="日期（留空用今天）"
              value={newDate}
              onChange={(e) => setNewDate(e.target.value)}
            />
          </div>
          <textarea
            className={`w-full h-24 mt-2 resize-none ${inputClass}`}
            placeholder="填写本次更新的公告内容…"
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
          />
          <button
            type="button"
            className="w-full mt-3 bg-orange-500 text-white py-2.5 rounded-xl font-bold text-sm disabled:opacity-50"
            disabled={creating || !newContent.trim()}
            onClick={create}
          >
            {creating ? '发布中…' : '发布新公告'}
          </button>
        </div>

        {loading ? (
          <div className="space-y-3 mt-4">
            {Array.from({ length: 2 }, (_, i) => (
              <div key={i} className="bg-white dark:bg-gray-800 rounded-2xl h-20 animate-pulse" />
            ))}
          </div>
        ) : error ? (
          <p className="text-center text-sm text-gray-400 dark:text-gray-500 py-10">{error}</p>
        ) : items.length === 0 ? (
          <div className="py-16 text-center text-gray-400 dark:text-gray-500">
            <p className="text-sm">暂无更新日志</p>
          </div>
        ) : (
          <div className="space-y-3 mt-4">
            {items.map((entry) => {
              const busy = busyId === entry.id;
              return (
                <div key={entry.id} className="bg-white dark:bg-gray-800 rounded-2xl p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-baseline gap-2">
                      <span className="text-orange-500 font-bold text-sm">v{entry.version}</span>
                      <span className="text-gray-400 dark:text-gray-500 text-xs">
                        {new Date(entry.createdAt).toLocaleDateString('zh-CN')} · {entry.createdBy}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        className="text-gray-400 dark:text-gray-500 disabled:opacity-40"
                        disabled={busy}
                        onClick={() => startEdit(entry)}
                        aria-label="编辑"
                      >
                        <FontAwesomeIcon icon={faPen} />
                      </button>
                      <button
                        type="button"
                        className="text-red-400 disabled:opacity-40"
                        disabled={busy}
                        onClick={() => remove(entry.id)}
                        aria-label="删除"
                      >
                        <FontAwesomeIcon icon={faTrash} />
                      </button>
                    </div>
                  </div>

                  {editingId === entry.id ? (
                    <div className="mt-3">
                      <input
                        className={`w-full ${inputClass}`}
                        placeholder="标题（留空保留原标题）"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                      />
                      <div className="flex gap-2 mt-2">
                        <input
                          className={`flex-1 ${inputClass}`}
                          type="number"
                          min={1}
                          placeholder="版本号（留空保留原版本号）"
                          value={editVersion}
                          onChange={(e) => setEditVersion(e.target.value)}
                        />
                        <input
                          className={`flex-1 ${inputClass}`}
                          type="date"
                          placeholder="日期（留空保留原日期）"
                          value={editDate}
                          onChange={(e) => setEditDate(e.target.value)}
                        />
                      </div>
                      <textarea
                        className={`w-full h-20 mt-2 resize-none ${inputClass}`}
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                      />
                      <div className="flex gap-2 mt-2">
                        <button
                          type="button"
                          className="flex-1 py-2 rounded-xl text-xs font-medium border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400"
                          onClick={() => setEditingId(null)}
                        >
                          取消
                        </button>
                        <button
                          type="button"
                          className="flex-1 py-2 rounded-xl text-xs font-medium bg-orange-500 text-white disabled:opacity-50"
                          disabled={busy || !editContent.trim()}
                          onClick={() => saveEdit(entry.id)}
                        >
                          保存
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <h3 className="mt-2 font-bold text-sm text-gray-900 dark:text-gray-100">{entry.title}</h3>
                      <p className="mt-1 text-sm text-gray-700 dark:text-gray-200 whitespace-pre-line">
                        {entry.content}
                      </p>
                    </>
                  )}
                  {entry.updatedAt && (
                    <p className="mt-1 text-gray-300 dark:text-gray-600 text-xs">
                      {new Date(entry.updatedAt).toLocaleDateString('zh-CN')} 由 {entry.updatedBy} 编辑
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {user?.isAdmin && <ChangelogEditorManager />}
      </div>
    </div>
  );
}

function ChangelogEditorManager() {
  const { data, loading, reload } = useApi<ChangelogEditorListDto>('/admin/changelog-editors');
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const flash = (text: string) => {
    setMessage(text);
    setTimeout(() => setMessage(null), 2500);
  };

  const add = async () => {
    if (!username.trim()) return;
    setBusy(true);
    try {
      await api.post('/admin/changelog-editors', { username: username.trim() });
      setUsername('');
      reload();
    } catch (err) {
      flash(err instanceof Error ? err.message : '添加失败，请稍后重试');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (name: string) => {
    setBusy(true);
    try {
      await api.del(`/admin/changelog-editors/${encodeURIComponent(name)}`);
      reload();
    } catch (err) {
      flash(err instanceof Error ? err.message : '移除失败，请稍后重试');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl p-4 mt-4">
      <h2 className="text-gray-900 dark:text-gray-100 font-bold text-sm">更新日志编辑者</h2>
      <p className="text-gray-400 dark:text-gray-500 text-xs mt-1">
        授权指定用户名管理更新日志，无需成为全站管理员
      </p>
      {message && <p className="text-orange-500 text-xs mt-2">{message}</p>}

      <div className="flex gap-2 mt-3">
        <input
          className="flex-1 px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-orange-400 text-sm"
          placeholder="输入用户名"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <button
          type="button"
          className="px-4 rounded-xl bg-orange-500 text-white text-sm font-medium disabled:opacity-50"
          disabled={busy || !username.trim()}
          onClick={add}
        >
          添加
        </button>
      </div>

      {!loading && (
        <ul className="mt-3 divide-y divide-gray-50 dark:divide-gray-700">
          {(data?.items ?? []).map((editor) => (
            <li key={editor.username} className="flex items-center justify-between py-2">
              <span className="text-sm text-gray-700 dark:text-gray-200">{editor.username}</span>
              <button
                type="button"
                className="text-red-400 text-xs disabled:opacity-40"
                disabled={busy}
                onClick={() => remove(editor.username)}
              >
                移除
              </button>
            </li>
          ))}
          {(data?.items ?? []).length === 0 && (
            <li className="py-2 text-xs text-gray-400 dark:text-gray-500">暂无被授权的编辑者</li>
          )}
        </ul>
      )}
    </div>
  );
}
