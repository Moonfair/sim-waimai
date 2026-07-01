import { useNavigate } from 'react-router-dom';
import type { Restaurant } from '../data/restaurants';

interface Props {
  restaurant: Restaurant;
}

export default function RestaurantCard({ restaurant }: Props) {
  const navigate = useNavigate();

  return (
    <div
      className="bg-white rounded-xl overflow-hidden shadow-sm cursor-pointer active:scale-95 transition-transform"
      onClick={() => navigate(`/restaurant/${restaurant.id}`)}
    >
      <div
        className="h-36 flex items-center justify-center text-6xl relative"
        style={{ background: `linear-gradient(135deg, ${restaurant.bgColor}dd, ${restaurant.bgColor}88)` }}
      >
        <span className="drop-shadow-lg">{restaurant.emoji}</span>
        <div className="absolute bottom-2 left-3 flex gap-1">
          {restaurant.tags.slice(0, 2).map(tag => (
            <span
              key={tag}
              className="text-xs px-1.5 py-0.5 rounded text-white font-medium"
              style={{ backgroundColor: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)' }}
            >
              {tag}
            </span>
          ))}
        </div>
      </div>

      <div className="p-3">
        <div className="flex items-start justify-between">
          <h3 className="font-bold text-gray-900 text-base">{restaurant.name}</h3>
          <span className="text-xs text-gray-400 mt-0.5">{restaurant.deliveryTime}分钟</span>
        </div>

        <div className="flex items-center gap-2 mt-1">
          <div className="flex items-center gap-0.5">
            <span className="text-yellow-400 text-xs">★</span>
            <span className="text-sm font-medium text-gray-700">{restaurant.rating}</span>
          </div>
          <span className="text-gray-300 text-xs">|</span>
          <span className="text-xs text-gray-400">月售{restaurant.monthlyOrders > 10000 ? `${(restaurant.monthlyOrders / 10000).toFixed(1)}万` : restaurant.monthlyOrders}+</span>
          <span className="text-gray-300 text-xs">|</span>
          <span className="text-xs text-gray-400">起送¥{restaurant.minOrder}</span>
        </div>

        <div className="flex items-center justify-between mt-2">
          <span className="text-xs text-gray-400">
            配送费 <span className="text-orange-500 font-medium">¥{restaurant.deliveryFee}</span>
          </span>
          <span className="text-xs px-2 py-0.5 bg-orange-50 text-orange-500 rounded-full border border-orange-100">
            {restaurant.category}
          </span>
        </div>
      </div>
    </div>
  );
}
