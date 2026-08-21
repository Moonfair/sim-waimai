import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { SearchResultDto } from '@sim-waimai/shared';
import RestaurantCard from '../components/RestaurantCard';
import { useApi } from '../hooks/useApi';
import { useDebounce } from '../hooks/useDebounce';
import { assetUrl } from '../lib/assetUrl';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChevronLeft, faMagnifyingGlass } from '@fortawesome/free-solid-svg-icons';

type Tab = 'shop' | 'item';

export default function Search() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<Tab>('shop');
  const debouncedQuery = useDebounce(query.trim(), 300);
  const { data, loading } = useApi<SearchResultDto>(
    debouncedQuery ? `/search?q=${encodeURIComponent(debouncedQuery)}` : null,
  );

  const restaurants = data?.restaurants ?? [];
  const items = data?.items ?? [];

  return (
    <div className="app-container min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header: back + editable search input, sticky so it stays visible while results scroll */}
      <div className="sticky top-0 z-20 bg-white dark:bg-gray-800 px-4 pt-10 pb-3 border-b border-gray-100 dark:border-gray-700">
        <div className="flex items-center gap-3">
          <button
            className="w-8 h-8 flex-shrink-0 flex items-center justify-center text-gray-600 dark:text-gray-300"
            onClick={() => navigate(-1)}
          >
            <FontAwesomeIcon icon={faChevronLeft} />
          </button>
          <div className="flex-1 flex items-center gap-2 bg-gray-100 dark:bg-gray-700 rounded-xl px-3 py-2.5">
            <FontAwesomeIcon icon={faMagnifyingGlass} className="text-gray-400" />
            <input
              autoFocus
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索商家或商品"
              className="flex-1 min-w-0 bg-transparent outline-none text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500"
            />
          </div>
        </div>

        {debouncedQuery && (
          <div className="flex gap-2 mt-3">
            {(
              [
                { value: 'shop', label: `商家 (${restaurants.length})` },
                { value: 'item', label: `商品 (${items.length})` },
              ] as const
            ).map((t) => (
              <button
                key={t.value}
                className={`text-xs px-3 py-1.5 rounded-full font-medium ${
                  tab === t.value
                    ? 'bg-orange-500 text-white'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                }`}
                onClick={() => setTab(t.value)}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="px-4 pt-4 pb-10">
        {!debouncedQuery ? (
          <div className="text-center py-20 text-gray-400 dark:text-gray-500">
            <div className="text-5xl mb-3">🔍</div>
            <p className="text-sm">输入关键词搜索商家或商品</p>
          </div>
        ) : loading ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="bg-white dark:bg-gray-800 rounded-xl h-56 animate-pulse" />
            ))}
          </div>
        ) : tab === 'shop' ? (
          restaurants.length === 0 ? (
            <div className="text-center py-20 text-gray-400 dark:text-gray-500">
              <div className="text-5xl mb-3">🤷</div>
              <p className="text-sm">没有找到相关商家</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {restaurants.map((r) => (
                <RestaurantCard key={r.id} restaurant={r} />
              ))}
            </div>
          )
        ) : items.length === 0 ? (
          <div className="text-center py-20 text-gray-400 dark:text-gray-500">
            <div className="text-5xl mb-3">🤷</div>
            <p className="text-sm">没有找到相关商品</p>
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((item) => (
              <div
                key={`${item.restaurantId}:${item.id}`}
                className="bg-white dark:bg-gray-800 rounded-xl p-3 flex items-center gap-3 cursor-pointer active:scale-[0.98] transition-transform"
                onClick={() => navigate(`/restaurant/${item.restaurantId}`)}
              >
                <div
                  className="w-14 h-14 flex-shrink-0 rounded-lg flex items-center justify-center text-2xl relative overflow-hidden"
                  style={
                    !item.image
                      ? { background: `linear-gradient(135deg, ${item.restaurantBgColor}dd, ${item.restaurantBgColor}88)` }
                      : undefined
                  }
                >
                  {item.image ? (
                    <img
                      src={assetUrl(item.image)}
                      alt={item.name}
                      className="absolute inset-0 w-full h-full object-cover"
                    />
                  ) : (
                    <span>{item.emoji}</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-gray-900 dark:text-gray-100 text-sm truncate">{item.name}</p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 truncate">
                    {item.restaurantEmoji} {item.restaurantName}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-orange-500 font-bold text-sm">¥{item.price}</span>
                    <span className="text-gray-300 dark:text-gray-600 text-xs">|</span>
                    <span className="text-xs text-gray-400 dark:text-gray-500">{item.calories}千卡</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
