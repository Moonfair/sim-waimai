#!/usr/bin/env node
// One-off (but rerunnable) script that merges `optionGroups` into menu items in
// src/data/restaurants/starbucks.json and heytea.json.
//
// size/temperature/sweetness/heat_preference are shared per-category templates (these
// genuinely don't vary drink-to-drink in real menus). The "加料" (add-ons) group is defined
// per item instead, referencing that specific drink's real ingredients/flavor — e.g. 抹茶星冰乐
// offers 加抹茶粉 while 摩卡星冰乐 offers 加巧克力酱, and drinks that already include an
// ingredient by default (珍珠奶茶 already has pearls, 波波奶茶 already has boba) don't offer
// redundantly adding that same thing.
//
// Idempotent: re-running overwrites optionGroups with the same content. Extend
// TEMPLATES/CATEGORY_GROUPS/ITEM_ADDONS per-restaurant to cover more restaurants later.
//
// Usage: node tools/apply-customization-options.mjs [--dry-run]

import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');

const SBK_TEMPLATES = {
  size: {
    id: 'size', name: '杯型', selectionType: 'single', required: true,
    options: [
      { id: 'medium', name: '中杯', priceDelta: 0 },
      { id: 'large', name: '大杯', priceDelta: 3 },
      { id: 'xlarge', name: '超大杯', priceDelta: 6 },
    ],
    defaultOptionIds: ['medium'],
  },
  temperature: {
    id: 'temperature', name: '温度', selectionType: 'single', required: true,
    options: [
      { id: 'hot', name: '热', priceDelta: 0 },
      { id: 'iced', name: '冰', priceDelta: 0 },
    ],
    defaultOptionIds: ['hot'],
  },
  sweetness: {
    id: 'sweetness', name: '糖度', selectionType: 'single', required: true,
    options: [
      { id: 'full_sugar', name: '标准糖', priceDelta: 0 },
      { id: 'less_sugar', name: '少糖', priceDelta: 0 },
      { id: 'half_sugar', name: '半糖', priceDelta: 0 },
      { id: 'no_sugar', name: '无糖', priceDelta: 0 },
    ],
    defaultOptionIds: ['full_sugar'],
  },
  heat_preference: {
    id: 'heat_preference', name: '是否加热', selectionType: 'single', required: true,
    options: [
      { id: 'heated', name: '加热', priceDelta: 0 },
      { id: 'room_temp', name: '常温', priceDelta: 0 },
    ],
    defaultOptionIds: ['heated'],
  },
};

// base groups (excludes addons, which come from SBK_ITEM_ADDONS below)
const SBK_CATEGORY_GROUPS = {
  '热销': ['size', 'temperature', 'sweetness'],
  '咖啡': ['size', 'temperature', 'sweetness'],
  '星冰乐': ['size', 'sweetness'],
  '茶饮': ['size', 'temperature', 'sweetness'],
  '轻食': ['heat_preference'],
  '甜点': [],
};

// 冷萃咖啡 is always served cold — no 温度 group, unlike the rest of 咖啡.
const SBK_ITEM_OVERRIDES = {
  sbk_lc: ['size', 'sweetness'],
};

