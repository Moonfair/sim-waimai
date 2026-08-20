import { useNavigate } from 'react-router-dom';
import { useCart } from '../context/CartContext';
import CartLineItem from './CartLineItem';

interface Props {
  deliveryFee: number;
}

/** Desktop-only persistent cart sidebar shown next to the menu on the restaurant page
 *  (see CartBar for the mobile floating equivalent, hidden at this breakpoint). */
export default function DesktopCartPanel({ deliveryFee }: Props) {
  const { items, totalItems, totalPrice, updateQuantity } = useCart();
  const navigate = useNavigate();

  return (
    <div className="hidden lg:block w-80 flex-shrink-0 py-4 pl-4">
      <div className="sticky top-20 bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
        <h3 className="font-bold text-gray-900 dark:text-gray-100 text-sm px-4 pt-4">购物车</h3>
        {totalItems === 0 ? (
          <div className="text-center py-10 text-gray-300 dark:text-gray-600">
            <div className="text-3xl mb-2">🛒</div>
            <p className="text-xs">还没有点单，看看菜单吧</p>
          </div>
        ) : (
          <>
            <div className="max-h-96 overflow-y-auto mt-2">
              {items.map(item => (
                <CartLineItem key={item.key} item={item} onChangeQuantity={updateQuantity} />
              ))}
            </div>
            <div className="border-t border-gray-100 dark:border-gray-700 p-4 flex items-center justify-between">
              <div>
                <div className="text-gray-900 dark:text-gray-100 font-bold text-base">¥{totalPrice.toFixed(2)}</div>
                <div className="text-gray-400 dark:text-gray-500 text-xs">另需配送费¥{deliveryFee}</div>
              </div>
              <button
                className="bg-orange-500 text-white px-5 py-2.5 rounded-xl font-bold text-sm active:scale-95 transition-transform"
                onClick={() => navigate('/cart')}
              >
                去结算
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
