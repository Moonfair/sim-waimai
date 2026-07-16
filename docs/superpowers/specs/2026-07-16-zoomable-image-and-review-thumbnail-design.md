# 全站图片点击放大 & 审核列表缩略图 设计

日期：2026-07-16

## 背景与目标

1. 审核列表页（`src/pages/AdminReview.tsx`）目前每条记录左侧只显示 emoji 方块，审核员看不到用户实际上传的图片，需要点进详情页才能看到。列表页应直接展示一张小尺寸缩略图。
2. 系统中所有图片（店铺横幅、菜品图、评价图、编辑预览、审核图等）应支持点击后放大查看。

## 决策记录

- **点击冲突**：卡片本身可点击跳转（首页店铺卡片、菜单行等）的场景，点击图片本身放大（`stopPropagation` 阻止冒泡），点击卡片其余区域保持原有跳转/加购行为。
- **放大交互**：单图放大即可。全屏遮罩居中大图，点击任意处 / 右上角 × / Esc 关闭。不做多图左右切换、不做双指缩放。

## 方案

采用可复用组件方案：新建 `<ZoomableImage>` 作为 `<img>` 的 drop-in 替代，内部自管放大状态，通过 portal 渲染预览层。不引入全局 Context（对单图放大是过度设计）。

## 组件设计：`src/components/ZoomableImage.tsx`

```tsx
interface ZoomableImageProps {
  /** 原始图片 path（COS key、绝对 URL 或 /api/ 路径），组件内部用 assetUrl() 解析 */
  src: string;
  alt: string;
  /** 缩略图 <img> 的样式，与原用法保持一致 */
  className?: string;
}
```

行为：

- 渲染 `<img src={assetUrl(src)} alt={alt} className={className} />`，`cursor-zoom-in`。
- 点击图片：`e.stopPropagation()`，打开预览。调用方不再需要自己包 `assetUrl()`。
- 预览层：`createPortal(…, document.body)`，`fixed inset-0 z-50` 黑色半透明遮罩（`bg-black/80`），图片 `max-w-[90vw] max-h-[85vh] object-contain` 居中，右上角 × 按钮。
- 关闭：点击遮罩任意处、点击 ×、按 Esc（`useEffect` 监听 `keydown`，仅预览打开时挂载）。
- 深浅色模式：遮罩本身为黑色半透明，两种主题下均可用，无需额外适配。

## 替换范围（12 处 `<img>`）

| 文件 | 位置 | 说明 |
| --- | --- | --- |
| `src/components/RestaurantCard.tsx` | 22 | 首页店铺卡片横幅（卡片可点进店，图片点击需 stopPropagation） |
| `src/components/MenuItem.tsx` | 41 | 菜单行菜品图 |
| `src/components/ReviewList.tsx` | 86 | 评价图片（可多张，逐张单图放大） |
| `src/components/ReviewForm.tsx` | 86 | 评价表单已选图片预览 |
| `src/components/MenuItemEditor.tsx` | 161 | 菜品编辑图片预览 |
| `src/pages/Home.tsx` | 103 | 首页图片 |
| `src/pages/Restaurant.tsx` | 93 | 店铺页横幅 |
| `src/pages/OrderDetail.tsx` | 76 | 订单详情菜品图 |
| `src/pages/MerchantEdit.tsx` | 201 | 商家编辑横幅预览 |
| `src/pages/MerchantHome.tsx` | 185 | 商家首页图片 |
| `src/pages/AdminReviewDetail.tsx` | 114、141 | 审核详情横幅 / 菜品图 |

替换时删除调用方原有的 `assetUrl(...)` 包裹（组件内部解析）；行号为设计时快照，以实际代码为准。若个别 `<img>` 带有 onClick 等特殊逻辑，逐处确认后迁移。

## 审核列表缩略图

- `shared/src/api.ts`：`ModerationItemDto` 增加字段：

  ```ts
  /** 待审图片：restaurant 为 bannerImage，menuItem 为 image；无图为空。 */
  image?: string | null;
  ```

- `server/src/routes/admin.ts`：
  - `toRestaurantModerationItem`：`image: row.bannerImage`
  - `toItemModerationItem`：`image: row.image`
- `src/pages/AdminReview.tsx`：列表卡片左侧 `w-12 h-12` 方块——有图时渲染 `<ZoomableImage src={item.image} className="w-12 h-12 rounded-xl object-cover flex-shrink-0" />`，无图时保持现有 emoji 方块兜底。

## 错误处理

- 图片加载失败：浏览器默认 broken image 行为，不额外处理（与现状一致）。
- `image` 为空/undefined：审核列表回退 emoji；`ZoomableImage` 不接受空 src（调用方条件渲染，与现有 `item.image && <img …>` 模式一致）。

## 测试

- **server**（vitest，已有基建）：`server/src/test/moderation.test.ts` 补充断言——带图的店铺/菜品进入审核队列时，DTO 的 `image` 字段返回对应的 `bannerImage` / `image` 值。
- **web**：项目前端测试仅覆盖纯逻辑（无 testing-library/jsdom），`ZoomableImage` 交互以手动验证为主：
  - 审核列表显示缩略图，点击放大，不触发卡片内其他行为；
  - 首页店铺卡片：点横幅放大、点卡片其他区域进店；
  - 菜单行：点菜品图放大、点行其余区域正常加购；
  - Esc / 点遮罩 / 点 × 均可关闭；
  - 深色模式下预览正常。

## 不做的事（YAGNI）

- 多图左右切换、页码指示
- 双指/滚轮缩放、拖拽
- 图片懒加载、预加载优化
- 放大层内的跳转入口
