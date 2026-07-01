# 商品图统一视觉规范

用于生成每个 `MenuItem.imagePrompt`（对应 `MenuItem.image`，1024×1024 正方形缩略图，展示在商家详情页的商品行里）。

## 固定全局规范（每个商品 prompt 都必须包含，逐字或等价改写）

```
Top-down or 45-degree angle product photography of a single dish, square 1:1 crop, plain
neutral light-colored background (consistent across the whole app's item photo set), soft
even studio lighting, consistent color grading and exposure, no text/watermark/logo, no
hands/utensils holding food, dish centered and fully visible, appetizing and true-to-life.
```

这是"统一规范"，保证不同商家、不同商品的缩略图在同一个列表里滚动时观感一致（角度、留白、打光都统一），不会有的图特写有的图俯拍、有的图背景干净有的图背景杂乱。

## 商家系列风格（`seriesStyle`，与该商家 banner 共用同一段文字）

从对应商家 JSON 的 `seriesStyle` 字段原样取用，保证同一商家的所有商品图有统一的餐具/摆盘/配色倾向（比如同一家火锅店的每张菜品图都用同款铜锅或红油勺子做视觉锚点）。

## 商品真实特征（req 3c：基于真实特征，不能泛泛而谈）

**禁止**只写"a delicious dish"这种空泛描述。必须从该商品的 `name` + `description` 字段提炼出具体、可视化的细节，例如：

| 差 ❌ | 好 ✅ |
|---|---|
| "一份好吃的鸡肉饭" | "黄焖鸡米饭：深棕色酱汁裹着带皮鸡块，配青红椒圈，盛在白色米饭上" |
| "一杯奶茶" | "多肉葡萄：紫色葡萄果肉沉在奶白色茶汤里，杯口一层绵密奶盖，插着透明吸管" |

提炼依据：菜品本身的主要食材、颜色、烹饪方式带来的质感（酥脆/软糯/晶莹）、常见摆盘元素（葱花/芝麻/柠檬片等点缀）。

## 组装顺序

```
<全局规范> + <该商家 seriesStyle> + <该商品真实外观特征>
```
