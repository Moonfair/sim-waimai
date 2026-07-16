import { useRef, useState } from 'react';
import type { ReviewDto } from '@sim-waimai/shared';
import { api } from '../lib/api';
import ZoomableImage from './ZoomableImage';
import { uploadImage } from '../lib/upload';

interface Props {
  orderId: string;
  onSubmitted: (review: ReviewDto) => void;
}

const RATING_HINTS = ['', '很差', '较差', '一般', '满意', '超赞'];

export default function ReviewForm({ orderId, onSubmitted }: Props) {
  const [rating, setRating] = useState(5);
  const [content, setContent] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handlePickPhoto = async (file: File | undefined) => {
    if (!file || photos.length >= 9) return;
    setUploading(true);
    setError(null);
    try {
      const url = await uploadImage(file, 'review');
      setPhotos((p) => [...p, url]);
    } catch (err) {
      setError(err instanceof Error ? err.message : '图片上传失败');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const review = await api.post<ReviewDto>(`/orders/${orderId}/reviews`, {
        rating,
        content: content.trim(),
        photos,
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
      {/* Photos */}
      <div className="flex items-center gap-2 mt-3 flex-wrap">
        {photos.map((photo) => (
          <div key={photo} className="relative">
            <ZoomableImage src={photo} alt="评价图片" className="w-14 h-14 rounded-lg object-cover" />
            <button
              className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-gray-800/80 text-white rounded-full text-[10px] leading-none flex items-center justify-center"
              onClick={() => setPhotos((p) => p.filter((x) => x !== photo))}
              aria-label="删除图片"
            >
              ✕
            </button>
          </div>
        ))}
        {photos.length < 9 && (
          <button
            className="w-14 h-14 rounded-lg border border-dashed border-gray-200 dark:border-gray-700 text-gray-300 dark:text-gray-600 text-xl disabled:opacity-50"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
            aria-label="添加图片"
          >
            {uploading ? '…' : '📷'}
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => handlePickPhoto(e.target.files?.[0])}
        />
      </div>
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
