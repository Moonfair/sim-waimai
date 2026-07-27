export interface OrderPosterData {
  restaurantName: string;
  restaurantEmoji: string;
  restaurantBgColor: string;
  savedPrice: number;
  savedCalories: number;
}

interface Props extends OrderPosterData {
  qrDataUrl: string | null;
}

export default function OrderPosterTemplate({
  restaurantName,
  restaurantEmoji,
  restaurantBgColor,
  savedPrice,
  savedCalories,
  qrDataUrl,
}: Props) {
  return (
    <div className="w-full rounded-2xl overflow-hidden bg-white">
      <div
        className="h-28 flex flex-col items-center justify-center"
        style={{ background: `linear-gradient(135deg, ${restaurantBgColor}ee, ${restaurantBgColor}88)` }}
      >
        <span className="text-4xl drop-shadow">{restaurantEmoji}</span>
        <span className="text-white font-black text-base mt-1 drop-shadow">{restaurantName}</span>
      </div>

      <div className="p-4">
        <div className="text-3xl text-center">🏆</div>
        <p className="text-gray-900 font-black text-center mt-1">恭喜你，成功省下了！</p>

        <div className="grid grid-cols-2 gap-2 mt-3">
          <div className="bg-orange-50 rounded-xl p-3 text-center border border-orange-100">
            <div className="text-xl">💰</div>
            <div className="text-orange-500 font-black text-lg">¥{savedPrice.toFixed(2)}</div>
            <p className="text-orange-400 text-[11px] mt-0.5">省下的钱</p>
          </div>
          <div className="bg-red-50 rounded-xl p-3 text-center border border-red-100">
            <div className="text-xl">🔥</div>
            <div className="text-red-500 font-black text-lg">{savedCalories} kcal</div>
            <p className="text-red-400 text-[11px] mt-0.5">少摄入热量</p>
          </div>
        </div>

        <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-100">
          <p className="text-gray-400 text-[11px] leading-tight">
            吃了嘛外卖
            <br />
            省钱又省卡路里的假外卖APP
          </p>
          {qrDataUrl && <img src={qrDataUrl} alt="扫码打开" className="w-14 h-14" />}
        </div>
      </div>
    </div>
  );
}
