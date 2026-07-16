import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { MerchantMenuItemDto, MerchantRestaurantDto } from '@sim-waimai/shared';
import MenuItemEditor from '../components/MenuItemEditor';
import { useApi } from '../hooks/useApi';
import { api } from '../lib/api';
import { assetUrl } from '../lib/assetUrl';
import { copyRestaurantLink } from '../lib/share';
import { uploadImage } from '../lib/upload';

const inputClass =
  'w-full px-3 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-orange-400 text-sm';

export default function MerchantEdit() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: shop, loading, error, reload } = useApi<MerchantRestaurantDto>(
    id ? `/merchant/restaurants/${id}` : null,
  );
  const [info, setInfo] = useState({ name: '', deliveryFee: '', minOrder: '', deliveryTime: '', menuCategories: '', tags: '' });
  const [savingInfo, setSavingInfo] = useState(false);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);
  const [togglingActive, setTogglingActive] = useState(false);
  const [editorItem, setEditorItem] = useState<MerchantMenuItemDto | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [uploadingBanner, setUploadingBanner] = useState(false);
  const [shareState, setShareState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const bannerFileRef = useRef<HTMLInputElement>(null);

  const handlePickBanner = async (file: File | undefined) => {
    if (!file || !id) return;
    setUploadingBanner(true);
    try {
      const url = await uploadImage(file, 'banner', id);
      await api.patch(`/merchant/restaurants/${id}`, { bannerImage: url });
      reload();
    } catch (err) {
      setInfoMsg(err instanceof Error ? err.message : '横幅上传失败');
      setTimeout(() => setInfoMsg(null), 2500);
    } finally {
      setUploadingBanner(false);
    }
  };

  useEffect(() => {
    if (shop) {
      setInfo({
        name: shop.name,
        deliveryFee: String(shop.deliveryFee),
        minOrder: String(shop.minOrder),
        deliveryTime: String(shop.deliveryTime),
        menuCategories: shop.menuCategories.join(','),
        tags: shop.tags.join(','),
      });
    }
  }, [shop]);

  if (loading) {
    return (
      <div className="app-container min-h-screen bg-gray-50 dark:bg-gray-900 p-4 pt-20 space-y-3">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="bg-white dark:bg-gray-800 rounded-2xl h-32 animate-pulse" />
        ))}
      </div>
    );
  }

  if (error || !shop) {
    return (
      <div className="app-container flex items-center justify-center h-screen">
        <div className="text-center text-gray-400 dark:text-gray-500">
          <div className="text-5xl mb-3">🏪</div>
          <p>{error ?? '店铺不存在'}</p>
          <button className="mt-4 text-orange-500" onClick={() => navigate('/merchant')}>返回商家中心</button>
        </div>
      </div>
    );
  }

  const handleSaveInfo = async () => {
    setSavingInfo(true);
    setInfoMsg(null);
    try {
      await api.patch(`/merchant/restaurants/${shop.id}`, {
        name: info.name.trim(),
        deliveryFee: Number(info.deliveryFee) || 0,
        minOrder: Number(info.minOrder) || 0,
        deliveryTime: Number(info.deliveryTime) || 30,
        menuCategories: info.menuCategories.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
        tags: info.tags.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
      });
      setInfoMsg('已保存，等待审核 ✓');
      reload();
    } catch (err) {
      setInfoMsg(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSavingInfo(false);
      setTimeout(() => setInfoMsg(null), 2500);
    }
  };

  const handleToggleActive = async () => {
    setTogglingActive(true);
    try {
      await api.patch(`/merchant/restaurants/${shop.id}`, { isActive: !shop.isActive });
      reload();
    } finally {
      setTogglingActive(false);
    }
  };

  const handleShare = async () => {
    const ok = await copyRestaurantLink(shop.id);
    setShareState(ok ? 'copied' : 'failed');
    setTimeout(() => setShareState('idle'), 2000);
  };

  const handleToggleListed = async (item: MerchantMenuItemDto) => {
    if (item.isListed) {
      await api.del(`/merchant/restaurants/${shop.id}/items/${item.id}`);
    } else {
      await api.patch(`/merchant/restaurants/${shop.id}/items/${item.id}`, { isListed: true });
    }
    reload();
  };

  return (
    <div className="app-container min-h-screen bg-gray-50 dark:bg-gray-900 pb-10">
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 px-4 pt-10 pb-4 border-b border-gray-100 dark:border-gray-700">
        <div className="flex items-center gap-3">
          <button className="w-8 h-8 flex items-center justify-center text-gray-600 dark:text-gray-300" onClick={() => navigate(-1)}>
            ←
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-gray-900 dark:text-gray-100 font-bold text-lg truncate">
              {shop.emoji} {shop.name}
            </h1>
          </div>
          {shop.reviewStatus !== 'approved' && (
            <span
              className={`text-xs px-2 py-1.5 rounded-full font-medium flex-shrink-0 ${
                shop.reviewStatus === 'pending'
                  ? 'text-amber-600 bg-amber-50 dark:bg-amber-500/10'
                  : 'text-red-500 bg-red-50 dark:bg-red-500/10'
              }`}
            >
              {shop.reviewStatus === 'pending' ? '审核中' : '已驳回'}
            </span>
          )}
          <button
            className={`text-xs px-3 py-1.5 rounded-full font-medium ${
              shop.isActive
                ? 'text-green-600 bg-green-50 dark:bg-green-500/10'
                : 'text-gray-400 bg-gray-100 dark:bg-gray-700'
            }`}
            disabled={togglingActive}
            onClick={handleToggleActive}
          >
            {shop.isActive ? '营业中 · 点击打烊' : '已打烊 · 点击营业'}
          </button>
        </div>
        <div className="mt-2 flex items-center gap-4">
          <button className="text-xs text-orange-500" onClick={() => navigate(`/restaurant/${shop.id}`)}>
            查看顾客视角 ›
          </button>
          {shop.reviewStatus === 'approved' && (
            <button className="text-xs text-orange-500" onClick={handleShare}>
              {shareState === 'copied' ? '已复制 ✓' : shareState === 'failed' ? '复制失败' : '🔗 分享店铺'}
            </button>
          )}
        </div>
      </div>

      {/* Review status banner */}
      {shop.reviewStatus === 'pending' && (
        <div className="mx-4 mt-4 bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 text-xs rounded-2xl px-4 py-3">
          ⏳ 店铺信息审核中，通过后将对顾客可见
        </div>
      )}
      {shop.reviewStatus === 'rejected' && (
        <div className="mx-4 mt-4 bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 text-xs rounded-2xl px-4 py-3">
          ❌ 审核未通过{shop.rejectReason ? `：${shop.rejectReason}` : ''}，修改店铺信息后将自动重新提交审核
        </div>
      )}

      <div className="px-4 space-y-3 mt-4">
        {/* Banner */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl p-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-bold text-gray-900 dark:text-gray-100 text-sm">店铺横幅</h2>
            <button
              className="text-orange-500 text-xs font-medium disabled:opacity-50"
              disabled={uploadingBanner}
              onClick={() => bannerFileRef.current?.click()}
            >
              {uploadingBanner ? '上传中…' : shop.bannerImage ? '更换横幅' : '上传横幅'}
            </button>
          </div>
          {shop.bannerImage ? (
            <img src={assetUrl(shop.bannerImage)} alt="店铺横幅" className="w-full h-28 object-cover rounded-xl" />
          ) : (
            <div
              className="w-full h-28 rounded-xl flex items-center justify-center text-5xl"
              style={{ background: `linear-gradient(135deg, ${shop.bgColor}ee, ${shop.bgColor}88)` }}
            >
              {shop.emoji}
            </div>
          )}
          <input
            ref={bannerFileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => handlePickBanner(e.target.files?.[0])}
          />
        </div>

        {/* Shop info */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl p-4 space-y-3">
          <h2 className="font-bold text-gray-900 dark:text-gray-100 text-sm">店铺信息</h2>
          <input className={inputClass} value={info.name} onChange={(e) => setInfo({ ...info, name: e.target.value })} placeholder="店铺名称" />
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-xs text-gray-400 dark:text-gray-500 block mb-1">配送费(¥)</label>
              <input className={inputClass} type="number" min="0" value={info.deliveryFee} onChange={(e) => setInfo({ ...info, deliveryFee: e.target.value })} />
            </div>
            <div>
              <label className="text-xs text-gray-400 dark:text-gray-500 block mb-1">起送价(¥)</label>
              <input className={inputClass} type="number" min="0" value={info.minOrder} onChange={(e) => setInfo({ ...info, minOrder: e.target.value })} />
            </div>
            <div>
              <label className="text-xs text-gray-400 dark:text-gray-500 block mb-1">配送(分钟)</label>
              <input className={inputClass} type="number" min="5" value={info.deliveryTime} onChange={(e) => setInfo({ ...info, deliveryTime: e.target.value })} />
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-400 dark:text-gray-500 block mb-1">菜单分类（逗号分隔）</label>
            <input className={inputClass} value={info.menuCategories} onChange={(e) => setInfo({ ...info, menuCategories: e.target.value })} />
          </div>
          <div>
            <label className="text-xs text-gray-400 dark:text-gray-500 block mb-1">标签（逗号分隔）</label>
            <input className={inputClass} value={info.tags} onChange={(e) => setInfo({ ...info, tags: e.target.value })} />
          </div>
          <div className="flex items-center gap-3">
            <button
              className="flex-1 bg-orange-500 text-white py-2.5 rounded-xl font-bold text-sm disabled:opacity-50"
              disabled={savingInfo}
              onClick={handleSaveInfo}
            >
              {savingInfo ? '保存中…' : '保存店铺信息'}
            </button>
            {infoMsg && <span className="text-xs text-gray-400">{infoMsg}</span>}
          </div>
        </div>

        {/* Menu */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-gray-900 dark:text-gray-100 text-sm">菜品管理（{shop.menu.length}）</h2>
            <button
              className="text-orange-500 text-xs font-medium"
              onClick={() => {
                setEditorItem(null);
                setEditorOpen(true);
              }}
            >
              + 添加菜品
            </button>
          </div>
          {shop.menu.length === 0 ? (
            <p className="text-gray-300 dark:text-gray-600 text-sm text-center py-6">
              还没有菜品，点击右上角添加第一道菜
            </p>
          ) : (
            <div className="divide-y divide-gray-50 dark:divide-gray-700">
              {shop.menu.map((item) => (
                <div key={item.id} className={`py-3 flex items-center gap-3 ${item.isListed ? '' : 'opacity-50'}`}>
                  <span className="text-2xl">{item.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{item.name}</span>
                      {item.popular && <span className="text-xs">🔥</span>}
                      {!item.isListed && (
                        <span className="text-xs text-gray-400 bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded-full flex-shrink-0">已下架</span>
                      )}
                      {item.reviewStatus === 'pending' && (
                        <span className="text-xs text-amber-600 bg-amber-50 dark:bg-amber-500/10 px-1.5 py-0.5 rounded-full flex-shrink-0">审核中</span>
                      )}
                      {item.reviewStatus === 'rejected' && (
                        <span className="text-xs text-red-500 bg-red-50 dark:bg-red-500/10 px-1.5 py-0.5 rounded-full flex-shrink-0">已驳回</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 dark:text-gray-500">
                      ¥{item.price} · {item.menuCategory}
                      {item.optionGroups?.length ? ` · ${item.optionGroups.length}个规格组` : ''}
                    </p>
                    {item.reviewStatus === 'rejected' && item.rejectReason && (
                      <p className="text-xs text-red-500 mt-0.5">驳回原因：{item.rejectReason}</p>
                    )}
                  </div>
                  <button
                    className="text-xs text-gray-500 dark:text-gray-400 px-2 py-1"
                    onClick={() => {
                      setEditorItem(item);
                      setEditorOpen(true);
                    }}
                  >
                    编辑
                  </button>
                  <button
                    className={`text-xs px-2 py-1 ${item.isListed ? 'text-red-400' : 'text-green-500'}`}
                    onClick={() => handleToggleListed(item)}
                  >
                    {item.isListed ? '下架' : '上架'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {editorOpen && (
        <MenuItemEditor
          restaurant={shop}
          item={editorItem ?? undefined}
          onClose={() => setEditorOpen(false)}
          onSaved={() => {
            setEditorOpen(false);
            reload();
          }}
        />
      )}
    </div>
  );
}
