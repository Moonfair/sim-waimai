import { useState } from 'react';
import type { ReviewDto } from '@sim-waimai/shared';
import { api } from '../lib/api';

interface Props {
  orderId: string;
  onSubmitted: (review: ReviewDto) => void;
}

const RATING_HINTS = ['', '很差', '较差', '一般', '满意', '超赞'];

export default function ReviewForm({ orderId, onSubmitted }: Props) {
  const [rating, setRating] = useState(5);
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const review = await api.post<ReviewDto>(`/orders/${orderId}/reviews`, {
        rating,
        content: content.trim(),
      });
      onSubmitted(review);
    } catch (err) {
      setError(err instanceof Error ? err.message : '提交失败，请稍后重试');
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl p-4 shadow-sm">
      <h3 className="font-bold text-gray-900 dark:text-gray-100 text-sm mb-3">评价本单</h3>
      <div className="flex items-center gap-2">
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              className={`text-2xl transition-transform active:scale-125 ${
                n <= rating ? '' : 'grayscale opacity-40'
              }`}
              onClick={() => setRating(n)}
              aria-label={`${n}星`}
            >
              ⭐
            </button>
          ))}
        </div>
        <span className="text-orange-500 text-sm font-medium">{RATING_HINTS[rating]}</span>
      </div>
      <textarea
        className="w-full mt-3 border border-gray-100 dark:border-gray-700 dark:bg-gray-900 rounded-lg p-2.5 text-sm text-gray-600 dark:text-gray-300 resize-none outline-none focus:border-orange-300"
        rows={3}
        maxLength={500}
        placeholder="说说这顿（假）外卖怎么样吧～"
        value={content}
        onChange={(e) => setContent(e.target.value)}
      />
      {error && <p className="text-red-500 text-xs mt-1">{error}</p>}
      <button
        className="w-full mt-3 bg-orange-500 text-white py-3 rounded-xl font-bold text-sm disabled:opacity-50"
        disabled={submitting}
        onClick={handleSubmit}
      >
        {submitting ? '提交中…' : '提交评价'}
      </button>
    </div>
  );
}
