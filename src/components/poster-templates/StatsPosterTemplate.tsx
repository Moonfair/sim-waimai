export interface StatsPosterData {
  totalOrders: number;
  totalSaved: number;
  totalCalories: number;
  topRestaurantName?: string;
  topRestaurantEmoji?: string;
}

interface Props extends StatsPosterData {
  qrDataUrl: string | null;
}

export default function StatsPosterTemplate({
  totalOrders,
  totalSaved,
  totalCalories,
  topRestaurantName,
  topRestaurantEmoji,
  qrDataUrl,
}: Props) {
  return (
    <div className="w-full rounded-2xl overflow-hidden bg-white p-4">
      <div className="text-3xl text-center">🏆</div>
      <p className="text-gray-900 font-black text-center mt-1">我的吃了嘛战绩</p>

      <div className="grid grid-cols-3 gap-2 mt-3">
        <div className="bg-orange-50 rounded-xl py-3 text-center">
          <div className="text-orange-500 font-black text-lg">{totalOrders}</div>
          <div className="text-orange-400 text-[11px] mt-0.5">总点单数</div>
        </div>
        <div className="bg-amber-50 rounded-xl py-3 text-center">
          <div className="text-amber-600 font-black text-lg">¥{totalSaved.toFixed(0)}</div>
          <div className="text-amber-500 text-[11px] mt-0.5">省下的钱</div>
        </div>
        <div className="bg-red-50 rounded-xl py-3 text-center">
          <div className="text-red-500 font-black text-lg">{totalCalories}</div>
          <div className="text-red-400 text-[11px] mt-0.5">省下的卡路里</div>
        </div>
      </div>

      {topRestaurantName && (
        <div className="flex items-center gap-2 mt-3 bg-gray-50 rounded-xl px-3 py-2.5">
          <span className="text-lg">{topRestaurantEmoji}</span>
          <p className="text-gray-800 text-sm font-medium truncate">
            最常点｜{topRestaurantName}
          </p>
        </div>
      )}

      <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-100">
        <p className="text-gray-400 text-[11px] leading-tight">
          吃了嘛外卖
          <br />
          省钱又省卡路里的假外卖APP
        </p>
        {qrDataUrl && <img src={qrDataUrl} alt="扫码打开" className="w-14 h-14" />}
      </div>
    </div>
  );
}
