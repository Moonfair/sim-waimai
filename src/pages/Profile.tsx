import { type ReactNode, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faFlag,
  faTruckFast,
  faClipboardList,
  faHeart,
  faStore,
  faShieldHalved,
  faChartLine,
  faShop,
  faUserSlash,
  faClockRotateLeft,
  faSun,
  faMoon,
  faUser,
  faListCheck,
  faUserShield,
} from '@fortawesome/free-solid-svg-icons';
import BottomNav from '../components/BottomNav';
import ChangelogModal from '../components/ChangelogModal';
import UserStatsPanel from '../components/UserStatsPanel';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';

interface MenuRow {
  emoji: ReactNode;
  label: string;
  to: string;
}

const MENU_ROWS: MenuRow[] = [
  { emoji: <FontAwesomeIcon icon={faClipboardList} />, label: '我的订单', to: '/orders' },
  { emoji: <FontAwesomeIcon icon={faHeart} />, label: '我的收藏', to: '/favorites' },
  { emoji: <FontAwesomeIcon icon={faTruckFast} />, label: '骑手统计', to: '/rider-stats' },
  { emoji: <FontAwesomeIcon icon={faStore} />, label: '商家中心', to: '/merchant' },
];

export default function Profile() {
  const { user, loading, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [changelogOpen, setChangelogOpen] = useState(false);

  const handleLogout = async () => {
    await logout();
    navigate('/', { replace: true });
  };

  const goToLogin = () => navigate('/login?redirect=/profile');

  const joined = user ? new Date(user.createdAt).toLocaleDateString('zh-CN') : '';

  const menuRows: MenuRow[] = [
    ...MENU_ROWS,
    ...(user?.isAdmin
      ? [
          { emoji: <FontAwesomeIcon icon={faShieldHalved} />, label: '审核管理', to: '/admin/review' },
          { emoji: <FontAwesomeIcon icon={faChartLine} />, label: '网站统计', to: '/admin/stats' },
          { emoji: <FontAwesomeIcon icon={faShop} />, label: '店铺管理', to: '/admin/shops' },
          { emoji: <FontAwesomeIcon icon={faFlag} />, label: '举报管理', to: '/admin/reports' },
          { emoji: <FontAwesomeIcon icon={faUserSlash} />, label: '用户管理', to: '/admin/users' },
          { emoji: <FontAwesomeIcon icon={faListCheck} />, label: '操作日志', to: '/admin/audit-log' },
        ]
      : []),
    // 全站管理员 + 管理员指定的编辑者都能看到，普通用户不可见
    ...(user?.canManageChangelog
      ? [{ emoji: <FontAwesomeIcon icon={faClockRotateLeft} />, label: '更新日志管理', to: '/admin/changelog' }]
      : []),
    // 仅超级管理员可见：管理其他人的管理员/超管角色
    ...(user?.isSuperAdmin
      ? [{ emoji: <FontAwesomeIcon icon={faUserShield} />, label: '管理员管理', to: '/admin/admins' }]
      : []),
  ];

  return (
    <div className="app-container min-h-screen pb-24">
      {/* Header */}
      <div className="bg-orange-500 pt-10 pb-14 px-4 relative">
        <button
          className="absolute top-10 right-4 w-9 h-9 rounded-full bg-white/20 flex items-center justify-center text-base"
          onClick={toggleTheme}
          aria-label="切换深色模式"
        >
          <FontAwesomeIcon icon={theme === 'dark' ? faSun : faMoon} className="text-white" />
        </button>
        <div
          className={`flex items-center gap-4 mt-6 ${user || loading ? '' : 'cursor-pointer'}`}
          onClick={user || loading ? undefined : goToLogin}
        >
          <div className="w-16 h-16 bg-white/25 rounded-full flex items-center justify-center text-white text-2xl">
            <FontAwesomeIcon icon={faUser} />
          </div>
          {user ? (
            <div>
              <h1 className="text-white text-xl font-black">{user.username}</h1>
              <p className="text-orange-100 text-xs mt-0.5">{joined} 加入 · 省钱小能手</p>
            </div>
          ) : (
            <div>
              <h1 className="text-white text-xl font-black">{loading ? '加载中…' : '请先登录'}</h1>
              {!loading && <p className="text-orange-100 text-xs mt-0.5">点击登录，解锁订单/收藏/开店</p>}
            </div>
          )}
        </div>
      </div>

      {/* Stats dashboard */}
      {user && (
        <div className="px-4 mt-4 lg:max-w-2xl lg:mx-auto">
          <UserStatsPanel />
        </div>
      )}

      {/* Menu */}
      <div className="px-4 mt-4 lg:max-w-2xl lg:mx-auto">
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm divide-y divide-gray-50 dark:divide-gray-700">
          {menuRows.map((row) => (
            <button
              key={row.to}
              className="w-full flex items-center gap-3 px-4 py-4 text-left"
              onClick={() => navigate(user ? row.to : `/login?redirect=${encodeURIComponent(row.to)}`)}
            >
              <span className="text-xl">{row.emoji}</span>
              <span className="flex-1 text-sm font-medium text-gray-800 dark:text-gray-100">{row.label}</span>
              <span className="text-gray-300 dark:text-gray-600">›</span>
            </button>
          ))}
        </div>

        {user ? (
          <button
            className="w-full mt-4 bg-white dark:bg-gray-800 text-red-500 py-3.5 rounded-2xl font-medium text-sm shadow-sm"
            onClick={handleLogout}
          >
            退出登录
          </button>
        ) : (
          !loading && (
            <button
              className="w-full mt-4 bg-orange-500 text-white py-3.5 rounded-2xl font-bold text-sm shadow-sm"
              onClick={goToLogin}
            >
              登录 / 注册
            </button>
          )
        )}

        <button
          type="button"
          className="block w-full text-center mt-6 text-orange-500 text-xs font-medium"
          onClick={() => setChangelogOpen(true)}
        >
          更新日志
        </button>
      </div>

      {changelogOpen && <ChangelogModal onClose={() => setChangelogOpen(false)} />}

      <BottomNav />
    </div>
  );
}