// per-item 加料 options, referencing each drink's actual recipe
const SBK_ITEM_ADDONS = {
  sbk_nt: [{ id: 'extra_shot', name: '加浓缩', priceDelta: 4 }, { id: 'vanilla_syrup', name: '加香草糖浆', priceDelta: 3 }, { id: 'oat_milk', name: '换燕麦奶', priceDelta: 3 }, { id: 'whipped_cream', name: '加奶油', priceDelta: 3 }],
  sbk_jtmqd: [{ id: 'extra_shot', name: '加浓缩', priceDelta: 4 }, { id: 'toffee_sauce', name: '加焦糖酱', priceDelta: 3 }, { id: 'whipped_cream', name: '加奶油', priceDelta: 3 }],
  sbk_syn: [{ id: 'extra_shot', name: '加浓缩', priceDelta: 4 }, { id: 'double_coconut', name: '双份生椰乳', priceDelta: 4 }, { id: 'whipped_cream', name: '加奶油', priceDelta: 3 }],
  sbk_ms: [{ id: 'extra_shot', name: '加浓缩', priceDelta: 4 }, { id: 'milk', name: '加牛奶', priceDelta: 2 }, { id: 'vanilla_syrup', name: '加香草糖浆', priceDelta: 3 }],
  sbk_kbqn: [{ id: 'extra_shot', name: '加浓缩', priceDelta: 4 }, { id: 'cinnamon', name: '加肉桂粉', priceDelta: 2 }, { id: 'whipped_cream', name: '加奶油', priceDelta: 3 }],
  sbk_mk: [{ id: 'extra_shot', name: '加浓缩', priceDelta: 4 }, { id: 'choco_sauce', name: '加巧克力酱', priceDelta: 3 }, { id: 'whipped_cream', name: '加奶油', priceDelta: 3 }],
  sbk_frb: [{ id: 'extra_shot', name: '加浓缩', priceDelta: 4 }, { id: 'oat_milk', name: '换燕麦奶', priceDelta: 3 }],
  sbk_ab: [{ id: 'extra_shot', name: '加浓缩', priceDelta: 4 }, { id: 'oat_milk', name: '换燕麦奶', priceDelta: 3 }],
  sbk_lc: [{ id: 'extra_shot', name: '加浓缩', priceDelta: 4 }, { id: 'cream_cold_foam', name: '加奶油冷萃', priceDelta: 4 }, { id: 'vanilla_syrup', name: '加香草糖浆', priceDelta: 3 }],
  sbk_ynnt: [{ id: 'extra_shot', name: '加浓缩', priceDelta: 4 }, { id: 'vanilla_syrup', name: '加香草糖浆', priceDelta: 3 }, { id: 'cinnamon', name: '加肉桂粉', priceDelta: 2 }],
  sbk_yzsms: [{ id: 'extra_shot', name: '加浓缩', priceDelta: 4 }, { id: 'coconut_meat', name: '加椰肉', priceDelta: 3 }],
  sbk_mkxbl: [{ id: 'choco_sauce', name: '加巧克力酱', priceDelta: 3 }, { id: 'whipped_cream', name: '加奶油', priceDelta: 3 }, { id: 'extra_shot', name: '加浓缩', priceDelta: 4 }],
  sbk_mcxbl: [{ id: 'matcha_powder', name: '加抹茶粉', priceDelta: 3 }, { id: 'whipped_cream', name: '加奶油', priceDelta: 3 }, { id: 'condensed_milk', name: '加炼乳', priceDelta: 3 }],
  sbk_cmxbl: [{ id: 'strawberry_sauce', name: '加草莓酱', priceDelta: 3 }, { id: 'whipped_cream', name: '加奶油', priceDelta: 3 }, { id: 'strawberry_chunks', name: '加草莓果肉', priceDelta: 4 }],
  sbk_jtxbl: [{ id: 'toffee_sauce', name: '加焦糖酱', priceDelta: 3 }, { id: 'whipped_cream', name: '加奶油', priceDelta: 3 }, { id: 'extra_shot', name: '加浓缩', priceDelta: 4 }],
  sbk_ttwl: [{ id: 'honey', name: '加蜂蜜', priceDelta: 2 }, { id: 'oat_milk', name: '换燕麦奶', priceDelta: 3 }, { id: 'whipped_cream', name: '加奶油', priceDelta: 3 }],
  sbk_mcnt: [{ id: 'matcha_powder', name: '双份抹茶', priceDelta: 3 }, { id: 'oat_milk', name: '换燕麦奶', priceDelta: 3 }, { id: 'whipped_cream', name: '加奶油', priceDelta: 3 }],
  sbk_hcnt: [{ id: 'honey', name: '加蜂蜜', priceDelta: 2 }, { id: 'oat_milk', name: '换燕麦奶', priceDelta: 3 }, { id: 'whipped_cream', name: '加奶油', priceDelta: 3 }],
  sbk_nmhc: [{ id: 'honey', name: '加蜂蜜', priceDelta: 2 }, { id: 'lemon_slice', name: '加柠檬片', priceDelta: 2 }],
  sbk_bynmc: [{ id: 'honey', name: '加蜂蜜', priceDelta: 2 }, { id: 'passionfruit', name: '加百香果', priceDelta: 3 }],
};

