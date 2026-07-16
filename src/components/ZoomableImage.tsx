import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { assetUrl } from '../lib/assetUrl';

interface ZoomableImageProps {
  /** 原始图片 path（COS key、绝对 URL、blob:/data: 或 /api/ 路径），内部用 assetUrl() 解析 */
  src: string;
  alt: string;
  /** 缩略图 <img> 的样式，与替换前的 <img> 保持一致 */
  className?: string;
}

/** <img> 的 drop-in 替代：点击图片弹出全屏放大预览，点遮罩 / × / Esc 关闭。
 *  点击事件 stopPropagation，不触发所在卡片的跳转/加购。 */
export default function ZoomableImage({ src, alt, className }: ZoomableImageProps) {
  const [open, setOpen] = useState(false);
  const url = assetUrl(src);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  return (
    <>
      <img
        src={url}
        alt={alt}
        className={`cursor-zoom-in ${className ?? ''}`}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
      />
      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
            }}
          >
            <img src={url} alt={alt} className="max-w-[90vw] max-h-[85vh] object-contain rounded-lg" />
            {/* 点击冒泡到遮罩层统一关闭，无需自己的 onClick */}
            <button
              className="absolute top-10 right-4 w-9 h-9 bg-white/10 rounded-full flex items-center justify-center text-white text-lg"
              aria-label="关闭预览"
            >
              ✕
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}
