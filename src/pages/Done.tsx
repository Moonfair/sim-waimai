import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCart } from '../context/CartContext';

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

function NumberCounter({ target, prefix = '', suffix = '', decimals = 0 }: {
  target: number;
  prefix?: string;
  suffix?: string;
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
  return <span>{prefix}{display}{suffix}</span>;
}

export default function Done() {
  const [confetti] = useState(() => generateConfetti(40));
  const [showContent, setShowContent] = useState(false);
  const [copied, setCopied] = useState(false);
  const { totalPrice, totalCalories, restaurant, clearCart } = useCart();
  const navigate = useNavigate();

  const savedPrice = totalPrice + (restaurant?.deliveryFee ?? 5);
  const savedCalories = totalCalories;
  const kmEquivalent = (savedCalories / 60).toFixed(0);
  const waterEquivalent = Math.round(savedPrice / 2);

  useEffect(() => {
    const t = setTimeout(() => setShowContent(true), 400);
    return () => clearTimeout(t);
  }, []);

  const handleShareClick = async () => {
    try {
      const homeUrl = window.location.origin + import.meta.env.BASE_URL;
      await navigator.clipboard.writeText('我用【吃了嘛外卖】省下了 ¥' + savedPrice.toFixed(2) + ' 元和 ' + savedCalories + ' 千卡！快来试试这款假外卖APP！\n' + homeUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="app-container bg-white dark:bg-gray-900 overflow-hidden relative flex flex-col min-h-screen">
      {/* Confetti */}
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

      {/* Content */}
      <div
        className="flex flex-col items-center justify-start pt-20 px-6 pb-10 flex-1"
        style={{
          opacity: showContent ? 1 : 0,
          transform: showContent ? 'translateY(0)' : 'translateY(20px)',
          transition: 'opacity 0.6s ease, transform 0.6s ease',
        }}
      >
        {/* Trophy */}
        <div className="text-8xl mb-4" style={{ animation: 'pulse-scale 2s ease-in-out infinite' }}>
          🏆
        </div>

        <h1 className="text-2xl font-black text-gray-900 dark:text-gray-100 text-center">
          恭喜你，成功节省了！
        </h1>
        <p className="text-gray-400 dark:text-gray-500 text-sm text-center mt-1">
          这次假外卖挑战，你超棒！
        </p>

        {/* Savings cards */}
        <div className="w-full mt-8 grid grid-cols-2 gap-3">
          <div className="bg-orange-50 dark:bg-orange-500/10 rounded-2xl p-5 text-center border border-orange-100 dark:border-orange-500/20">
            <div className="text-3xl mb-2">💰</div>
            <div className="text-orange-500 font-black text-2xl">
              {showContent && <NumberCounter target={savedPrice} prefix="¥" decimals={2} />}
            </div>
            <p className="text-orange-400 text-xs mt-1 font-medium">省下的钱</p>
          </div>
          <div className="bg-red-50 dark:bg-red-500/10 rounded-2xl p-5 text-center border border-red-100 dark:border-red-500/20">
            <div className="text-3xl mb-2">🔥</div>
            <div className="text-red-500 font-black text-2xl">
              {showContent && <NumberCounter target={savedCalories} suffix=" kcal" />}
            </div>
            <p className="text-red-400 text-xs mt-1 font-medium">少摄入热量</p>
          </div>
        </div>

        {/* Motivation text */}
        <div className="bg-gray-50 dark:bg-gray-800 rounded-2xl p-4 w-full mt-4">
          <p className="text-gray-600 dark:text-gray-300 text-sm text-center leading-relaxed">
            省下的 <strong className="text-orange-500">¥{savedPrice.toFixed(2)}</strong> 可以买{' '}
            <strong className="text-blue-500">{waterEquivalent} 瓶矿泉水</strong>
            <br />
            节省的热量相当于慢跑{' '}
            <strong className="text-green-500">{kmEquivalent} 分钟</strong> 🏃
          </p>
        </div>

        {/* Buttons */}
        <div className="w-full mt-6 space-y-3">
          <button
            className="w-full bg-orange-500 text-white py-4 rounded-2xl font-black text-lg shadow-lg active:scale-95 transition-transform"
            onClick={() => { clearCart(); navigate('/'); }}
          >
            再省一次 💪
          </button>
          <button
            className="w-full border-2 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 py-3.5 rounded-2xl font-bold text-base active:scale-95 transition-transform relative"
            onClick={handleShareClick}
          >
            {copied ? '✅ 已复制到剪贴板！' : '分享给朋友 🎉'}
          </button>
        </div>

        {/* Footer */}
        <p className="text-gray-300 dark:text-gray-600 text-xs text-center mt-6 leading-relaxed">
          吃了嘛外卖 · 节省外卖费和卡路里的假外卖APP
          <br />
          你的钱包和腰围都感谢你 ❤️
        </p>
      </div>
    </div>
  );
}
