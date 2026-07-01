---
name: restaurant-image-gen
description: |
  为 sim-waimai 这个外卖模拟 App 生成新商家/商品数据（写入 src/data/restaurants/<id>.json），
  并为每个商家 banner 和每个商品配一段风格统一、基于真实特征的文生图 prompt，调用
  tools/generate-image.mjs（火山引擎 Ark Seedream 文生图 API）实际生成图片、写回图片路径字段。
  也支持给已有商家做"补图"：只为缺图的商家/商品生成，可中断后继续。
  触发词："新增一个商家"、"加个商家并配图"、"给 XX 生成图片"、"给 XX 补图"、"批量生成商品图"。
---

# Restaurant Image Gen

## 前置条件

- 运行 `node tools/generate-image.mjs --dry-run ...` 不需要任何配置；真正联网生成图片前，确认仓库根目录存在 `.env`（复制 `.env.example`）并填好 `ARK_API_KEY`、`ARK_IMAGE_MODEL`。如果没有配置，先提醒用户去 Volcengine Ark 控制台获取，不要用假 key 硬跑。
- 先读 `references/data-conventions.md`（数据字段/id前缀/价格区间约定）、`references/visual-style-banner.md`、`references/visual-style-menu-item.md`（prompt 组装规范），这三份是本 skill 生成内容的依据，不要凭空发挥。

## 两种模式

1. **新增商家**：用户要加一个全新商家（给了名字/菜系，或让你随机想一个还没出现过的）。
2. **补图**：用户说"给 XX 商家生成/补图片"，商家数据已存在，只是缺 `bannerImage`/`image`。

先判断用户要哪种模式；不确定就问一句。

## 模式一：新增商家

### 步骤 1 — 确定选题

问用户（或按用户给的信息确定）：商家名字、菜系/品类、大致调性。如果用户说"随便生成"，先 `ls src/data/restaurants/` 看已有哪些商家，挑一个还没出现过的菜系/品牌。

### 步骤 2 — 生成数据 JSON

按 `references/data-conventions.md`：
- 取当前 `src/data/restaurants/` 下最大 `order` + 1。
- 写 30+ 个商品，覆盖 5+ 个 `menuCategories`，2~4 个 `popular: true`。
- 商品 `id` 用 `<商家简码>_<缩写>` 前缀，价格/卡路里参考同类商家的区间。
- 如果是全新菜系分类，同步更新 `src/data/types.ts` 的 `Category` 联合类型 和 `src/data/restaurants.ts` 里的 `CATEGORIES` 数组。
- 写入 `src/data/restaurants/<id>.json`。此时 `bannerImage`/`image`/`imagePrompt`/`bannerImagePrompt`/`seriesStyle` 都先不填。

### 步骤 3 — 生成 prompt

1. 按 `references/visual-style-banner.md` 的"商家系列风格"部分，写一段这家商家的 `seriesStyle`（配色/摆盘/氛围关键词，2~4 句话），存入 JSON 的 `seriesStyle` 字段。
2. 组装 `bannerImagePrompt` = 全局banner规范 + `seriesStyle` + 该商家最具代表性的场景/招牌菜描述，存入 `bannerImagePrompt`。
3. 对每个商品，组装 `imagePrompt` = 全局商品图规范 + 同一个 `seriesStyle` + 从该商品 `name`/`description` 提炼出的真实外观特征（颜色/食材/质感，参考 `visual-style-menu-item.md` 里的对照表），存入每个 MenuItem 的 `imagePrompt` 字段。

这一步做完，先把更新后的 JSON 写回磁盘（`bannerImagePrompt`/`seriesStyle`/每个商品的 `imagePrompt` 都已经落盘），再进入步骤 4，方便中途出错也不丢生成好的 prompt。

### 步骤 4 — 调用工具生成图片

对 banner：
```
node tools/generate-image.mjs --kind banner --prompt "<bannerImagePrompt>" --out public/restaurants/<id>/banner.jpg
```
对每个商品：
```
node tools/generate-image.mjs --kind item --prompt "<该商品 imagePrompt>" --out public/restaurants/<id>/items/<itemId>.jpg
```

处理规则：
- 退出码 `0`：成功，把脚本打印出的相对路径（`public/` 之后的部分，**不带开头斜杠**，如 `restaurants/<id>/banner.jpg`）写回 JSON 对应的 `bannerImage`/`image` 字段。
- 退出码 `2`：这一张审核不过/生成失败，记录下来（哪个商品失败、失败原因），跳过继续下一张，不要中断整批。
- 退出码 `1` 或 `3`：致命错误（鉴权/模型配置/网络问题），停下来，把错误信息完整反馈给用户，不要继续重复调用（大概率后面每张都会失败）。

商品数量多（30+ 张 + 1 张 banner），生成过程较长，逐个执行、逐个回填 JSON，不要攒到最后一次性写文件（防止中途失败丢进度）。

### 步骤 5 — 收尾校验

跑 `npm run build`（`tsc -b && vite build`），确认新 JSON 类型检查通过、聚合器正常读取。有报错先处理再告诉用户完成。

## 模式二：补图

1. 读取 `src/data/restaurants/<id>.json`。
2. 如果 `seriesStyle`/`bannerImagePrompt` 还没有，按步骤 3 的方法先补上（说明这个商家是在本 skill 上线前创建的老数据，或者是新增数据但还没生成过图）。
3. `bannerImage` 已存在 → 跳过 banner；否则按步骤 4 生成。
4. 遍历 `menu`，`image` 已存在的商品跳过；没有 `image` 的，先看有没有 `imagePrompt`（没有就先按步骤 3 生成一条），再调用工具生成图片、回填。
5. 每次成功回填后就落盘保存该 JSON 文件，这样补图过程可以随时中断、下次从断点继续（已有 `image` 的天然会被跳过）。
6. 完成后同样跑 `npm run build` 收尾校验。

## 参考文档

| 文件 | 用途 |
|---|---|
| `references/data-conventions.md` | 商品/商家数据字段、id 前缀、价格与卡路里合理区间、分类扩展方法 |
| `references/visual-style-banner.md` | 商家 banner prompt 的统一规范 + 系列风格 + 真实特色组装方法 |
| `references/visual-style-menu-item.md` | 商品图 prompt 的统一规范 + 系列风格 + 真实特征提炼方法（含好/差示例对照） |

## 工具

| 脚本 | 用途 | 调用方式 |
|---|---|---|
| `tools/generate-image.mjs` | 调用火山引擎 Ark 文生图接口，写出一张图片 | `node tools/generate-image.mjs --kind banner\|item --prompt "..." --out public/restaurants/<id>/...` （加 `--dry-run` 可不联网预览请求体） |
