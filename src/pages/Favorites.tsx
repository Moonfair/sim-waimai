import { useNavigate } from 'react-router-dom';
import type { RestaurantSummary } from '@sim-waimai/shared';
import RestaurantCard from '../components/RestaurantCard';
import { useApi } from '../hooks/useApi';

export default function Favorites() {
  const navigate = useNavigate();
  const { data: restaurants, loading, error } = useApi<RestaurantSummary[]>('/favorites');

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
          <h1 className="text-gray-900 dark:text-gray-100 font-bold text-lg">我的收藏</h1>
        </div>
      </div>

      <div className="px-4 pb-10">
        {loading ? (
          <div className="grid grid-cols-2 gap-3 mt-4">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="bg-white dark:bg-gray-800 rounded-xl h-56 animate-pulse" />
            ))}
          </div>
        ) : error ? (
          <div className="text-center py-16 text-gray-400 dark:text-gray-500">
            <div className="text-4xl mb-2">😵</div>
            <p className="text-sm">{error}</p>
          </div>
        ) : !restaurants || restaurants.length === 0 ? (
          <div className="text-center py-20 text-gray-400 dark:text-gray-500">
            <div className="text-5xl mb-3">🤍</div>
            <p className="text-sm">还没有收藏的餐厅</p>
            <button className="mt-4 text-orange-500 font-medium" onClick={() => navigate('/')}>
              去逛逛
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 mt-4">
            {restaurants.map((r) => (
              <RestaurantCard key={r.id} restaurant={r} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
