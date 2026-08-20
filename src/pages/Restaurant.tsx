import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { Restaurant as RestaurantData } from '@sim-waimai/shared';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faFlag } from '@fortawesome/free-solid-svg-icons';
import MenuItemComponent from '../components/MenuItem';
import CartBar from '../components/CartBar';
import DesktopCartPanel from '../components/DesktopCartPanel';
import ReportSheet from '../components/ReportSheet';
import ReviewList from '../components/ReviewList';
import { useAuth } from '../context/AuthContext';
import { useApi } from '../hooks/useApi';
import { api } from '../lib/api';
import ZoomableImage from '../components/ZoomableImage';
import PosterShareSheet from '../components/PosterShareSheet';
import { restaurantUrl } from '../lib/share';
import { getDisplayStats } from '../lib/displayStats';

export default function Restaurant() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: restaurant, loading, error } = useApi<RestaurantData>(id ? `/restaurants/${id}` : null);
  const [activeMenuCat, setActiveMenuCat] = useState('');
  const [isFav, setIsFav] = useState(false);
  const [posterOpen, setPosterOpen] = useState(false);
  const [reportSheetOpen, setReportSheetOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (restaurant && !activeMenuCat) {
      setActiveMenuCat(restaurant.menuCategories[0] ?? '');
    }
  }, [restaurant, activeMenuCat]);

  useEffect(() => {
    if (restaurant) setIsFav(!!restaurant.isFavorite);
  }, [restaurant]);

  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});
  const suppressObserver = useRef(false);
  const observerTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (!restaurant) return;
    const categories = restaurant.menuCategories.filter(cat =>
      restaurant.menu.some(item => item.menuCategory === cat)
    );
    if (categories.length === 0) return;

    const observer = new IntersectionObserver(
      entries => {
        if (suppressObserver.current) return;
        const visible = entries.filter(entry => entry.isIntersecting);
        if (visible.length === 0) return;
        const topMost = visible.reduce((a, b) =>
          a.boundingClientRect.top <= b.boundingClientRect.top ? a : b
        );
        const cat = topMost.target.getAttribute('data-category');
        if (cat) setActiveMenuCat(cat);
      },
      { rootMargin: '-64px 0px -70% 0px', threshold: 0 }
    );

    categories.forEach(cat => {
      const el = sectionRefs.current[cat];
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, [restaurant]);

  useEffect(() => {
    return () => {
      if (observerTimeoutRef.current) window.clearTimeout(observerTimeoutRef.current);
    };
  }, []);

  const handleCategoryClick = (cat: string) => {
    setActiveMenuCat(cat);
    suppressObserver.current = true;
    if (observerTimeoutRef.current) window.clearTimeout(observerTimeoutRef.current);
    sectionRefs.current[cat]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    observerTimeoutRef.current = window.setTimeout(() => {
      suppressObserver.current = false;
    }, 600);
  };

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

  const flash = (text: string) => {
    setMessage(text);
    setTimeout(() => setMessage(null), 2500);
  };

  const handleReportClick = () => {
    if (!id) return;
    if (!user) {
      navigate(`/login?redirect=${encodeURIComponent(`/restaurant/${id}`)}`);
      return;
    }
    setReportSheetOpen(true);
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

  const menuByCategory = restaurant.menuCategories
    .map(cat => ({ cat, items: restaurant.menu.filter(item => item.menuCategory === cat) }))
    .filter(group => group.items.length > 0);

  // 与首页卡片展示口径一致(放大后的销量/评论数),而不是数据库里的真实值。
  const { displaySales, displayReviews } = getDisplayStats(restaurant.id, restaurant.monthlyOrders, restaurant.ratingCount);

  return (
    <div className="app-container">
      {/* Header */}
      <div
        className="h-48 flex flex-col items-center justify-center relative"
        style={!restaurant.bannerImage ? { background: `linear-gradient(135deg, ${restaurant.bgColor}ee, ${restaurant.bgColor}88)` } : undefined}
      >
        {restaurant.bannerImage && (
          <ZoomableImage
            src={restaurant.bannerImage}
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
          className="absolute top-10 right-28 w-9 h-9 bg-black/20 backdrop-blur-sm rounded-full flex items-center justify-center text-lg text-white z-10"
          onClick={handleReportClick}
          aria-label="举报店铺"
        >
          <FontAwesomeIcon icon={faFlag} />
        </button>
        <button
          className="absolute top-10 right-16 w-9 h-9 bg-black/20 backdrop-blur-sm rounded-full flex items-center justify-center text-lg text-white z-10"
          onClick={() => setPosterOpen(true)}
          aria-label="分享餐厅"
        >
          🔗
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

      {restaurant.isActive === false && (
        <div className="mx-4 mt-3 bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 text-xs rounded-2xl px-4 py-3">
          🌙 该店铺已打烊，暂不可下单
        </div>
      )}

      {/* Menu area, with a persistent cart sidebar alongside it on desktop */}
      <div className="lg:flex lg:gap-6 lg:items-start lg:px-4">
        <div className="flex-1 flex bg-white dark:bg-gray-800" style={{ minHeight: 'calc(100vh - 280px)' }}>
          {/* Left category nav */}
          <div className="w-20 flex-shrink-0 self-start sticky top-0 max-h-screen overflow-y-auto bg-gray-50 dark:bg-gray-900 border-r border-gray-100 dark:border-gray-700">
            {restaurant.menuCategories.map(cat => (
              <button
                key={cat}
                className={`w-full py-4 text-center text-xs font-medium transition-colors border-l-2 ${
                  activeMenuCat === cat
                    ? 'border-orange-500 bg-white dark:bg-gray-800 text-orange-500 dark:text-orange-400'
                    : 'border-transparent text-gray-500 dark:text-gray-400'
                }`}
                onClick={() => handleCategoryClick(cat)}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Right menu items */}
          <div className="flex-1 px-3 pb-8">
            {menuByCategory.length === 0 ? (
              <p className="text-gray-300 dark:text-gray-600 text-sm text-center py-8">暂无菜品</p>
            ) : (
              menuByCategory.map(({ cat, items }) => (
                <section
                  key={cat}
                  id={`menu-cat-${cat}`}
                  data-category={cat}
                  ref={el => { sectionRefs.current[cat] = el; }}
                >
                  <h3 className="text-gray-500 dark:text-gray-400 text-xs font-medium pt-3 pb-1">{cat}</h3>
                  {items.map(item => (
                    <MenuItemComponent
                      key={item.id}
                      item={item}
                      restaurant={restaurant}
                      purchasable={restaurant.isActive}
                    />
                  ))}
                </section>
              ))
            )}
          </div>
        </div>

        <DesktopCartPanel deliveryFee={restaurant.deliveryFee} />
      </div>

      {/* Reviews */}
      {id && (
        <ReviewList restaurantId={id} rating={restaurant.rating} ratingCount={displayReviews} />
      )}

      <CartBar deliveryFee={restaurant.deliveryFee} />

      {message && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-gray-900/90 text-white text-xs px-4 py-2 rounded-full">
          {message}
        </div>
      )}

      {reportSheetOpen && id && (
        <ReportSheet
          target={{ targetType: 'restaurant', restaurantId: id }}
          onClose={() => setReportSheetOpen(false)}
          onSubmitted={flash}
        />
      )}

      {posterOpen && id && (
        <PosterShareSheet
          payload={{
            type: 'restaurant',
            data: {
              name: restaurant.name,
              emoji: restaurant.emoji,
              bgColor: restaurant.bgColor,
              bannerImage: restaurant.bannerImage,
              rating: restaurant.rating,
              ratingCount: displayReviews,
              monthlyOrders: displaySales,
              tags: restaurant.tags,
            },
          }}
          linkUrl={restaurantUrl(id)}
          onClose={() => setPosterOpen(false)}
        />
      )}
    </div>
  );
}
