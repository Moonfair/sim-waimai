import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCart } from '../context/CartContext';

const steps = [
  { icon: '🔄', text: '正在联系商家...', subtext: '商家确认中，请稍候' },
  { icon: '✅', text: '商家已接单！', subtext: '商家开始为您精心备餐' },
  { icon: '🏍️', text: '骑手已接单', subtext: '骑手马上出发，即将到您门口' },
];

export default function Order() {
  const [step, setStep] = useState(0);
  const navigate = useNavigate();
  const { restaurant } = useCart();

  useEffect(() => {
    const timers = [
      setTimeout(() => setStep(1), 1500),
      setTimeout(() => setStep(2), 3000),
      setTimeout(() => navigate('/tracking'), 4500),
    ];
    return () => timers.forEach(clearTimeout);
  }, [navigate]);

  const current = steps[step];

  return (
    <div className="app-container flex flex-col items-center justify-center h-screen bg-white">
      {/* Progress dots */}
      <div className="flex gap-2 mb-10">
        {steps.map((_, i) => (
          <div
            key={i}
            className={`h-1.5 rounded-full transition-all duration-500 ${
              i <= step ? 'bg-orange-500 w-8' : 'bg-gray-200 w-4'
            }`}
          />
        ))}
      </div>

      {/* Icon */}
      <div
        key={step}
        className="text-8xl mb-6 fade-in-up"
        style={{ animation: 'fade-in-up 0.4s ease-out' }}
      >
        {current.icon}
      </div>

      {/* Text */}
      <h2
        key={`text-${step}`}
        className="text-2xl font-black text-gray-900 fade-in-up"
        style={{ animation: 'fade-in-up 0.4s ease-out 0.1s both' }}
      >
        {current.text}
      </h2>
      <p
        key={`sub-${step}`}
        className="text-gray-400 text-sm mt-2 fade-in-up"
        style={{ animation: 'fade-in-up 0.4s ease-out 0.2s both' }}
      >
        {current.subtext}
      </p>

      {restaurant && (
        <div className="mt-10 bg-orange-50 rounded-2xl p-4 w-64 text-center">
          <div className="text-3xl mb-1">{restaurant.emoji}</div>
          <p className="text-orange-600 font-medium text-sm">{restaurant.name}</p>
          <p className="text-gray-400 text-xs mt-1">正在准备您的（假）外卖</p>
        </div>
      )}

      {/* Pulse dots */}
      <div className="flex gap-1.5 mt-10">
        {[0, 1, 2].map(i => (
          <div
            key={i}
            className="w-2 h-2 bg-orange-400 rounded-full"
            style={{ animation: `pulse 1.4s ease-in-out ${i * 0.2}s infinite` }}
          />
        ))}
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { transform: scale(0.8); opacity: 0.5; }
          50% { transform: scale(1.2); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
