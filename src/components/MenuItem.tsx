import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faEllipsisVertical, faFlag } from '@fortawesome/free-solid-svg-icons';
import type { MenuItem as MenuItemType, Restaurant } from '../data/restaurants';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import ReportSheet from './ReportSheet';
import ZoomableImage from './ZoomableImage';
import { useLongPressStep } from '../hooks/useLongPressStep';
import MenuItemOptionsSheet from './MenuItemOptionsSheet';

interface Props {
  item: MenuItemType;
  restaurant: Restaurant;
}

export default function MenuItem({ item, restaurant }: Props) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { items, addItem, updateQuantity } = useCart();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [reportSheetOpen, setReportSheetOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const flash = (text: string) => {
    setMessage(text);
    setTimeout(() => setMessage(null), 2500);
  };

  const handleReportClick = () => {
    setMenuOpen(false);
    if (!user) {
      navigate(`/login?redirect=${encodeURIComponent(`/restaurant/${restaurant.id}`)}`);
      return;
    }
    setReportSheetOpen(true);
  };

  const hasOptions = !!item.optionGroups?.length;
  const hasPriceImpact = item.optionGroups?.some(g => g.options.some(o => o.priceDelta > 0)) ?? false;

  const cartItem = !hasOptions ? items.find(i => i.key === item.id) : undefined;
  const quantity = cartItem?.quantity ?? 0;

  const customizedTotalQty = hasOptions
    ? items.filter(i => i.menuItem.id === item.id).reduce((sum, i) => sum + i.quantity, 0)
    : 0;

  const decrement = useLongPressStep(() => {
    const current = items.find(i => i.key === item.id)?.quantity ?? 0;
    if (current <= 0) return false;
    updateQuantity(item.id, current - 1);
    return current - 1 > 0;
  });
  const increment = useLongPressStep(() => {
    addItem(item, restaurant);
    return true;
  });

  return (
    <div className="relative flex gap-3 py-3 border-b border-gray-50 dark:border-gray-700 last:border-0">
      <button
        className="absolute top-1 right-0 w-6 h-6 flex items-center justify-center text-gray-300 dark:text-gray-600"
        onClick={() => setMenuOpen((v) => !v)}
        aria-label="更多操作"
      >
        <FontAwesomeIcon icon={faEllipsisVertical} />
      </button>
      {menuOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
          <div className="absolute top-7 right-0 z-50 min-w-[96px] bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-100 dark:border-gray-700 overflow-hidden">
            <button
              className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-gray-600 dark:text-gray-300 whitespace-nowrap"
              onClick={handleReportClick}
            >
              <FontAwesomeIcon icon={faFlag} className="text-xs" />
              举报
            </button>
          </div>
        </>
      )}

      {item.image ? (
        <ZoomableImage
          src={item.image}
          alt={item.name}
          className="w-20 h-20 rounded-lg object-cover flex-shrink-0"
        />
      ) : (
        <div
          className="w-20 h-20 rounded-lg flex-shrink-0 flex items-center justify-center text-4xl"
          style={{ background: `linear-gradient(135deg, ${restaurant.bgColor}22, ${restaurant.bgColor}11)` }}
        >
          {item.emoji}
        </div>
      )}

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-1">
              {item.popular && (
                <span className="text-xs px-1 py-0.5 bg-red-50 text-red-500 rounded font-medium">热销</span>
              )}
              <span className="font-medium text-gray-900 dark:text-gray-100 text-sm">{item.name}</span>
            </div>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 line-clamp-2 leading-relaxed">{item.description}</p>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-orange-500 font-bold">
                ¥{item.price}{hasOptions && hasPriceImpact ? '起' : ''}
              </span>
              <span className="text-xs text-gray-300 dark:text-gray-600">|</span>
              <span className="text-xs text-gray-400 dark:text-gray-500">{item.calories} 千卡</span>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end mt-1">
          {hasOptions ? (
            <div className="relative">
              <button
                className="px-2.5 h-6 rounded-full bg-orange-500 text-white flex items-center justify-center text-xs font-bold leading-none shadow-sm whitespace-nowrap"
                onClick={() => setSheetOpen(true)}
              >
                改规格
              </button>
              {customizedTotalQty > 0 && (
                <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 rounded-full text-white text-[10px] flex items-center justify-center font-bold">
                  {customizedTotalQty}
                </span>
              )}
            </div>
          ) : quantity > 0 ? (
            <div className="flex items-center gap-2">
              <button
                className="w-6 h-6 rounded-full border-2 border-orange-400 text-orange-500 flex items-center justify-center text-base font-bold leading-none"
                onClick={decrement.wrapClick(() => updateQuantity(item.id, quantity - 1))}
                {...decrement.handlers}
              >
                −
              </button>
              <span className="text-sm font-bold text-gray-800 dark:text-gray-100 w-4 text-center">{quantity}</span>
              <button
                className="w-6 h-6 rounded-full bg-orange-500 text-white flex items-center justify-center text-base font-bold leading-none shadow-sm"
                onClick={increment.wrapClick(() => addItem(item, restaurant))}
                {...increment.handlers}
              >
                +
              </button>
            </div>
          ) : (
            <button
              className="w-6 h-6 rounded-full bg-orange-500 text-white flex items-center justify-center text-base font-bold leading-none shadow-sm"
              onClick={() => addItem(item, restaurant)}
            >
              +
            </button>
          )}
        </div>
      </div>

      {sheetOpen && (
        <MenuItemOptionsSheet
          item={item}
          onClose={() => setSheetOpen(false)}
          onConfirm={(selectedOptions) => {
            addItem(item, restaurant, selectedOptions);
            setSheetOpen(false);
          }}
        />
      )}

      {message && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-gray-900/90 text-white text-xs px-4 py-2 rounded-full">
          {message}
        </div>
      )}

      {reportSheetOpen && (
        <ReportSheet
          target={{ targetType: 'menuItem', restaurantId: restaurant.id, itemId: item.id }}
          onClose={() => setReportSheetOpen(false)}
          onSubmitted={flash}
        />
      )}
    </div>
  );
}