const HT_TEMPLATES = {
  size: {
    id: 'size', name: '杯型', selectionType: 'single', required: true,
    options: [
      { id: 'medium', name: '中杯', priceDelta: 0 },
      { id: 'large', name: '大杯', priceDelta: 3 },
    ],
    defaultOptionIds: ['medium'],
  },
  ice_level: {
    id: 'temperature', name: '温度', selectionType: 'single', required: true,
    options: [
      { id: 'normal_ice', name: '标准冰', priceDelta: 0 },
      { id: 'less_ice', name: '少冰', priceDelta: 0 },
      { id: 'no_ice', name: '去冰', priceDelta: 0 },
      { id: 'hot', name: '热', priceDelta: 0 },
    ],
    defaultOptionIds: ['normal_ice'],
  },
  sweetness: {
    id: 'sweetness', name: '甜度', selectionType: 'single', required: true,
    options: [
      { id: 'sugar_100', name: '标准糖', priceDelta: 0 },
      { id: 'sugar_70', name: '七分糖', priceDelta: 0 },
      { id: 'sugar_50', name: '五分糖', priceDelta: 0 },
      { id: 'sugar_30', name: '三分糖', priceDelta: 0 },
      { id: 'sugar_0', name: '无糖', priceDelta: 0 },
    ],
    defaultOptionIds: ['sugar_100'],
  },
};

// base groups (excludes addons, which come from HT_ITEM_ADDONS below).
// 纯茶 intentionally has no addons group at all — real Heytea pure-tea series doesn't offer
// fruit/dairy toppings, only size/temperature.
const HT_CATEGORY_GROUPS = {
  '热销': ['size', 'ice_level', 'sweetness'],
  '果茶': ['size', 'ice_level', 'sweetness'],
  '奶茶': ['size', 'ice_level', 'sweetness'],
  '季节限定': ['size', 'ice_level', 'sweetness'],
  '纯茶': ['size', 'ice_level'],
  '小食': [],
};

