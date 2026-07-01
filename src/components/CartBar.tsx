import { useNavigate } from 'react-router-dom';
import { useCart } from '../context/CartContext';

interface Props {
  deliveryFee: number;
}

export default function CartBar({ deliveryFee }: Props) {
  const { totalItems, totalPrice } = useCart();
  const navigate = useNavigate();

  if (totalItems === 0) return null;

  return (
    <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[480px] px-4 pb-6 pointer-events-none">
      <div className="bg-gray-900 rounded-2xl flex items-center justify-between px-4 py-3 shadow-2xl pointer-events-auto">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="w-12 h-12 bg-orange-500 rounded-full flex items-center justify-center text-2xl">
              🛒
            </div>
            <div className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center">
              <span className="text-white text-xs font-bold">{totalItems}</span>
            </div>
          </div>
          <div>
            <div className="text-white font-bold text-base">¥{totalPrice.toFixed(2)}</div>
            <div className="text-gray-400 text-xs">另需配送费¥{deliveryFee}</div>
          </div>
        </div>
        <button
          className="bg-orange-500 text-white px-5 py-2.5 rounded-xl font-bold text-sm active:scale-95 transition-transform"
          onClick={() => navigate('/cart')}
        >
          去结算
        </button>
      </div>
    </div>
  );
}
