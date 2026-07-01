import { useState } from 'react';
import type { MenuItem as MenuItemType } from '../data/restaurants';
import type { SelectedOption } from '../context/CartContext';

interface Props {
  item: MenuItemType;
  onClose: () => void;
  onConfirm: (selectedOptions: SelectedOption[]) => void;
}

export default function MenuItemOptionsSheet({ item, onClose, onConfirm }: Props) {
  const groups = item.optionGroups ?? [];

  const [selections, setSelections] = useState<Record<string, string[]>>(() => {
    const initial: Record<string, string[]> = {};
    for (const group of groups) {
      initial[group.id] = group.defaultOptionIds ? [...group.defaultOptionIds] : [];
    }
    return initial;
  });

  const toggleOption = (groupId: string, selectionType: 'single' | 'multi', optionId: string) => {
    setSelections(prev => {
      if (selectionType === 'single') {
        return { ...prev, [groupId]: [optionId] };
      }
      const current = prev[groupId] ?? [];
      const next = current.includes(optionId)
        ? current.filter(id => id !== optionId)
        : [...current, optionId];
      return { ...prev, [groupId]: next };
    });
  };

  const priceDelta = groups.reduce((sum, group) => {
    const chosen = selections[group.id] ?? [];
    const groupDelta = group.options
      .filter(o => chosen.includes(o.id))
      .reduce((s, o) => s + o.priceDelta, 0);
    return sum + groupDelta;
  }, 0);
  const runningTotal = item.price + priceDelta;

  const handleConfirm = () => {
    const selectedOptions: SelectedOption[] = groups.flatMap(group => {
      const chosen = selections[group.id] ?? [];
      return group.options
        .filter(o => chosen.includes(o.id))
        .map(o => ({
          groupId: group.id,
          groupName: group.name,
          optionId: o.id,
          optionName: o.name,
          priceDelta: o.priceDelta,
        }));
    });
    onConfirm(selectedOptions);
  };

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/40" onClick={onClose} />
      <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[480px] z-50 bg-white dark:bg-gray-800 rounded-t-2xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-gray-50 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <span className="text-2xl">{item.emoji}</span>
            <span className="font-bold text-gray-900 dark:text-gray-100 text-sm">{item.name}</span>
          </div>
          <button
            className="w-7 h-7 flex items-center justify-center text-gray-400 dark:text-gray-500 text-lg"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {groups.map(group => (
            <div key={group.id} className="px-4 py-3 border-b border-gray-50 dark:border-gray-700">
              <p className="text-sm font-bold text-gray-900 dark:text-gray-100 mb-2">{group.name}</p>
              <div className="flex flex-wrap gap-2">
                {group.options.map(opt => {
                  const selected = (selections[group.id] ?? []).includes(opt.id);
                  return (
                    <button
                      key={opt.id}
                      className={`px-3 py-1.5 rounded-xl text-sm border-2 transition-colors ${
                        selected
                          ? 'border-orange-400 bg-orange-50 dark:bg-orange-500/10 text-orange-600 dark:text-orange-400 font-medium'
                          : 'border-gray-100 dark:border-gray-700 text-gray-600 dark:text-gray-300'
                      }`}
                      onClick={() => toggleOption(group.id, group.selectionType, opt.id)}
                    >
                      {opt.name}{opt.priceDelta > 0 ? ` +¥${opt.priceDelta}` : ''}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="px-4 pb-8 pt-3 border-t border-gray-100 dark:border-gray-700">
          <div className="flex items-center justify-between mb-2">
            <span className="text-gray-500 dark:text-gray-400 text-sm">小计</span>
            <span className="text-orange-500 font-bold text-lg">¥{runningTotal.toFixed(2)}</span>
          </div>
          <button
            className="w-full bg-orange-500 text-white py-3 rounded-2xl font-black active:scale-95 transition-transform"
            onClick={handleConfirm}
          >
            加入购物车
          </button>
        </div>
      </div>
    </>
  );
}
