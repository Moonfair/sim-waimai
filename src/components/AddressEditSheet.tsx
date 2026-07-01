import { useState } from 'react';
import { useAddress } from '../context/AddressContext';
import type { AddressInfo } from '../context/AddressContext';

interface Props {
  onClose: () => void;
}

export default function AddressEditSheet({ onClose }: Props) {
  const { addressInfo, setAddressInfo } = useAddress();
  const [draft, setDraft] = useState<AddressInfo>(addressInfo);

  const handleSave = () => {
    setAddressInfo(draft);
    onClose();
  };

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/40" onClick={onClose} />
      <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[480px] z-50 bg-white rounded-t-2xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-gray-50">
          <span className="font-bold text-gray-900 text-sm">收货信息</span>
          <button
            className="w-7 h-7 flex items-center justify-center text-gray-400 text-lg"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          <div>
            <label className="text-xs text-gray-500 block mb-1">收件人</label>
            <input
              type="text"
              className="w-full border border-gray-100 rounded-lg p-2.5 text-sm text-gray-700 outline-none focus:border-orange-300"
              placeholder="请填写收件人姓名"
              value={draft.recipientName}
              onChange={(e) => setDraft({ ...draft, recipientName: e.target.value })}
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">手机号</label>
            <input
              type="tel"
              className="w-full border border-gray-100 rounded-lg p-2.5 text-sm text-gray-700 outline-none focus:border-orange-300"
              placeholder="请填写手机号"
              value={draft.phone}
              onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">收货地址</label>
            <textarea
              className="w-full border border-gray-100 rounded-lg p-2.5 text-sm text-gray-700 resize-none outline-none focus:border-orange-300"
              rows={2}
              placeholder="请填写详细收货地址"
              value={draft.address}
              onChange={(e) => setDraft({ ...draft, address: e.target.value })}
            />
          </div>
        </div>

        <div className="px-4 pb-8 pt-3 border-t border-gray-100">
          <p className="text-gray-300 text-xs text-center mb-2">
            以上信息仅保存在本机浏览器中，不会上传到任何服务器
          </p>
          <button
            className="w-full bg-orange-500 text-white py-3 rounded-2xl font-black active:scale-95 transition-transform"
            onClick={handleSave}
          >
            保存
          </button>
        </div>
      </div>
    </>
  );
}
