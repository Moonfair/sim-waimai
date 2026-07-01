import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { restaurants, CATEGORIES } from '../data/restaurants';
import type { Category } from '../data/restaurants';
import RestaurantCard from '../components/RestaurantCard';
import { useCart } from '../context/CartContext';

export default function Home() {
  const [activeCategory, setActiveCategory] = useState<Category>('全部');
  const { totalItems, totalPrice, restaurant: cartRestaurant } = useCart();
  const navigate = useNavigate();

  const filtered = activeCategory === '全部'
    ? restaurants
    : restaurants.filter(r => r.category === activeCategory);

  return (
    <div className="app-container">
      {/* Header */}
      <div className="bg-orange-500 pt-10 pb-4 px-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-white text-2xl font-black tracking-tight">吃了嘛外卖</h1>
            <p className="text-orange-100 text-xs mt-0.5">节省外卖费和卡路里的假外卖APP</p>
          </div>
          <div className="text-3xl">🥡</div>
        </div>

        {/* Address bar */}
        <div className="bg-white/20 rounded-xl mt-3 px-3 py-2.5 flex items-center gap-2">
          <span className="text-white text-sm">📍</span>
          <span className="text-white text-sm font-medium">北京市朝阳区三里屯</span>
          <span className="text-white/60 text-xs ml-auto">预计25-40分钟</span>
        </div>

        {/* Search */}
        <div className="bg-white rounded-xl mt-2 px-3 py-2.5 flex items-center gap-2">
          <span className="text-gray-400">🔍</span>
          <span className="text-gray-400 text-sm">搜索餐厅或菜品</span>
        </div>
      </div>

      {/* Banner */}
      <div className="mx-4 mt-4 rounded-2xl overflow-hidden bg-gradient-to-r from-orange-400 to-amber-400 p-4 flex items-center justify-between">
        <div>
          <p className="text-white font-black text-lg leading-tight">点单不花钱</p>
          <p className="text-orange-100 text-sm mt-0.5">假外卖·真节省 · 0卡路里挑战</p>
        </div>
        <div className="text-5xl">🎉</div>
      </div>

      {/* Category Tabs */}
      <div className="mt-4 px-4">
        <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
          {CATEGORIES.map(cat => (
            <button
              key={cat}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                activeCategory === cat
                  ? 'bg-orange-500 text-white shadow-sm'
                  : 'bg-white text-gray-600 border border-gray-100'
              }`}
              onClick={() => setActiveCategory(cat)}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Restaurant List */}
      <div className="mt-3 px-4 pb-32">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-gray-800 font-bold text-base">
            {activeCategory === '全部' ? '附近餐厅' : activeCategory}
          </h2>
          <span className="text-gray-400 text-xs">{filtered.length}家</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {filtered.map(restaurant => (
            <RestaurantCard key={restaurant.id} restaurant={restaurant} />
          ))}
        </div>
      </div>

      {/* Bottom cart bar if items */}
      {totalItems > 0 && cartRestaurant && (
        <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[480px] px-4 pb-6">
          <div
            className="bg-gray-900 rounded-2xl flex items-center justify-between px-4 py-3 shadow-2xl cursor-pointer"
            onClick={() => navigate('/cart')}
          >
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="w-12 h-12 bg-orange-500 rounded-full flex items-center justify-center text-2xl">🛒</div>
                <div className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center">
                  <span className="text-white text-xs font-bold">{totalItems}</span>
                </div>
              </div>
              <div>
                <div className="text-white font-bold text-base">¥{totalPrice.toFixed(2)}</div>
                <div className="text-gray-400 text-xs">{cartRestaurant.name}</div>
              </div>
            </div>
            <button className="bg-orange-500 text-white px-5 py-2.5 rounded-xl font-bold text-sm">
              去结算
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
