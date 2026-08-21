import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { getRandomRider } from '../data/riders';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faLocationDot, faCheck } from '@fortawesome/free-solid-svg-icons';

const TOTAL_SECONDS = 30;

interface RiderTrackingState {
  orderId?: string;
  restaurantName?: string;
  restaurantEmoji?: string;
  deliveryFee?: number;
}

export default function RiderTracking() {
  const [secondsLeft, setSecondsLeft] = useState(TOTAL_SECONDS);
  const [progressStep, setProgressStep] = useState(1);
  const [rider] = useState(getRandomRider); // vehicle emoji for the map animation only
  const riderRef = useRef<HTMLDivElement>(null);
  const finishedRef = useRef(false);
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as RiderTrackingState | null;
  const orderId = state?.orderId;
  const restaurantName = state?.restaurantName ?? '这家店';
  const restaurantEmoji = state?.restaurantEmoji ?? '🍔';
  const deliveryFee = state?.deliveryFee ?? 0;

  useEffect(() => {
    if (!orderId) navigate('/', { replace: true });
  }, [orderId, navigate]);

  const finishDelivery = () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    const done = () => navigate('/rider-done', { state: { orderId, deliveryFee } });
    if (orderId) {
      // Independently drives completion — doesn't wait on or check what the buyer's own
      // Tracking page is doing; if they already completed it first this just 400s harmlessly.
      api.patch(`/orders/${orderId}/status`, { status: 'completed' }).catch(() => {}).finally(done);
    } else {
      done();
    }
  };

  useEffect(() => {
    const interval = setInterval(() => {
      setSecondsLeft(s => {
        if (s <= 1) {
          clearInterval(interval);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const elapsed = TOTAL_SECONDS - secondsLeft;
    if (elapsed >= 8 && progressStep < 2) setProgressStep(2);
    if (elapsed >= 18 && progressStep < 3) setProgressStep(3);
    if (elapsed >= 26 && progressStep < 4) setProgressStep(4);
    if (secondsLeft === 0) {
      setTimeout(finishDelivery, 2000);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondsLeft, progressStep]);

  const progressSteps = [
    { label: '接单', done: progressStep >= 1 },
    { label: '取餐', done: progressStep >= 2 },
    { label: '配送中', done: progressStep >= 3 },
    { label: '即将送达', done: progressStep >= 4 },
  ];

  return (
    <div className="app-container bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 px-4 pt-10 pb-4 border-b border-gray-100 dark:border-gray-700">
        <h1 className="text-gray-900 dark:text-gray-100 font-bold text-lg">配送中</h1>
        <p className="text-gray-400 dark:text-gray-500 text-sm mt-0.5">
          {secondsLeft > 0 ? `正在为 TA 配送，预计 ${secondsLeft} 秒后送达` : '即将送达…'}
        </p>
      </div>

      {/* Map */}
      <div
        className="relative overflow-hidden"
        style={{ height: '260px', background: '#2d4a3e' }}
      >
        {[...Array(6)].map((_, i) => (
          <div
            key={`h${i}`}
            className="absolute left-0 right-0 bg-gray-700/40"
            style={{ top: `${15 + i * 15}%`, height: '2px' }}
          />
        ))}
        {[...Array(8)].map((_, i) => (
          <div
            key={`v${i}`}
            className="absolute top-0 bottom-0 bg-gray-700/40"
            style={{ left: `${5 + i * 13}%`, width: '2px' }}
          />
        ))}

        {[
          { top: '10%', left: '8%', w: 36, h: 44 },
          { top: '10%', left: '22%', w: 48, h: 36 },
          { top: '52%', left: '8%', w: 40, h: 38 },
          { top: '55%', left: '32%', w: 32, h: 30 },
          { top: '12%', left: '62%', w: 44, h: 40 },
          { top: '54%', left: '65%', w: 36, h: 36 },
          { top: '10%', left: '80%', w: 40, h: 48 },
          { top: '52%', left: '80%', w: 36, h: 34 },
        ].map((b, i) => (
          <div
            key={i}
            className="absolute rounded-sm"
            style={{
              top: b.top, left: b.left,
              width: b.w, height: b.h,
              background: `rgba(${80 + i * 8}, ${100 + i * 5}, ${80 + i * 6}, 0.7)`,
            }}
          />
        ))}

        <div className="absolute text-2xl text-orange-500" style={{ left: '12%', top: '32%' }}>
          <FontAwesomeIcon icon={faLocationDot} />
        </div>

        <div
          ref={riderRef}
          className="rider-icon"
          style={{ animationDuration: `${TOTAL_SECONDS}s` }}
        >
          {rider.vehicleEmoji}
        </div>

        <div className="absolute top-3 right-3 bg-black/60 backdrop-blur-sm rounded-xl px-3 py-2 text-center">
          <div className="text-white font-black text-xl">{secondsLeft}</div>
          <div className="text-gray-300 text-xs">秒</div>
        </div>
      </div>

      {/* Progress steps */}
      <div className="bg-white dark:bg-gray-800 mx-4 mt-4 rounded-2xl p-4">
        <div className="flex items-center justify-between">
          {progressSteps.map((s, i) => (
            <div key={s.label} className="flex items-center">
              <div className="flex flex-col items-center">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold transition-colors ${
                  s.done ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-400 dark:bg-gray-700 dark:text-gray-500'
                }`}>
                  {s.done ? <FontAwesomeIcon icon={faCheck} /> : i + 1}
                </div>
                <span className={`text-xs mt-1 font-medium ${s.done ? 'text-orange-500' : 'text-gray-400 dark:text-gray-500'}`}>
                  {s.label}
                </span>
              </div>
              {i < progressSteps.length - 1 && (
                <div className={`w-10 h-0.5 mx-1 mb-4 transition-colors ${
                  progressSteps[i + 1].done ? 'bg-orange-500' : 'bg-gray-200 dark:bg-gray-700'
                }`} />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Order info */}
      <div className="bg-white dark:bg-gray-800 mx-4 mt-3 rounded-2xl p-4 flex items-center gap-3">
        <div className="text-3xl">{restaurantEmoji}</div>
        <div className="flex-1">
          <p className="font-medium text-gray-900 dark:text-gray-100 text-sm">{restaurantName}</p>
          <p className="text-gray-400 dark:text-gray-500 text-xs">您已取餐，正在为 TA 配送</p>
        </div>
        <div className="text-right">
          <p className="text-orange-500 font-bold text-sm">¥{deliveryFee.toFixed(2)}</p>
          <p className="text-gray-300 dark:text-gray-600 text-[10px]">配送费</p>
        </div>
      </div>

      {/* CTA */}
      <div className="px-4 mt-4 pb-8">
        <button
          className="w-full border-2 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 py-4 rounded-2xl font-bold text-base active:scale-95 transition-transform"
          onClick={finishDelivery}
        >
          提前送达
        </button>
      </div>
    </div>
  );
}
