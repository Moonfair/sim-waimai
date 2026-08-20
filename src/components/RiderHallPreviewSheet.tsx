import type { RiderHallOrderPreviewDto } from '@sim-waimai/shared';

interface Props {
  preview: RiderHallOrderPreviewDto;
  onAccept: () => void;
  onClose: () => void;
  /** True only while the accept request is actually in flight — drives the button text. */
  submitting: boolean;
  /** True whenever the button should be unclickable (submitting, or still in the post-attempt cooldown). */
  disabled: boolean;
  errorMessage: string | null;
}

export default function RiderHallPreviewSheet({
  preview,
  onAccept,
  onClose,
  submitting,
  disabled,
  errorMessage,
}: Props) {
  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/40" onClick={onClose} />
      <div className="fixed-shell bottom-0 z-50 bg-white dark:bg-gray-800 rounded-t-2xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-gray-50 dark:border-gray-700">
          <span className="font-bold text-gray-900 dark:text-gray-100 text-sm">抢单详情</span>
          <button
            className="w-7 h-7 flex items-center justify-center text-gray-400 dark:text-gray-500 text-lg"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          <p className="text-gray-400 dark:text-gray-500 text-xs">
            来自 <span className="text-gray-700 dark:text-gray-200 font-medium">{preview.buyerUsername}</span> 的订单
          </p>

          <div className="flex items-center gap-2">
            <span className="text-lg">{preview.restaurantEmoji}</span>
            <span className="font-bold text-gray-900 dark:text-gray-100 text-sm">{preview.restaurantName}</span>
          </div>

          <div className="bg-gray-50 dark:bg-gray-900 rounded-lg divide-y divide-gray-100 dark:divide-gray-800">
            {preview.items.map((item, i) => (
              <div key={i} className="flex items-center gap-2 px-3 py-2 text-sm">
                <span>{item.emoji}</span>
                <span className="flex-1 text-gray-700 dark:text-gray-200 truncate">{item.name}</span>
                <span className="text-gray-400 dark:text-gray-500">×{item.quantity}</span>
              </div>
            ))}
          </div>

          <div className="space-y-1.5">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500 dark:text-gray-400">商品合计</span>
              <span className="text-gray-900 dark:text-gray-100">¥{preview.subtotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500 dark:text-gray-400">配送费</span>
              <span className="text-orange-500 font-medium">¥{preview.deliveryFee.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-sm font-bold border-t border-gray-100 dark:border-gray-700 pt-1.5">
              <span className="text-gray-900 dark:text-gray-100">订单总价</span>
              <span className="text-gray-900 dark:text-gray-100">¥{preview.total.toFixed(2)}</span>
            </div>
          </div>
        </div>

        <div className="px-4 pb-8 pt-3 border-t border-gray-100 dark:border-gray-700">
          {errorMessage && (
            <p className="text-red-500 text-xs text-center mb-2">{errorMessage}</p>
          )}
          <button
            className="w-full bg-orange-500 text-white py-3 rounded-2xl font-black active:scale-95 transition-transform disabled:opacity-60"
            onClick={onAccept}
            disabled={disabled}
          >
            {submitting ? '接单中…' : errorMessage ? '换一单看看' : '接单'}
          </button>
        </div>
      </div>
    </>
  );
}
