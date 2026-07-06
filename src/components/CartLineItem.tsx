import type { CartItem } from '../context/CartContext';
import { useLongPressStep } from '../hooks/useLongPressStep';

interface Props {
  item: CartItem;
  onChangeQuantity: (key: string, quantity: number) => void;
}

export default function CartLineItem({ item, onChangeQuantity }: Props) {
  const { key, menuItem, quantity, selectedOptions } = item;
  const linePrice = menuItem.price + (selectedOptions?.reduce((s, o) => s + o.priceDelta, 0) ?? 0);
  const optionsSummary = selectedOptions
    ?.map(o => o.priceDelta > 0 ? `${o.optionName}(+${o.priceDelta}元)` : o.optionName)
    .join(' · ');

  const decrement = useLongPressStep(() => {
    if (quantity <= 0) return false;
    onChangeQuantity(key, quantity - 1);
    return quantity - 1 > 0;
  });
  const increment = useLongPressStep(() => {
    onChangeQuantity(key, quantity + 1);
    return true;
  });

  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-50 dark:border-gray-700 last:border-0">
      <div className="text-3xl">{menuItem.emoji}</div>
      <div className="flex-1">
        <p className="text-gray-900 dark:text-gray-100 text-sm font-medium">{menuItem.name}</p>
        {optionsSummary && (
          <p className="text-gray-400 dark:text-gray-500 text-xs mt-0.5">{optionsSummary}</p>
        )}
        <p className="text-orange-500 text-sm font-bold mt-0.5">¥{linePrice}</p>
      </div>
      <div className="flex items-center gap-2">
        <button
          className="w-6 h-6 rounded-full border-2 border-orange-400 text-orange-500 flex items-center justify-center text-base font-bold"
          onClick={decrement.wrapClick(() => onChangeQuantity(key, quantity - 1))}
          {...decrement.handlers}
        >
          −
        </button>
        <span className="text-sm font-bold w-4 text-center">{quantity}</span>
        <button
          className="w-6 h-6 rounded-full bg-orange-500 text-white flex items-center justify-center text-base font-bold"
          onClick={increment.wrapClick(() => onChangeQuantity(key, quantity + 1))}
          {...increment.handlers}
        >
          +
        </button>
      </div>
    </div>
  );
}
