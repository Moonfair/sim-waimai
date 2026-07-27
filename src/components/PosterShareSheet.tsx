import { useEffect, useRef, useState } from 'react';
import { capturePosterImage, generateQrCodeDataUrl, savePosterImage } from '../lib/poster';
import { copyLink } from '../lib/share';
import OrderPosterTemplate, { type OrderPosterData } from './poster-templates/OrderPosterTemplate';
import RestaurantPosterTemplate, { type RestaurantPosterData } from './poster-templates/RestaurantPosterTemplate';
import StatsPosterTemplate, { type StatsPosterData } from './poster-templates/StatsPosterTemplate';

export type PosterPayload =
  | { type: 'order'; data: OrderPosterData }
  | { type: 'restaurant'; data: RestaurantPosterData }
  | { type: 'stats'; data: StatsPosterData };

interface Props {
  payload: PosterPayload;
  linkUrl: string;
  onClose: () => void;
}

export default function PosterShareSheet({ payload, linkUrl, onClose }: Props) {
  const posterRef = useRef<HTMLDivElement>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');

  useEffect(() => {
    let cancelled = false;
    generateQrCodeDataUrl(linkUrl).then((url) => {
      if (!cancelled) setQrDataUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [linkUrl]);

  const handleCopy = async () => {
    const ok = await copyLink(linkUrl);
    setCopyState(ok ? 'copied' : 'failed');
    setTimeout(() => setCopyState('idle'), 2000);
  };

  const handleSave = async () => {
    if (!posterRef.current) return;
    setSaveState('saving');
    try {
      const blob = await capturePosterImage(posterRef.current);
      savePosterImage(blob, `吃了嘛外卖-分享海报-${Date.now()}.png`);
      setSaveState('saved');
    } catch {
      setSaveState('failed');
    }
    setTimeout(() => setSaveState('idle'), 2000);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[340px] max-h-[90vh] overflow-y-auto bg-white dark:bg-gray-800 rounded-2xl p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-end -mt-1 -mr-1">
          <button
            className="w-7 h-7 flex items-center justify-center text-gray-400 dark:text-gray-500 text-lg"
            onClick={onClose}
            aria-label="关闭"
          >
            ×
          </button>
        </div>

        <div ref={posterRef}>
          {payload.type === 'order' && <OrderPosterTemplate {...payload.data} qrDataUrl={qrDataUrl} />}
          {payload.type === 'restaurant' && <RestaurantPosterTemplate {...payload.data} qrDataUrl={qrDataUrl} />}
          {payload.type === 'stats' && <StatsPosterTemplate {...payload.data} qrDataUrl={qrDataUrl} />}
        </div>

        <p className="text-gray-400 dark:text-gray-500 text-xs text-center mt-3">长按图片也可保存</p>

        <div className="grid grid-cols-2 gap-3 mt-3">
          <button
            className="py-3 rounded-2xl font-bold text-sm active:scale-95 transition-transform border-2 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300"
            onClick={handleCopy}
          >
            {copyState === 'copied' ? '已复制 ✓' : copyState === 'failed' ? '复制失败 ✕' : '复制链接'}
          </button>
          <button
            className="py-3 rounded-2xl font-bold text-sm active:scale-95 transition-transform bg-orange-500 text-white disabled:opacity-60"
            onClick={handleSave}
            disabled={saveState === 'saving'}
          >
            {saveState === 'saving'
              ? '生成中…'
              : saveState === 'saved'
                ? '已保存 ✓'
                : saveState === 'failed'
                  ? '保存失败 ✕'
                  : '保存到本地'}
          </button>
        </div>
      </div>
    </div>
  );
}
