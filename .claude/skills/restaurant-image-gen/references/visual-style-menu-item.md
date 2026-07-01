# 商品图统一视觉规范

用于生成每个 `MenuItem.imagePrompt`（对应 `MenuItem.image`，1024×1024 正方形缩略图，展示在商家详情页的商品行里）。

## 固定全局规范（每个商品 prompt 都必须包含，逐字或等价改写）

```
Top-down or 45-degree angle product photography of a single menu item, square 1:1 crop, plain
neutral light-colored background (consistent across the whole app's item photo set), soft
even studio lighting, consistent color grading and exposure, no text/watermark/logo, no
hands/utensils holding food, item centered and fully visible, appetizing and true-to-life.
Show ONLY this one item and its own container (one bowl, one plate, or one cup/glass) —
absolutely no additional bowls, plates, side dishes, rice, or extra cups in frame. If this
item is a beverage, the entire frame must contain nothing but that single cup/glass.
```

这是"统一规范"，保证不同商家、不同商品的缩略图在同一个列表里滚动时观感一致（角度、留白、打光都统一），不会有的图特写有的图俯拍、有的图背景干净有的图背景杂乱。

## 商家系列风格（`seriesStyle`，与该商家 banner 共用同一段文字）

从对应商家 JSON 的 `seriesStyle` 字段原样取用，保证同一商家的所有商品图有统一的餐具/摆盘/配色倾向（比如同一家火锅店的每张菜品图都用同款铜锅或红油勺子做视觉锚点）。

**踩过的坑**：`seriesStyle` 里**不要点名任何具体名词**——不只是食材/配料/garnish（"米饭"、"红椒绿椒葱花"），连**器皿/包装类名词**（"纸质餐盒"、"红色餐盘"）也不行。哪怕本意只是形容质感或品牌调性，模型都会把提到的名词当成"每张图都要出现"的实体元素，导致饮品图里凭空多出一份炸鸡盒、汤图里多出一碗饭。`seriesStyle` 只准写**纯抽象**的色调/光线氛围形容词（比如"暖黄色调"、"明快活力"），不能出现任何食材、配料、器皿、包装的具体名词，这些具体内容只放在每个商品自己的真实特征描述里。饮品类商品尤其容易触发这个问题，全局模板已经加了"如果是饮品，画面里只能有这一杯"的强约束，但实践发现光靠这条约束不够，`seriesStyle` 本身干净（零具体名词）才是关键。

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
