import { NavLink } from 'react-router-dom';

interface Tab {
  to: string;
  label: string;
  icon: string;
}

const TABS: Tab[] = [
  { to: '/', label: '首页', icon: '🏠' },
  { to: '/orders', label: '订单', icon: '📋' },
  { to: '/profile', label: '我的', icon: '👤' },
];

/** Fixed bottom tab bar shown on the three root pages (Home/Orders/Profile). */
export default function BottomNav() {
  return (
    <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[480px] h-16 bg-white dark:bg-gray-800 border-t border-gray-100 dark:border-gray-700 flex z-30">
      {TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.to === '/'}
          className={({ isActive }) =>
            `flex-1 flex flex-col items-center justify-center gap-0.5 text-xs font-medium transition-colors ${
              isActive ? 'text-orange-500' : 'text-gray-400 dark:text-gray-500'
            }`
          }
        >
          <span className="text-xl leading-none">{tab.icon}</span>
          <span>{tab.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
