export interface RiderStatsPosterData {
  completedCount: number;
  totalEarned: number;
  tier: string;
}

interface Props extends RiderStatsPosterData {
  qrDataUrl: string | null;
}

export default function RiderStatsPosterTemplate({
  completedCount,
  totalEarned,
  tier,
  qrDataUrl,
}: Props) {
  return (
    <div className="w-full rounded-2xl overflow-hidden bg-white p-4">
      <div className="text-3xl text-center">🛵</div>
      <p className="text-gray-900 font-black text-center mt-1">我的骑手战绩</p>

      <div className="grid grid-cols-2 gap-2 mt-3">
        <div className="bg-orange-50 rounded-xl py-3 text-center">
          <div className="text-orange-500 font-black text-lg">{completedCount}</div>
          <div className="text-orange-400 text-[11px] mt-0.5">已派送订单</div>
        </div>
        <div className="bg-amber-50 rounded-xl py-3 text-center">
          <div className="text-amber-600 font-black text-lg">¥{totalEarned.toFixed(0)}</div>
          <div className="text-amber-500 text-[11px] mt-0.5">累计获得配送费</div>
        </div>
      </div>

      <div className="flex items-center justify-center gap-2 mt-3 bg-gray-50 rounded-xl px-3 py-2.5">
        <span className="text-lg">🏅</span>
        <p className="text-gray-800 text-sm font-bold">{tier}</p>
      </div>

      <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-100">
        <p className="text-gray-400 text-[11px] leading-tight">
          吃了嘛外卖
          <br />
          真人抢单，说到做到
        </p>
        {qrDataUrl && <img src={qrDataUrl} alt="扫码打开" className="w-14 h-14" />}
      </div>
    </div>
  );
}
