import { useNavigate } from 'react-router-dom';
import { useCart } from '../context/CartContext';

export default function Cart() {
  const { items, restaurant, totalPrice, totalCalories, updateQuantity, clearCart } = useCart();
  const navigate = useNavigate();

  if (items.length === 0 || !restaurant) {
    return (
      <div className="app-container flex flex-col items-center justify-center h-screen gap-4">
        <div className="text-6xl">🛒</div>
        <p className="text-gray-400 text-base">购物车是空的</p>
        <button
          className="bg-orange-500 text-white px-6 py-3 rounded-xl font-bold"
          onClick={() => navigate('/')}
        >
          去点餐
        </button>
      </div>
    );
  }

  const deliveryFee = restaurant.deliveryFee;
  const discount = totalPrice >= 30 ? 3 : 0;
  const finalPrice = totalPrice + deliveryFee - discount;

  return (
    <div className="app-container bg-gray-50">
      {/* Header */}
      <div className="bg-white px-4 pt-10 pb-4 border-b border-gray-100">
        <div className="flex items-center gap-3">
          <button
            className="w-8 h-8 flex items-center justify-center text-gray-600"
            onClick={() => navigate(-1)}
          >
            ←
          </button>
          <h1 className="text-gray-900 font-bold text-lg">确认订单</h1>
        </div>
      </div>

      <div className="px-4 pb-40">
        {/* Delivery address */}
        <div className="bg-white rounded-xl mt-4 p-4">
          <div className="flex items-start gap-3">
            <span className="text-orange-500 text-lg mt-0.5">📍</span>
            <div className="flex-1">
              <div className="flex items-center justify-between">
                <span className="font-bold text-gray-900 text-sm">北京市朝阳区三里屯</span>
                <span className="text-gray-300 text-xs">›</span>
              </div>
              <p className="text-gray-400 text-xs mt-0.5">三里屯太古里北区 N3-15（假地址）</p>
              <p className="text-gray-400 text-xs mt-0.5">联系电话：138****1234</p>
            </div>
          </div>
          <div className="mt-3 bg-orange-50 rounded-lg px-3 py-2 flex items-center gap-2">
            <span className="text-orange-400 text-sm">⏱️</span>
            <span className="text-orange-500 text-xs font-medium">预计 {restaurant.deliveryTime} 分钟后送达（假的）</span>
          </div>
        </div>

        {/* Items */}
        <div className="bg-white rounded-xl mt-3 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-50">
            <div className="flex items-center gap-2">
              <span className="text-lg">{restaurant.emoji}</span>
              <span className="font-bold text-gray-900 text-sm">{restaurant.name}</span>
            </div>
            <button
              className="text-gray-300 text-xs"
              onClick={() => { clearCart(); navigate('/'); }}
            >
              清空
            </button>
          </div>
          {items.map(({ key, menuItem, quantity, selectedOptions }) => {
            const linePrice = menuItem.price + (selectedOptions?.reduce((s, o) => s + o.priceDelta, 0) ?? 0);
            const optionsSummary = selectedOptions
              ?.map(o => o.priceDelta > 0 ? `${o.optionName}(+${o.priceDelta}元)` : o.optionName)
              .join(' · ');
            return (
              <div key={key} className="flex items-center gap-3 px-4 py-3 border-b border-gray-50 last:border-0">
                <div className="text-3xl">{menuItem.emoji}</div>
                <div className="flex-1">
                  <p className="text-gray-900 text-sm font-medium">{menuItem.name}</p>
                  {optionsSummary && (
                    <p className="text-gray-400 text-xs mt-0.5">{optionsSummary}</p>
                  )}
                  <p className="text-orange-500 text-sm font-bold mt-0.5">¥{linePrice}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    className="w-6 h-6 rounded-full border-2 border-orange-400 text-orange-500 flex items-center justify-center text-base font-bold"
                    onClick={() => updateQuantity(key, quantity - 1)}
                  >
                    −
                  </button>
                  <span className="text-sm font-bold w-4 text-center">{quantity}</span>
                  <button
                    className="w-6 h-6 rounded-full bg-orange-500 text-white flex items-center justify-center text-base font-bold"
                    onClick={() => updateQuantity(key, quantity + 1)}
                  >
                    +
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Notes */}
        <div className="bg-white rounded-xl mt-3 p-4">
          <label className="text-gray-700 text-sm font-medium block mb-2">备注</label>
          <textarea
            className="w-full border border-gray-100 rounded-lg p-2.5 text-sm text-gray-600 resize-none outline-none focus:border-orange-300"
            rows={2}
            placeholder="口味要求、餐具数量等（假的，写什么都不会有人看）"
          />
        </div>

        {/* Price breakdown */}
        <div className="bg-white rounded-xl mt-3 p-4">
          <h3 className="font-bold text-gray-900 text-sm mb-3">价格明细</h3>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">商品合计</span>
              <span className="text-gray-900">¥{totalPrice.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">配送费</span>
              <span className="text-gray-900">¥{deliveryFee.toFixed(2)}</span>
            </div>
            {discount > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-green-500">满减优惠</span>
                <span className="text-green-500">-¥{discount.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between text-sm font-bold border-t border-gray-100 pt-2 mt-1">
              <span className="text-gray-900">实付</span>
              <span className="text-orange-500 text-base">¥{finalPrice.toFixed(2)}</span>
            </div>
          </div>
          <div className="mt-3 bg-green-50 rounded-lg px-3 py-2">
            <p className="text-green-600 text-xs text-center">
              🔥 下单后将节省 <strong>{totalCalories}</strong> 千卡，相当于跑了约 <strong>{(totalCalories / 60).toFixed(0)}</strong> 分钟
            </p>
          </div>
        </div>

        {/* Disclaimer */}
        <p className="text-gray-300 text-xs text-center mt-3 px-4">
          这是一个假外卖，不会真的送来，也不会收取任何费用
        </p>
      </div>

      {/* Bottom CTA */}
      <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[480px] px-4 pb-8 pt-4 bg-gradient-to-t from-gray-50 via-gray-50">
        <button
          className="w-full bg-orange-500 text-white py-4 rounded-2xl font-black text-lg shadow-lg active:scale-95 transition-transform"
          onClick={() => navigate('/order')}
        >
          免费下单 🎉
        </button>
        <p className="text-center text-gray-300 text-xs mt-2">
          点击后不会产生任何实际费用
        </p>
      </div>
    </div>
  );
}
