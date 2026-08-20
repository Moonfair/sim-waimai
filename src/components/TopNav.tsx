import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';

interface NavItem {
  to: string;
  label: string;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: '首页' },
  { to: '/search', label: '搜索' },
  { to: '/orders', label: '订单' },
  { to: '/favorites', label: '收藏' },
  { to: '/merchant', label: '商家中心' },
  { to: '/rider-stats', label: '骑手统计' },
];

const ADMIN_NAV_ITEM: NavItem = { to: '/admin/review', label: '管理后台' };

/** Desktop-only top navigation bar (sticky, in normal document flow — see .app-container
 *  in index.css for the matching 1200px content width). Hidden below the `lg` breakpoint,
 *  where BottomNav takes over. Mounted once globally in App.tsx. */
export default function TopNav() {
  const { user } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();

  const items = user?.isAdmin ? [...NAV_ITEMS, ADMIN_NAV_ITEM] : NAV_ITEMS;

  return (
    <div className="hidden lg:flex sticky top-0 z-50 w-full bg-white dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700">
      <div className="w-full max-w-[1200px] mx-auto px-6 h-16 flex items-center justify-between gap-6">
        <button
          className="flex items-center gap-2 flex-shrink-0"
          onClick={() => navigate('/')}
        >
          <span className="text-2xl">🥡</span>
          <span className="text-gray-900 dark:text-gray-100 font-black text-lg tracking-tight">吃了嘛外卖</span>
        </button>

        <nav className="flex items-center gap-1">
          {items.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'text-orange-500 bg-orange-50 dark:bg-orange-500/10'
                    : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            className="w-9 h-9 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-base"
            onClick={toggleTheme}
            aria-label="切换深色模式"
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
          {user ? (
            <button
              className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
              onClick={() => navigate('/profile')}
            >
              <span className="w-7 h-7 rounded-full bg-orange-100 dark:bg-orange-500/20 flex items-center justify-center text-sm">
                👤
              </span>
              <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{user.username}</span>
            </button>
          ) : (
            <button
              className="px-4 py-2 rounded-lg bg-orange-500 text-white text-sm font-bold"
              onClick={() => navigate('/login')}
            >
              登录
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
