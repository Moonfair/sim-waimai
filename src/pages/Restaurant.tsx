import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getRestaurantById } from '../data/restaurants';
import MenuItemComponent from '../components/MenuItem';
import CartBar from '../components/CartBar';

export default function Restaurant() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const restaurant = id ? getRestaurantById(id) : undefined;
  const [activeMenuCat, setActiveMenuCat] = useState(restaurant?.menuCategories[0] ?? '');

  if (!restaurant) {
    return (
      <div className="app-container flex items-center justify-center h-screen">
        <div className="text-center text-gray-400">
          <div className="text-5xl mb-3">🍽️</div>
          <p>餐厅不存在</p>
          <button className="mt-4 text-orange-500" onClick={() => navigate('/')}>返回首页</button>
        </div>
      </div>
    );
  }

  const filteredMenu = restaurant.menu.filter(item => item.menuCategory === activeMenuCat);

  return (
    <div className="app-container">
      {/* Header */}
      <div
        className="h-48 flex flex-col items-center justify-center relative"
        style={{ background: `linear-gradient(135deg, ${restaurant.bgColor}ee, ${restaurant.bgColor}88)` }}
      >
        <button
          className="absolute top-10 left-4 w-9 h-9 bg-black/20 backdrop-blur-sm rounded-full flex items-center justify-center text-white"
          onClick={() => navigate(-1)}
        >
          ←
        </button>
        <div className="text-6xl drop-shadow-lg">{restaurant.emoji}</div>
        <h1 className="text-white font-black text-2xl mt-2 drop-shadow">{restaurant.name}</h1>
        <div className="flex items-center gap-3 mt-1">
          <span className="text-white/90 text-sm">⭐ {restaurant.rating}</span>
          <span className="text-white/60 text-xs">|</span>
          <span className="text-white/90 text-sm">配送费¥{restaurant.deliveryFee}</span>
          <span className="text-white/60 text-xs">|</span>
          <span className="text-white/90 text-sm">{restaurant.deliveryTime}分钟</span>
        </div>
      </div>

      {/* Tags */}
      <div className="bg-white px-4 py-2 flex gap-2 overflow-x-auto border-b border-gray-100">
        {restaurant.tags.map(tag => (
          <span key={tag} className="flex-shrink-0 text-xs px-2 py-1 bg-orange-50 text-orange-500 rounded-full border border-orange-100">
            {tag}
          </span>
        ))}
      </div>

      {/* Menu area */}
      <div className="flex bg-white" style={{ minHeight: 'calc(100vh - 280px)' }}>
        {/* Left category nav */}
        <div className="w-20 flex-shrink-0 bg-gray-50 border-r border-gray-100">
          {restaurant.menuCategories.map(cat => (
            <button
              key={cat}
              className={`w-full py-4 text-center text-xs font-medium transition-colors border-l-2 ${
                activeMenuCat === cat
                  ? 'border-orange-500 bg-white text-orange-500'
                  : 'border-transparent text-gray-500'
              }`}
              onClick={() => setActiveMenuCat(cat)}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Right menu items */}
        <div className="flex-1 px-3 pb-40">
          <h3 className="text-gray-500 text-xs font-medium pt-3 pb-1">{activeMenuCat}</h3>
          {filteredMenu.length === 0 ? (
            <p className="text-gray-300 text-sm text-center py-8">暂无菜品</p>
          ) : (
            filteredMenu.map(item => (
              <MenuItemComponent key={item.id} item={item} restaurant={restaurant} />
            ))
          )}
        </div>
      </div>

      <CartBar deliveryFee={restaurant.deliveryFee} />
    </div>
  );
}
