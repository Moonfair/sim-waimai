import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faTruckFast } from '@fortawesome/free-solid-svg-icons';
import type { RiderHallOrderPreviewDto } from '@sim-waimai/shared';
import { useRiderHall } from '../context/RiderHallContext';
import RiderHallPreviewSheet from './RiderHallPreviewSheet';

/** Floating "抢单" bubble, visible on every page whenever 抢单大厅 has orders waiting.
 *  Positioned against the app's centered content column (480px on mobile/tablet,
 *  1200px on desktop — see .app-container in index.css), not the raw browser
 *  viewport edge, so it lines up with the rest of the UI on wide screens. */
export default function GrabOrderBubble() {
  const { pendingCount, cooldownActive, previewLatest, acceptOrder } = useRiderHall();
  const [toast, setToast] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [preview, setPreview] = useState<RiderHallOrderPreviewDto | null>(null);
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  if (pendingCount <= 0) return null;

  const showToast = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 2000);
  };

  const handleBubbleClick = async () => {
    if (previewLoading) return;
    setPreviewLoading(true);
    const result = await previewLatest();
    setPreviewLoading(false);
    if (result.ok) {
      setAcceptError(null);
      setPreview(result.preview);
    } else {
      showToast(result.reason === 'empty' ? '手慢了，暂无待接订单' : '加载失败，请重试');
    }
  };

  const handleAccept = async () => {
    if (!preview) return;
    setSubmitting(true);
    const result = await acceptOrder(preview.id);
    setSubmitting(false);
    if (result.ok) {
      const { id, restaurantName, restaurantEmoji, deliveryFee } = result.result;
      setPreview(null);
      navigate('/rider-tracking', { state: { orderId: id, restaurantName, restaurantEmoji, deliveryFee } });
    } else {
      setAcceptError(result.reason === 'taken' ? '这单已经被抢走了' : '接单失败，请重试');
    }
  };

  return (
    <>
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-full max-w-[480px] lg:max-w-[1200px] h-full pointer-events-none z-40">
        <button
          className="pointer-events-auto absolute right-3 bottom-28 w-14 h-14 rounded-full bg-orange-500 text-white shadow-lg flex items-center justify-center active:scale-95 transition-transform disabled:opacity-50"
          disabled={previewLoading}
          onClick={handleBubbleClick}
          aria-label="抢单"
        >
          <FontAwesomeIcon icon={faTruckFast} className="text-xl" />
          <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 bg-red-500 text-white text-[10px] rounded-full flex items-center justify-center">
            {pendingCount}
          </span>
        </button>
        {toast && (
          <div className="pointer-events-none absolute right-3 bottom-44 bg-black/70 text-white text-xs px-3 py-1.5 rounded-lg whitespace-nowrap">
            {toast}
          </div>
        )}
      </div>

      {preview && (
        <RiderHallPreviewSheet
          preview={preview}
          onAccept={handleAccept}
          onClose={() => setPreview(null)}
          submitting={submitting}
          disabled={submitting || cooldownActive}
          errorMessage={acceptError}
        />
      )}
    </>
  );
}
