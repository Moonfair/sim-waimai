import { useRef, useState } from 'react';
import type { MenuItemOptionGroup, MerchantMenuItemDto, MerchantRestaurantDto } from '@sim-waimai/shared';
import { api } from '../lib/api';
import { assetUrl } from '../lib/assetUrl';
import { uploadImage } from '../lib/upload';

interface Props {
  restaurant: MerchantRestaurantDto;
  /** Present = edit mode, absent = create mode. */
  item?: MerchantMenuItemDto;
  onClose: () => void;
  onSaved: () => void;
}

const inputClass =
  'w-full px-3 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-orange-400 text-sm';

function localId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function MenuItemEditor({ restaurant, item, onClose, onSaved }: Props) {
  const [name, setName] = useState(item?.name ?? '');
  const [description, setDescription] = useState(item?.description ?? '');
  const [price, setPrice] = useState(item ? String(item.price) : '');
  const [calories, setCalories] = useState(item ? String(item.calories) : '0');
  const [emoji, setEmoji] = useState(item?.emoji ?? '🍽️');
  const [menuCategory, setMenuCategory] = useState(item?.menuCategory ?? restaurant.menuCategories[0] ?? '');
  const [popular, setPopular] = useState(item?.popular ?? false);
  const [groups, setGroups] = useState<MenuItemOptionGroup[]>(item?.optionGroups ?? []);
  const [image, setImage] = useState(item?.image ?? '');
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handlePickImage = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      setImage(await uploadImage(file, 'item', restaurant.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : '图片上传失败');
    } finally {
      setUploading(false);
    }
  };

  const updateGroup = (gi: number, patch: Partial<MenuItemOptionGroup>) =>
    setGroups((gs) => gs.map((g, i) => (i === gi ? { ...g, ...patch } : g)));

  const addGroup = () =>
    setGroups((gs) => [
      ...gs,
      {
        id: localId('g'),
        name: '',
        selectionType: 'single',
        required: true,
        options: [{ id: localId('o'), name: '', priceDelta: 0 }],
        defaultOptionIds: [],
      },
    ]);

  const addOption = (gi: number) =>
    updateGroup(gi, { options: [...groups[gi].options, { id: localId('o'), name: '', priceDelta: 0 }] });

  const removeOption = (gi: number, oi: number) => {
    const g = groups[gi];
    const removed = g.options[oi];
    updateGroup(gi, {
      options: g.options.filter((_, i) => i !== oi),
      defaultOptionIds: g.defaultOptionIds?.filter((id) => id !== removed.id),
    });
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    // required single groups auto-default to their first option if未设置
    const normalizedGroups = groups
      .filter((g) => g.name.trim() && g.options.some((o) => o.name.trim()))
      .map((g) => {
        const options = g.options.filter((o) => o.name.trim());
        let defaults = (g.defaultOptionIds ?? []).filter((id) => options.some((o) => o.id === id));
        if (g.selectionType === 'single' && g.required && defaults.length !== 1) {
          defaults = [options[0].id];
        }
        return { ...g, name: g.name.trim(), options, defaultOptionIds: defaults };
      });
    const body = {
      name: name.trim(),
      description: description.trim(),
      price: Number(price) || 0,
      calories: Math.round(Number(calories)) || 0,
      emoji: emoji.trim(),
      menuCategory,
      popular,
      ...(image ? { image } : {}),
      optionGroups: normalizedGroups,
    };
    try {
      if (item) {
        await api.patch(`/merchant/restaurants/${restaurant.id}/items/${item.id}`, body);
      } else {
        await api.post(`/merchant/restaurants/${restaurant.id}/items`, body);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败，请稍后重试');
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-[480px] bg-white dark:bg-gray-800 rounded-t-3xl max-h-[85vh] overflow-y-auto p-5 pb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold text-gray-900 dark:text-gray-100 text-base">
            {item ? '编辑菜品' : '添加菜品'}
          </h2>
          <button className="text-gray-400 text-xl leading-none" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>

        <div className="space-y-3">
          <div className="flex gap-2">
            <input className={inputClass} placeholder="菜品名称" value={name} onChange={(e) => setName(e.target.value)} />
            <input className={`${inputClass} w-20 text-center`} placeholder="emoji" value={emoji} onChange={(e) => setEmoji(e.target.value)} />
          </div>
          <input className={inputClass} placeholder="一句话描述（可留空）" value={description} onChange={(e) => setDescription(e.target.value)} />
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-xs text-gray-400 dark:text-gray-500 block mb-1">价格(¥)</label>
              <input className={inputClass} type="number" min="0" step="0.1" value={price} onChange={(e) => setPrice(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-gray-400 dark:text-gray-500 block mb-1">热量(千卡)</label>
              <input className={inputClass} type="number" min="0" value={calories} onChange={(e) => setCalories(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-gray-400 dark:text-gray-500 block mb-1">菜单分类</label>
              <select className={inputClass} value={menuCategory} onChange={(e) => setMenuCategory(e.target.value)}>
                {restaurant.menuCategories.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
            <input type="checkbox" checked={popular} onChange={(e) => setPopular(e.target.checked)} className="accent-orange-500" />
            标记为 🔥 热销
          </label>

          {/* Item photo */}
          <div className="flex items-center gap-3">
            {image ? (
              <img src={assetUrl(image)} alt="菜品图" className="w-16 h-16 rounded-xl object-cover" />
            ) : (
              <div className="w-16 h-16 rounded-xl bg-gray-50 dark:bg-gray-900 border border-dashed border-gray-200 dark:border-gray-700 flex items-center justify-center text-2xl">
                📷
              </div>
            )}
            <div className="flex flex-col gap-1">
              <button
                className="text-orange-500 text-xs font-medium text-left disabled:opacity-50"
                disabled={uploading}
                onClick={() => fileRef.current?.click()}
              >
                {uploading ? '上传中…' : image ? '更换图片' : '上传菜品图（可选）'}
              </button>
              {image && (
                <button className="text-gray-400 text-xs text-left" onClick={() => setImage('')}>
                  移除图片
                </button>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => handlePickImage(e.target.files?.[0])}
            />
          </div>

          {/* Option groups */}
          <div className="border-t border-gray-100 dark:border-gray-700 pt-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-bold text-gray-900 dark:text-gray-100">规格选项</span>
              <button className="text-orange-500 text-xs font-medium" onClick={addGroup}>
                + 添加规格组
              </button>
            </div>
            {groups.length === 0 && (
              <p className="text-gray-300 dark:text-gray-600 text-xs">无规格：顾客直接加购。如需杯型/辣度等选择，添加规格组。</p>
            )}
            <div className="space-y-3">
              {groups.map((group, gi) => (
                <div key={group.id} className="bg-gray-50 dark:bg-gray-900 rounded-xl p-3 space-y-2">
                  <div className="flex gap-2 items-center">
                    <input
                      className={`${inputClass} flex-1`}
                      placeholder="规格组名，如：辣度"
                      value={group.name}
                      onChange={(e) => updateGroup(gi, { name: e.target.value })}
                    />
                    <select
                      className={`${inputClass} w-28`}
                      value={group.selectionType}
                      onChange={(e) => {
                        const selectionType = e.target.value as 'single' | 'multi';
                        updateGroup(gi, { selectionType, required: selectionType === 'single' });
                      }}
                    >
                      <option value="single">单选·必选</option>
                      <option value="multi">多选·可选</option>
                    </select>
                    <button className="text-gray-300 dark:text-gray-600" onClick={() => setGroups((gs) => gs.filter((_, i) => i !== gi))} aria-label="删除规格组">
                      🗑️
                    </button>
                  </div>
                  {group.options.map((option, oi) => (
                    <div key={option.id} className="flex gap-2 items-center">
                      {group.selectionType === 'single' && (
                        <input
                          type="radio"
                          name={`default-${group.id}`}
                          className="accent-orange-500 flex-shrink-0"
                          title="设为默认"
                          checked={group.defaultOptionIds?.[0] === option.id}
                          onChange={() => updateGroup(gi, { defaultOptionIds: [option.id] })}
                        />
                      )}
                      <input
                        className={`${inputClass} flex-1`}
                        placeholder="选项名，如：微辣"
                        value={option.name}
                        onChange={(e) =>
                          updateGroup(gi, {
                            options: group.options.map((o, i) => (i === oi ? { ...o, name: e.target.value } : o)),
                          })
                        }
                      />
                      <input
                        className={`${inputClass} w-20`}
                        type="number"
                        min="0"
                        step="0.5"
                        placeholder="+¥"
                        value={option.priceDelta || ''}
                        onChange={(e) =>
                          updateGroup(gi, {
                            options: group.options.map((o, i) =>
                              i === oi ? { ...o, priceDelta: Number(e.target.value) || 0 } : o,
                            ),
                          })
                        }
                      />
                      <button className="text-gray-300 dark:text-gray-600 flex-shrink-0" onClick={() => removeOption(gi, oi)} aria-label="删除选项">
                        ✕
                      </button>
                    </div>
                  ))}
                  <button className="text-orange-500 text-xs font-medium" onClick={() => addOption(gi)}>
                    + 添加选项
                  </button>
                </div>
              ))}
            </div>
          </div>

          {error && <p className="text-red-500 text-xs">{error}</p>}
          <button
            className="w-full bg-orange-500 text-white py-3.5 rounded-xl font-bold text-sm disabled:opacity-50"
            disabled={submitting || !name.trim() || !price}
            onClick={handleSubmit}
          >
            {submitting ? '保存中…' : '保存菜品'}
          </button>
        </div>
      </div>
    </div>
  );
}