// per-item 加料 options, referencing each drink's actual recipe. Drinks that already include
// an ingredient by default (波波/珍珠/布丁) don't offer redundantly adding that same thing —
// 珍珠奶茶 offers "双份珍珠" (more of what it has) rather than "加珍珠".
const HT_ITEM_ADDONS = {
  dpg: [{ id: 'grape_chunks', name: '加葡萄果肉', priceDelta: 4 }, { id: 'cheese_cap', name: '加芝士奶盖', priceDelta: 4 }],
  zzmm: [{ id: 'strawberry_chunks', name: '加草莓果肉', priceDelta: 4 }, { id: 'double_cheese_cap', name: '双份奶盖', priceDelta: 4 }],
  ht_zztt: [{ id: 'peach_chunks', name: '加水蜜桃果肉', priceDelta: 4 }, { id: 'double_cheese_cap', name: '双份奶盖', priceDelta: 4 }],
  ht_htbbnr: [{ id: 'double_boba', name: '双份波波', priceDelta: 4 }, { id: 'oat_milk', name: '换燕麦奶', priceDelta: 3 }],
  bbk: [{ id: 'honey', name: '加蜂蜜', priceDelta: 2 }, { id: 'lemon_slice', name: '加柠檬片', priceDelta: 2 }],
  ht_mbhy: [{ id: 'grapefruit_chunks', name: '加西柚果肉', priceDelta: 4 }, { id: 'honey', name: '加蜂蜜', priceDelta: 2 }],
  ht_zzmm2: [{ id: 'mango_chunks', name: '加芒果果肉', priceDelta: 4 }, { id: 'double_cheese_cap', name: '双份奶盖', priceDelta: 4 }],
  ht_pt: [{ id: 'grape_chunks', name: '加葡萄果肉', priceDelta: 4 }, { id: 'coconut_jelly', name: '加椰果', priceDelta: 3 }],
  ht_mgbql: [{ id: 'mango_chunks', name: '加芒果果肉', priceDelta: 4 }, { id: 'ice_cream_scoop', name: '加冰淇淋球', priceDelta: 5 }],
  jbk: [{ id: 'pearl', name: '加珍珠', priceDelta: 3 }, { id: 'coconut_jelly', name: '加椰果', priceDelta: 3 }, { id: 'cream_cap', name: '加奶盖', priceDelta: 4 }],
  ht_nac: [{ id: 'pearl', name: '加珍珠', priceDelta: 3 }, { id: 'coconut_jelly', name: '加椰果', priceDelta: 3 }],
  ht_bbnc: [{ id: 'coconut_jelly', name: '加椰果', priceDelta: 3 }, { id: 'cream_cap', name: '加奶盖', priceDelta: 4 }],
  ht_znnc: [{ id: 'double_pearl', name: '双份珍珠', priceDelta: 3 }, { id: 'coconut_jelly', name: '加椰果', priceDelta: 3 }, { id: 'cream_cap', name: '加奶盖', priceDelta: 4 }],
  ht_ynnc: [{ id: 'pearl', name: '加珍珠', priceDelta: 3 }, { id: 'coconut_jelly', name: '加椰果', priceDelta: 3 }],
  ht_qklnc: [{ id: 'pearl', name: '加珍珠', priceDelta: 3 }, { id: 'choco_sauce', name: '加巧克力酱', priceDelta: 3 }],
  ht_bdnc: [{ id: 'pearl', name: '加珍珠', priceDelta: 3 }, { id: 'coconut_jelly', name: '加椰果', priceDelta: 3 }],
  scly: [{ id: 'honey', name: '加蜂蜜', priceDelta: 2 }, { id: 'lemon_slice', name: '加柠檬片', priceDelta: 2 }],
  ht_ymbc: [{ id: 'bayberry_chunks', name: '加杨梅果肉', priceDelta: 4 }, { id: 'honey', name: '加蜂蜜', priceDelta: 2 }],
  ht_lzxl: [{ id: 'lychee_chunks', name: '加荔枝果肉', priceDelta: 4 }, { id: 'coconut_jelly', name: '加椰果', priceDelta: 3 }],
  ht_ghmn: [{ id: 'osmanthus_honey', name: '加桂花蜜', priceDelta: 3 }, { id: 'pearl', name: '加珍珠', priceDelta: 3 }],
};

const RESTAURANTS = [
  { file: 'starbucks.json', templates: SBK_TEMPLATES, categoryGroups: SBK_CATEGORY_GROUPS, baseOverrides: SBK_ITEM_OVERRIDES, itemAddons: SBK_ITEM_ADDONS },
  { file: 'heytea.json', templates: HT_TEMPLATES, categoryGroups: HT_CATEGORY_GROUPS, baseOverrides: {}, itemAddons: HT_ITEM_ADDONS },
];

function applyToItem(item, { templates, categoryGroups, baseOverrides, itemAddons }) {
  const baseKeys = baseOverrides[item.id] ?? categoryGroups[item.menuCategory] ?? [];
  const addonOptions = itemAddons[item.id];
  if (baseKeys.length === 0 && !addonOptions) {
    delete item.optionGroups;
    return;
  }
  const groups = baseKeys.map(k => structuredClone(templates[k]));
  if (addonOptions) {
    groups.push({
      id: 'addons', name: '加料', selectionType: 'multi', required: false,
      options: structuredClone(addonOptions),
    });
  }
  item.optionGroups = groups;
}

function main() {
  const dryRun = process.argv.includes('--dry-run');
  for (const restaurant of RESTAURANTS) {
    const jsonPath = path.join(repoRoot, 'src/data/restaurants', restaurant.file);
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    for (const item of data.menu) applyToItem(item, restaurant);
    if (dryRun) {
      console.log(`[dry-run] ${restaurant.file}: would write`);
      continue;
    }
    fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
    console.log(`wrote ${restaurant.file}`);
  }
}

main();
