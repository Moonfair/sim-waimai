import { useEffect, useState, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faSackDollar } from '@fortawesome/free-solid-svg-icons';

interface Confetti {
  id: number;
  x: number;
  color: string;
  delay: number;
  duration: number;
  shape: 'rect' | 'circle';
  size: number;
}

function generateConfetti(count: number): Confetti[] {
  const colors = ['#ff6200', '#ffd700', '#ff69b4', '#00bcd4', '#4caf50', '#9c27b0', '#ff5722'];
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    x: Math.random() * 100,
    color: colors[Math.floor(Math.random() * colors.length)],
    delay: Math.random() * 2,
    duration: 2 + Math.random() * 2,
    shape: Math.random() > 0.5 ? 'rect' : 'circle',
    size: 6 + Math.random() * 8,
  }));
}

function NumberCounter({ target, prefix = '', decimals = 0 }: {
  target: number;
  prefix?: string;
  decimals?: number;
}) {
  const [current, setCurrent] = useState(0);
  const startTime = useRef<number | null>(null);
  const duration = 1500;

  useEffect(() => {
    const animate = (ts: number) => {
      if (!startTime.current) startTime.current = ts;
      const progress = Math.min((ts - startTime.current) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setCurrent(eased * target);
      if (progress < 1) requestAnimationFrame(animate);
    };
    const raf = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf);
  }, [target]);

  const display = decimals > 0 ? current.toFixed(decimals) : Math.round(current).toString();
  return <span>{prefix}{display}</span>;
}

export default function RiderDone() {
  const [confetti] = useState(() => generateConfetti(40));
  const [showContent, setShowContent] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as { orderId?: string; deliveryFee?: number } | null;
  const deliveryFee = state?.deliveryFee ?? 0;

  useEffect(() => {
    const t = setTimeout(() => setShowContent(true), 400);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="app-container bg-white dark:bg-gray-900 overflow-x-hidden relative flex flex-col min-h-screen">
      {confetti.map(c => (
        <div
          key={c.id}
          className="confetti-piece"
          style={{
            left: `${c.x}%`,
            top: '-20px',
            background: c.color,
            width: c.size,
            height: c.shape === 'rect' ? c.size * 0.6 : c.size,
            borderRadius: c.shape === 'circle' ? '50%' : '2px',
            animation: `confetti-${(c.id % 3) + 1} ${c.duration}s ${c.delay}s ease-in forwards`,
          }}
        />
      ))}

      <div
        className="flex flex-col items-center justify-start pt-20 px-6 pb-10 flex-1 lg:max-w-lg lg:mx-auto"
        style={{
          opacity: showContent ? 1 : 0,
          transform: showContent ? 'translateY(0)' : 'translateY(20px)',
          transition: 'opacity 0.6s ease, transform 0.6s ease',
        }}
      >
        <div className="text-8xl mb-4" style={{ animation: 'pulse-scale 2s ease-in-out infinite' }}>
          🛵
        </div>

        <h1 className="text-2xl font-black text-gray-900 dark:text-gray-100 text-center">
          配送完成！
        </h1>
        <p className="text-gray-400 dark:text-gray-500 text-sm text-center mt-1">
          辛苦啦，这单顺利送达
        </p>

        <div className="w-full mt-8">
          <div className="bg-orange-50 dark:bg-orange-500/10 rounded-2xl p-6 text-center border border-orange-100 dark:border-orange-500/20">
            <div className="text-3xl mb-2 text-orange-500"><FontAwesomeIcon icon={faSackDollar} /></div>
            <div className="text-orange-500 font-black text-3xl">
              {showContent && <NumberCounter target={deliveryFee} prefix="¥" decimals={2} />}
            </div>
            <p className="text-orange-400 text-xs mt-1 font-medium">本单赚到</p>
          </div>
        </div>

        <div className="w-full mt-6 space-y-3">
          <button
            className="w-full bg-orange-500 text-white py-4 rounded-2xl font-black text-lg shadow-lg active:scale-95 transition-transform"
            onClick={() => navigate('/')}
          >
            继续抢单 🚴
          </button>
          <button
            className="w-full border-2 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 py-3.5 rounded-2xl font-bold text-base active:scale-95 transition-transform"
            onClick={() => navigate('/rider-stats')}
          >
            查看骑手统计
          </button>
        </div>

        <p className="text-gray-300 dark:text-gray-600 text-xs text-center mt-6 leading-relaxed">
          吃了嘛外卖 · 抢单大厅
          <br />
          真人抢单，说到做到 ❤️
        </p>
      </div>
    </div>
  );
}
