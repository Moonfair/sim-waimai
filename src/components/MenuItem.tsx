import { useState } from 'react';
import type { MenuItem as MenuItemType, Restaurant } from '../data/restaurants';
import { useCart } from '../context/CartContext';
import { assetUrl } from '../lib/assetUrl';
import MenuItemOptionsSheet from './MenuItemOptionsSheet';

interface Props {
  item: MenuItemType;
  restaurant: Restaurant;
}

export default function MenuItem({ item, restaurant }: Props) {
  const { items, addItem, updateQuantity } = useCart();
  const [sheetOpen, setSheetOpen] = useState(false);

  const hasOptions = !!item.optionGroups?.length;
  const hasPriceImpact = item.optionGroups?.some(g => g.options.some(o => o.priceDelta > 0)) ?? false;

  const cartItem = !hasOptions ? items.find(i => i.key === item.id) : undefined;
  const quantity = cartItem?.quantity ?? 0;

  const customizedTotalQty = hasOptions
    ? items.filter(i => i.menuItem.id === item.id).reduce((sum, i) => sum + i.quantity, 0)
    : 0;

  return (
    <div className="flex gap-3 py-3 border-b border-gray-50 last:border-0">
      {item.image ? (
        <img
          src={assetUrl(item.image)}
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
              <span className="font-medium text-gray-900 text-sm">{item.name}</span>
            </div>
            <p className="text-xs text-gray-400 mt-0.5 line-clamp-2 leading-relaxed">{item.description}</p>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-orange-500 font-bold">
                ¥{item.price}{hasOptions && hasPriceImpact ? '起' : ''}
              </span>
              <span className="text-xs text-gray-300">|</span>
              <span className="text-xs text-gray-400">{item.calories} 千卡</span>
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
                onClick={() => updateQuantity(item.id, quantity - 1)}
              >
                −
              </button>
              <span className="text-sm font-bold text-gray-800 w-4 text-center">{quantity}</span>
              <button
                className="w-6 h-6 rounded-full bg-orange-500 text-white flex items-center justify-center text-base font-bold leading-none shadow-sm"
                onClick={() => addItem(item, restaurant)}
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
    </div>
  );
}
