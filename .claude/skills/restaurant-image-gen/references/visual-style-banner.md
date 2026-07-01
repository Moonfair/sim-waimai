# 商家 Banner 统一视觉规范

用于生成 `bannerImagePrompt`（对应 `Restaurant.bannerImage`，1600×640，约 2.5:1 横幅，同时用作首页卡片头图和商家详情页头图，靠 `object-cover` 裁切适配两种展示比例）。

## 固定全局规范（每个 banner prompt 都必须包含，逐字或等价改写）

```
Professional food-delivery-app restaurant banner photograph, wide horizontal composition
(~2.5:1 aspect ratio), warm inviting natural lighting, shallow depth of field, appetizing
commercial food photography style, no visible text/logos/watermarks, no people/hands,
centered or rule-of-thirds subject placement, consistent color grading across the whole app's
banner set (natural warm tones, not oversaturated).
```

这段是"统一规范"，保证所有商家 banner 在展示尺寸、构图密度、整体基调上看起来是同一个 App 里的东西，不会一张写实摄影一张卡通插画混在首页网格里。

## 商家系列风格（`seriesStyle` 字段）

在全局规范之后，插入这一家商家专属的 `seriesStyle`（生成数据时就要确定、并存进 JSON，之后该商家所有商品图的 prompt 也复用同一段文字）。写法建议覆盖：

- 主色调 / 品牌配色（如"红铜色调，暖光"、"绿白极简"）
- 摆盘 / 呈现方式的共性（如"火锅类多用铜锅+红油"、"烘焙类多用木托盘+亚麻布"）
- 氛围关键词（如"街头烟火气" vs "精致轻奢"）

## 商家真实特色（banner 主体内容）

banner 的画面主体应该是该商家**最具代表性的场景或招牌菜**，不是随便一张食物照。例如：
- 火锅店 → 沸腾的红油锅配涮品
- 咖啡店 → 手冲/拉花咖啡配桌面场景
- 面包店 → 满满一柜刚出炉的面包

## 组装顺序

```
<全局规范> + <该商家 seriesStyle> + <该商家最具代表性场景/招牌菜的具体描述>
```

建议全文控制在 300 个汉字（或 600 英文单词）以内，避免细节过多导致模型抓不住重点（参考 Volcengine Seedream 官方 prompt 指南的建议）。
