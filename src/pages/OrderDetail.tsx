import { useNavigate, useParams } from 'react-router-dom';
import type { OrderDto } from '@sim-waimai/shared';
import { useApi } from '../hooks/useApi';
import { assetUrl } from '../lib/assetUrl';

const STATUS_HEADER: Record<OrderDto['status'], { emoji: string; title: string; sub: string }> = {
  pending: { emoji: '🍳', title: '商家备餐中', sub: '商家正在为您精心准备' },
  delivering: { emoji: '🛵', title: '骑手配送中', sub: '美食正在飞奔向您' },
  completed: { emoji: '✅', title: '订单已完成', sub: '感谢使用吃了嘛外卖（省钱版）' },
};

export default function OrderDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: order, loading, error } = useApi<OrderDto>(id ? `/orders/${id}` : null);

  if (loading) {
    return (
      <div className="app-container min-h-screen bg-gray-50 dark:bg-gray-900 p-4 pt-24 space-y-3">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="bg-white dark:bg-gray-800 rounded-2xl h-28 animate-pulse" />
        ))}
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="app-container flex items-center justify-center h-screen">
        <div className="text-center text-gray-400 dark:text-gray-500">
          <div className="text-5xl mb-3">📋</div>
          <p>{error ?? '订单不存在'}</p>
          <button className="mt-4 text-orange-500" onClick={() => navigate('/orders')}>
            返回订单列表
          </button>
        </div>
      </div>
    );
  }

  const header = STATUS_HEADER[order.status];

  return (
    <div className="app-container min-h-screen bg-gray-50 dark:bg-gray-900 pb-10">
      {/* Header */}
      <div className="bg-orange-500 px-4 pt-10 pb-12 relative">
        <button
          className="absolute top-10 left-4 w-9 h-9 bg-white/20 rounded-full flex items-center justify-center text-white"
          onClick={() => navigate(-1)}
          aria-label="返回"
        >
          ←
        </button>
        <div className="text-center mt-4">
          <div className="text-4xl">{header.emoji}</div>
          <h1 className="text-white font-black text-xl mt-1">{header.title}</h1>
          <p className="text-orange-100 text-xs mt-0.5">{header.sub}</p>
        </div>
      </div>

      <div className="px-4 -mt-6 space-y-3">
        {/* Items */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl overflow-hidden shadow-sm">
          <div
            className="flex items-center gap-2 px-4 py-3 border-b border-gray-50 dark:border-gray-700 cursor-pointer"
            onClick={() => navigate(`/restaurant/${order.restaurantId}`)}
          >
            <span className="text-lg">{order.restaurant.emoji}</span>
            <span className="font-bold text-gray-900 dark:text-gray-100 text-sm">{order.restaurant.name}</span>
            <span className="text-gray-300 dark:text-gray-600 text-xs ml-auto">再来一单 ›</span>
          </div>
          {order.items.map((item) => (
            <div key={item.key} className="flex items-center gap-3 px-4 py-3">
              {item.image ? (
                <img src={assetUrl(item.image)} alt={item.name} className="w-12 h-12 rounded-lg object-cover flex-shrink-0" />
              ) : (
                <div className="w-12 h-12 rounded-lg bg-gray-50 dark:bg-gray-700 flex items-center justify-center text-2xl flex-shrink-0">
                  {item.emoji}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-gray-900 dark:text-gray-100 text-sm font-medium truncate">{item.name}</p>
                {item.selectedOptions && item.selectedOptions.length > 0 && (
                  <p className="text-gray-400 dark:text-gray-500 text-xs mt-0.5 truncate">
                    {item.selectedOptions.map((o) => o.optionName).join(' / ')}
                  </p>
                )}
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-gray-900 dark:text-gray-100 text-sm font-medium">¥{item.lineTotal.toFixed(2)}</p>
                <p className="text-gray-400 dark:text-gray-500 text-xs">x{item.quantity}</p>
              </div>
            </div>
          ))}
          {/* Price breakdown */}
          <div className="px-4 py-3 border-t border-gray-50 dark:border-gray-700 space-y-1.5">
            <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
              <span>商品合计</span>
              <span>¥{order.subtotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
              <span>配送费</span>
              <span>¥{order.deliveryFee.toFixed(2)}</span>
            </div>
            {order.discount > 0 && (
              <div className="flex justify-between text-xs text-green-500">
                <span>满减优惠</span>
                <span>-¥{order.discount.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between text-sm font-bold text-gray-900 dark:text-gray-100 pt-1">
              <span>实付（假装付了）</span>
              <span className="text-orange-500">¥{order.total.toFixed(2)}</span>
            </div>
          </div>
        </div>

        {/* Rider */}
        {order.rider && (
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-4 shadow-sm flex items-center gap-3">
            <div className="w-11 h-11 bg-orange-100 dark:bg-orange-500/20 rounded-full flex items-center justify-center text-xl">
              {order.rider.avatarEmoji}
            </div>
            <div>
              <p className="font-bold text-gray-900 dark:text-gray-100 text-sm">{order.rider.name}</p>
              <p className="text-gray-400 dark:text-gray-500 text-xs">
                ★ {order.rider.rating} · 送单{order.rider.deliveryCount}
              </p>
            </div>
            <span className="ml-auto text-2xl">{order.rider.vehicleEmoji}</span>
          </div>
        )}

        {/* Address */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl p-4 shadow-sm">
          <h3 className="font-bold text-gray-900 dark:text-gray-100 text-sm mb-2">配送信息</h3>
          <p className="text-gray-600 dark:text-gray-300 text-sm">
            📍 {order.address.address}
          </p>
          {(order.address.recipientName || order.address.phone) && (
            <p className="text-gray-400 dark:text-gray-500 text-xs mt-1">
              {order.address.recipientName} {order.address.phone}
            </p>
          )}
        </div>

        {/* Review (form arrives with the review feature) */}
        {order.status === 'completed' && order.review && (
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-4 shadow-sm">
            <h3 className="font-bold text-gray-900 dark:text-gray-100 text-sm mb-2">我的评价</h3>
            <div className="text-yellow-400 text-sm">
              {'★'.repeat(order.review.rating)}
              <span className="text-gray-200 dark:text-gray-600">{'★'.repeat(5 - order.review.rating)}</span>
            </div>
            {order.review.content && (
              <p className="text-gray-600 dark:text-gray-300 text-sm mt-1.5">{order.review.content}</p>
            )}
          </div>
        )}

        {/* Meta */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl p-4 shadow-sm">
          <h3 className="font-bold text-gray-900 dark:text-gray-100 text-sm mb-2">订单信息</h3>
          <div className="space-y-1 text-xs text-gray-400 dark:text-gray-500">
            <p>订单编号：{order.id}</p>
            <p>下单时间：{new Date(order.createdAt).toLocaleString('zh-CN')}</p>
            {order.completedAt && <p>完成时间：{new Date(order.completedAt).toLocaleString('zh-CN')}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
