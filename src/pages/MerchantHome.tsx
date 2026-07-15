import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CATEGORIES } from '@sim-waimai/shared';
import type { MerchantRestaurantDto, MerchantRestaurantSummaryDto } from '@sim-waimai/shared';
import { useApi } from '../hooks/useApi';
import { api } from '../lib/api';
import { uploadImage } from '../lib/upload';

const SHOP_CATEGORIES = CATEGORIES.filter((c) => c !== '全部');

const inputClass =
  'w-full px-3 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-orange-400 text-sm';

export default function MerchantHome() {
  const navigate = useNavigate();
  const { data: shops, loading, error } = useApi<MerchantRestaurantSummaryDto[]>('/merchant/restaurants');
  const [formOpen, setFormOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '',
    category: SHOP_CATEGORIES[0] as string,
    emoji: '🍜',
    bgColor: '#ff8c00',
    deliveryFee: '3',
    minOrder: '15',
    deliveryTime: '30',
    tags: '新店开业',
    menuCategories: '招牌,主食,小吃,饮品',
  });
  const [bannerFile, setBannerFile] = useState<File | null>(null);
  const [bannerPreview, setBannerPreview] = useState<string | null>(null);
  const bannerFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (bannerPreview) URL.revokeObjectURL(bannerPreview);
    };
  }, [bannerPreview]);

  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  const handlePickBanner = (file: File | undefined) => {
    if (!file) return;
    if (bannerPreview) URL.revokeObjectURL(bannerPreview);
    setBannerFile(file);
    setBannerPreview(URL.createObjectURL(file));
  };

  const handleCreate = async () => {
    setSubmitting(true);
    setFormError(null);
    try {
      const shop = await api.post<MerchantRestaurantDto>('/merchant/restaurants', {
        name: form.name.trim(),
        category: form.category,
        emoji: form.emoji.trim(),
        bgColor: form.bgColor,
        deliveryFee: Number(form.deliveryFee) || 0,
        minOrder: Number(form.minOrder) || 0,
        deliveryTime: Number(form.deliveryTime) || 30,
        tags: form.tags.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
        menuCategories: form.menuCategories.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
      });
      if (bannerFile) {
        try {
          const url = await uploadImage(bannerFile, 'banner', shop.id);
          await api.patch(`/merchant/restaurants/${shop.id}`, { bannerImage: url });
        } catch {
          // Shop is already created; banner can be (re)uploaded from the shop page.
        }
      }
      navigate(`/merchant/${shop.id}`);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : '开店失败，请稍后重试');
      setSubmitting(false);
    }
  };

  return (
    <div className="app-container min-h-screen bg-gray-50 dark:bg-gray-900 pb-10">
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 px-4 pt-10 pb-4 border-b border-gray-100 dark:border-gray-700">
        <div className="flex items-center gap-3">
          <button
            className="w-8 h-8 flex items-center justify-center text-gray-600 dark:text-gray-300"
            onClick={() => navigate(-1)}
          >
            ←
          </button>
          <h1 className="text-gray-900 dark:text-gray-100 font-bold text-lg">商家中心</h1>
        </div>
      </div>

      <div className="px-4">
        {loading ? (
          <div className="space-y-3 mt-4">
            {Array.from({ length: 2 }, (_, i) => (
              <div key={i} className="bg-white dark:bg-gray-800 rounded-2xl h-20 animate-pulse" />
            ))}
          </div>
        ) : error ? (
          <p className="text-center text-sm text-gray-400 dark:text-gray-500 py-10">{error}</p>
        ) : (
          <>
            {(shops ?? []).length > 0 && (
              <div className="space-y-3 mt-4">
                {shops!.map((shop) => (
                  <div
                    key={shop.id}
                    className="bg-white dark:bg-gray-800 rounded-2xl p-4 flex items-center gap-3 cursor-pointer active:scale-[0.98] transition-transform"
                    onClick={() => navigate(`/merchant/${shop.id}`)}
                  >
                    <div
                      className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl"
                      style={{ background: `${shop.bgColor}22` }}
                    >
                      {shop.emoji}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-gray-900 dark:text-gray-100 text-sm truncate">
                          {shop.name}
                        </span>
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${
                            shop.reviewStatus === 'pending'
                              ? 'text-amber-600 bg-amber-50 dark:bg-amber-500/10'
                              : shop.reviewStatus === 'rejected'
                                ? 'text-red-500 bg-red-50 dark:bg-red-500/10'
                                : shop.isActive
                                  ? 'text-green-600 bg-green-50 dark:bg-green-500/10'
                                  : 'text-gray-400 bg-gray-100 dark:bg-gray-700'
                          }`}
                        >
                          {shop.reviewStatus === 'pending'
                            ? '审核中'
                            : shop.reviewStatus === 'rejected'
                              ? '已驳回'
                              : shop.isActive
                                ? '营业中'
                                : '已打烊'}
                        </span>
                      </div>
                      <p className="text-gray-400 dark:text-gray-500 text-xs mt-0.5">
                        {shop.category} · ⭐{shop.rating} · 月售{shop.monthlyOrders}
                      </p>
                    </div>
                    <span className="text-gray-300 dark:text-gray-600">›</span>
                  </div>
                ))}
              </div>
            )}

            {!formOpen ? (
              <div className="mt-6 text-center">
                {(shops ?? []).length === 0 && (
                  <div className="py-8 text-gray-400 dark:text-gray-500">
                    <div className="text-5xl mb-3">🏪</div>
                    <p className="text-sm">还没有自己的店铺，开一家试试？</p>
                  </div>
                )}
                <button
                  className="w-full bg-orange-500 text-white py-3.5 rounded-2xl font-bold text-sm"
                  onClick={() => setFormOpen(true)}
                >
                  免费开店 🏪
                </button>
              </div>
            ) : (
              <div className="bg-white dark:bg-gray-800 rounded-2xl p-4 mt-4 space-y-3">
                <h2 className="font-bold text-gray-900 dark:text-gray-100 text-base">开一家新店</h2>
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs text-gray-400 dark:text-gray-500">店铺横幅（可选）</label>
                    <button
                      type="button"
                      className="text-orange-500 text-xs font-medium"
                      onClick={() => bannerFileRef.current?.click()}
                    >
                      {bannerPreview ? '更换横幅' : '上传横幅'}
                    </button>
                  </div>
                  {bannerPreview ? (
                    <img src={bannerPreview} alt="店铺横幅预览" className="w-full h-28 object-cover rounded-xl" />
                  ) : (
                    <div
                      className="w-full h-28 rounded-xl flex items-center justify-center text-5xl"
                      style={{ background: `linear-gradient(135deg, ${form.bgColor}ee, ${form.bgColor}88)` }}
                    >
                      {form.emoji}
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
                <input className={inputClass} placeholder="店铺名称" value={form.name} onChange={(e) => set('name')(e.target.value)} />
                <div className="flex gap-2">
                  <select className={inputClass} value={form.category} onChange={(e) => set('category')(e.target.value)}>
                    {SHOP_CATEGORIES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                  <input className={`${inputClass} w-20 text-center`} placeholder="emoji" value={form.emoji} onChange={(e) => set('emoji')(e.target.value)} />
                  <label className="flex items-center gap-1 flex-shrink-0">
                    <input type="color" value={form.bgColor} onChange={(e) => set('bgColor')(e.target.value)} className="w-9 h-9 rounded-lg border-0 bg-transparent cursor-pointer" aria-label="店铺主题色" />
                  </label>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-xs text-gray-400 dark:text-gray-500 block mb-1">配送费(¥)</label>
                    <input className={inputClass} type="number" min="0" value={form.deliveryFee} onChange={(e) => set('deliveryFee')(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 dark:text-gray-500 block mb-1">起送价(¥)</label>
                    <input className={inputClass} type="number" min="0" value={form.minOrder} onChange={(e) => set('minOrder')(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 dark:text-gray-500 block mb-1">配送(分钟)</label>
                    <input className={inputClass} type="number" min="5" value={form.deliveryTime} onChange={(e) => set('deliveryTime')(e.target.value)} />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-gray-400 dark:text-gray-500 block mb-1">菜单分类（逗号分隔）</label>
                  <input className={inputClass} value={form.menuCategories} onChange={(e) => set('menuCategories')(e.target.value)} />
                </div>
                <div>
                  <label className="text-xs text-gray-400 dark:text-gray-500 block mb-1">标签（逗号分隔，可留空）</label>
                  <input className={inputClass} value={form.tags} onChange={(e) => set('tags')(e.target.value)} />
                </div>
                {formError && <p className="text-red-500 text-xs">{formError}</p>}
                <div className="flex gap-2">
                  <button className="flex-1 border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 py-3 rounded-xl text-sm" onClick={() => setFormOpen(false)}>
                    取消
                  </button>
                  <button
                    className="flex-1 bg-orange-500 text-white py-3 rounded-xl font-bold text-sm disabled:opacity-50"
                    disabled={submitting || !form.name.trim()}
                    onClick={handleCreate}
                  >
                    {submitting ? '开店中…' : '确认开店'}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
