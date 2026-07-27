import { assetUrl } from '../../lib/assetUrl';

export interface RestaurantPosterData {
  name: string;
  emoji: string;
  bgColor: string;
  bannerImage?: string;
  rating: number;
  ratingCount: number;
  monthlyOrders: number;
  tags: string[];
}

interface Props extends RestaurantPosterData {
  qrDataUrl: string | null;
}

export default function RestaurantPosterTemplate({
  name,
  emoji,
  bgColor,
  bannerImage,
  rating,
  ratingCount,
  monthlyOrders,
  tags,
  qrDataUrl,
}: Props) {
  return (
    <div className="w-full rounded-2xl overflow-hidden bg-white">
      <div
        className="h-36 flex flex-col items-center justify-center relative"
        style={!bannerImage ? { background: `linear-gradient(135deg, ${bgColor}ee, ${bgColor}88)` } : undefined}
      >
        {bannerImage && (
          <img
            src={assetUrl(bannerImage)}
            alt={name}
            className="absolute inset-0 w-full h-full object-cover"
          />
        )}
        {!bannerImage && <span className="text-5xl drop-shadow relative z-10">{emoji}</span>}
      </div>

      <div className="p-4">
        <p className="text-gray-900 font-black text-lg">{name}</p>
        <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
          <span>⭐ {rating}（{ratingCount}）</span>
          <span>·</span>
          <span>月售 {monthlyOrders}</span>
        </div>

        {tags.length > 0 && (
          <div className="flex gap-1.5 mt-2 flex-wrap">
            {tags.slice(0, 3).map((tag) => (
              <span key={tag} className="text-[11px] px-2 py-0.5 bg-orange-50 text-orange-500 rounded-full border border-orange-100">
                {tag}
              </span>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-100">
          <p className="text-gray-400 text-[11px] leading-tight">
            朋友推荐
            <br />
            吃了嘛外卖
          </p>
          {qrDataUrl && <img src={qrDataUrl} alt="扫码打开" className="w-14 h-14" />}
        </div>
      </div>
    </div>
  );
}
