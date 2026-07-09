import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';

interface MenuRow {
  emoji: string;
  label: string;
  to: string;
}

const MENU_ROWS: MenuRow[] = [
  { emoji: '📋', label: '我的订单', to: '/orders' },
  { emoji: '❤️', label: '我的收藏', to: '/favorites' },
  { emoji: '🏪', label: '商家中心', to: '/merchant' },
];

export default function Profile() {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/', { replace: true });
  };

  const joined = user ? new Date(user.createdAt).toLocaleDateString('zh-CN') : '';

  return (
    <div className="app-container min-h-screen pb-10">
      {/* Header */}
      <div className="bg-orange-500 pt-10 pb-14 px-4 relative">
        <button
          className="absolute top-10 left-4 w-9 h-9 bg-white/20 rounded-full flex items-center justify-center text-white"
          onClick={() => navigate('/')}
          aria-label="返回首页"
        >
          ←
        </button>
        <button
          className="absolute top-10 right-4 w-9 h-9 rounded-full bg-white/20 flex items-center justify-center text-base"
          onClick={toggleTheme}
          aria-label="切换深色模式"
        >
          {theme === 'dark' ? '☀️' : '🌙'}
        </button>
        <div className="flex items-center gap-4 mt-6">
          <div className="w-16 h-16 bg-white/25 rounded-full flex items-center justify-center text-4xl">
            👤
          </div>
          <div>
            <h1 className="text-white text-xl font-black">{user?.username}</h1>
            <p className="text-orange-100 text-xs mt-0.5">{joined} 加入 · 省钱小能手</p>
          </div>
        </div>
      </div>

      {/* Menu */}
      <div className="px-4 -mt-6">
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm divide-y divide-gray-50 dark:divide-gray-700">
          {MENU_ROWS.map((row) => (
            <button
              key={row.to}
              className="w-full flex items-center gap-3 px-4 py-4 text-left"
              onClick={() => navigate(row.to)}
            >
              <span className="text-xl">{row.emoji}</span>
              <span className="flex-1 text-sm font-medium text-gray-800 dark:text-gray-100">{row.label}</span>
              <span className="text-gray-300 dark:text-gray-600">›</span>
            </button>
          ))}
        </div>

        <button
          className="w-full mt-4 bg-white dark:bg-gray-800 text-red-500 py-3.5 rounded-2xl font-medium text-sm shadow-sm"
          onClick={handleLogout}
        >
          退出登录
        </button>
      </div>
    </div>
  );
}
