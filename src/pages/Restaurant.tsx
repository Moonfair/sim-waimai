import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { Restaurant as RestaurantData } from '@sim-waimai/shared';
import MenuItemComponent from '../components/MenuItem';
import CartBar from '../components/CartBar';
import ReviewList from '../components/ReviewList';
import { useAuth } from '../context/AuthContext';
import { useApi } from '../hooks/useApi';
import { api } from '../lib/api';
import { assetUrl } from '../lib/assetUrl';
import { copyRestaurantLink } from '../lib/share';

export default function Restaurant() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: restaurant, loading, error } = useApi<RestaurantData>(id ? `/restaurants/${id}` : null);
  const [activeMenuCat, setActiveMenuCat] = useState('');
  const [isFav, setIsFav] = useState(false);
  const [shareState, setShareState] = useState<'idle' | 'copied' | 'failed'>('idle');

  useEffect(() => {
    if (restaurant && !activeMenuCat) {
      setActiveMenuCat(restaurant.menuCategories[0] ?? '');
    }
  }, [restaurant, activeMenuCat]);

  useEffect(() => {
    if (restaurant) setIsFav(!!restaurant.isFavorite);
  }, [restaurant]);

  const toggleFavorite = async () => {
    if (!id) return;
    if (!user) {
      navigate(`/login?redirect=${encodeURIComponent(`/restaurant/${id}`)}`);
      return;
    }
    const next = !isFav;
    setIsFav(next);
    try {
      if (next) {
        await api.put(`/favorites/${id}`);
      } else {
        await api.del(`/favorites/${id}`);
      }
    } catch {
      setIsFav(!next);
    }
  };

  const handleShare = async () => {
    if (!id) return;
    const ok = await copyRestaurantLink(id);
    setShareState(ok ? 'copied' : 'failed');
    setTimeout(() => setShareState('idle'), 2000);
  };

  if (loading) {
    return (
      <div className="app-container">
        <div className="h-48 bg-gray-200 dark:bg-gray-800 animate-pulse" />
        <div className="p-4 space-y-3">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="bg-white dark:bg-gray-800 rounded-xl h-20 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !restaurant) {
    return (
      <div className="app-container flex items-center justify-center h-screen">
        <div className="text-center text-gray-400 dark:text-gray-500">
          <div className="text-5xl mb-3">🍽️</div>
          <p>{error ?? '餐厅不存在'}</p>
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
        style={!restaurant.bannerImage ? { background: `linear-gradient(135deg, ${restaurant.bgColor}ee, ${restaurant.bgColor}88)` } : undefined}
      >
        {restaurant.bannerImage && (
          <img
            src={assetUrl(restaurant.bannerImage)}
            alt={restaurant.name}
            className="absolute inset-0 w-full h-full object-cover z-0"
          />
        )}
        <button
          className="absolute top-10 left-4 w-9 h-9 bg-black/20 backdrop-blur-sm rounded-full flex items-center justify-center text-white z-10"
          onClick={() => navigate(-1)}
        >
          ←
        </button>
        <button
          className="absolute top-10 right-16 w-9 h-9 bg-black/20 backdrop-blur-sm rounded-full flex items-center justify-center text-lg text-white z-10"
          onClick={handleShare}
          aria-label="分享餐厅"
        >
          {shareState === 'copied' ? '✓' : shareState === 'failed' ? '✕' : '🔗'}
        </button>
        <button
          className="absolute top-10 right-4 w-9 h-9 bg-black/20 backdrop-blur-sm rounded-full flex items-center justify-center text-lg z-10"
          onClick={toggleFavorite}
          aria-label={isFav ? '取消收藏' : '收藏餐厅'}
        >
          {isFav ? '❤️' : '🤍'}
        </button>
        <div className="relative z-10 flex flex-col items-center">
          {!restaurant.bannerImage && <div className="text-6xl drop-shadow-lg">{restaurant.emoji}</div>}
          <h1 className="text-white font-black text-2xl mt-2 drop-shadow">{restaurant.name}</h1>
          <div className="flex items-center gap-3 mt-1">
            <span className="text-white/90 text-sm">⭐ {restaurant.rating}</span>
            <span className="text-white/60 text-xs">|</span>
            <span className="text-white/90 text-sm">配送费¥{restaurant.deliveryFee}</span>
            <span className="text-white/60 text-xs">|</span>
            <span className="text-white/90 text-sm">{restaurant.deliveryTime}分钟</span>
          </div>
        </div>
      </div>

      {/* Tags */}
      <div className="bg-white dark:bg-gray-800 px-4 py-2 flex gap-2 overflow-x-auto border-b border-gray-100 dark:border-gray-700">
        {restaurant.tags.map(tag => (
          <span key={tag} className="flex-shrink-0 text-xs px-2 py-1 bg-orange-50 dark:bg-orange-500/10 text-orange-500 rounded-full border border-orange-100 dark:border-orange-500/20">
            {tag}
          </span>
        ))}
      </div>

      {/* Menu area */}
      <div className="flex bg-white dark:bg-gray-800" style={{ minHeight: 'calc(100vh - 280px)' }}>
        {/* Left category nav */}
        <div className="w-20 flex-shrink-0 bg-gray-50 dark:bg-gray-900 border-r border-gray-100 dark:border-gray-700">
          {restaurant.menuCategories.map(cat => (
            <button
              key={cat}
              className={`w-full py-4 text-center text-xs font-medium transition-colors border-l-2 ${
                activeMenuCat === cat
                  ? 'border-orange-500 bg-white dark:bg-gray-800 text-orange-500 dark:text-orange-400'
                  : 'border-transparent text-gray-500 dark:text-gray-400'
              }`}
              onClick={() => setActiveMenuCat(cat)}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Right menu items */}
        <div className="flex-1 px-3 pb-8">
          <h3 className="text-gray-500 dark:text-gray-400 text-xs font-medium pt-3 pb-1">{activeMenuCat}</h3>
          {filteredMenu.length === 0 ? (
            <p className="text-gray-300 dark:text-gray-600 text-sm text-center py-8">暂无菜品</p>
          ) : (
            filteredMenu.map(item => (
              <MenuItemComponent key={item.id} item={item} restaurant={restaurant} />
            ))
          )}
        </div>
      </div>

      {/* Reviews */}
      {id && (
        <ReviewList restaurantId={id} rating={restaurant.rating} ratingCount={restaurant.ratingCount} />
      )}

      <CartBar deliveryFee={restaurant.deliveryFee} />
    </div>
  );
}
