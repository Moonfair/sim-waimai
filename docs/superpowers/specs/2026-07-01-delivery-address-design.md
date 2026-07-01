# 收货地址填写功能

## 背景

sim-waimai 的首页顶部和购物车确认订单页各有一处硬编码的假地址展示（"北京市朝阳区三里屯" / "三里屯太古里北区 N3-15（假地址）" / "联系电话：138****1234"），完全没有状态支撑，用户无法编辑。同时首页顶部还有一个"搜索餐厅或菜品"占位框，只是一个静态 `<span>`，没有绑定任何 state 或过滤逻辑，是个从未生效的死功能。

本次改动：让地址变为真正可编辑的功能，并删除这个从未生效的搜索占位框。

## 范围

- 单一"当前地址"，不做地址簿/多地址管理。
- 字段：收件人姓名、手机号、收货地址（自由文本，不做省市区结构化拆分）。
- 编辑入口：首页顶部地址栏 + 购物车确认订单页地址卡片，两处都可点击，弹出同一个底部编辑面板；保存后两处同步显示。
- 状态只保存在内存中（React Context），刷新页面即重置，与购物车现有行为一致，不引入 localStorage。
- 编辑面板需展示一行提示："以上信息仅保存在本机浏览器中，不会上传到任何服务器"。
- 顺带删除首页顶部的"搜索餐厅或菜品"死代码块。

## 现状（已核实）

- `src/pages/Home.tsx:29-34` — 硬编码地址栏（📍 + 地址文本 + 假 ETA "预计25-40分钟"，ETA 不在本次范围内，原样保留）。
- `src/pages/Home.tsx:36-40` — 死的搜索占位框，纯 `<span>`，无 state、无 onClick、无过滤逻辑，全代码库唯一一处引用，删除后无其他影响。
- `src/pages/Cart.tsx:43-60` — 完整的假地址卡片：收件地址(49)/详细地址(52)/联系电话(53)，外加一个不相关的配送 ETA 提示(56-59，本次不动)。
- `src/context/CartContext.tsx` 中没有地址字段；`clearCart()`（用于清空购物车/切换商家）会重置 `items`/`restaurant`，地址不应该跟着被清空，所以不复用/扩展 CartContext，而是新增独立的 `AddressContext`。
- `App.tsx` 目前只包一层 `CartProvider`；无独立的全局 Layout/Header 组件，每个页面自己写头部。
- 现有唯一的表单控件样式参考：`src/pages/Cart.tsx` 备注 `<textarea>`（`border border-gray-100 rounded-lg p-2.5 text-sm text-gray-600 resize-none outline-none focus:border-orange-300`）。
- 现有唯一的底部弹出面板参考：`src/components/MenuItemOptionsSheet.tsx`（`fixed inset-0 bg-black/40` 遮罩 + `fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[480px] bg-white rounded-t-2xl` 面板），新面板复用同一视觉语言。

## 设计

### 1. `src/context/AddressContext.tsx`（新建）

```ts
export interface AddressInfo {
  recipientName: string;
  phone: string;
  address: string;
}

interface AddressContextType {
  addressInfo: AddressInfo;
  setAddressInfo: (info: AddressInfo) => void;
}
```

- Provider 内部 `useState<AddressInfo>` 初始值：`{ recipientName: '', phone: '', address: '北京市朝阳区三里屯 三里屯太古里北区 N3-15' }`（地址延用现有假文本，收件人/手机号默认留空，用占位符提示填写）。
- 结构与 `CartContext.tsx` 的 `createContext`/`Provider`/`useXxx` hook 写法保持一致，`useAddress()` 抛错方式照抄 `useCart()`。
- 在 `App.tsx` 里与 `CartProvider` 并列包一层 `AddressProvider`（顺序不敏感，两者互不依赖）。

### 2. `src/components/AddressEditSheet.tsx`（新建）

```ts
interface Props {
  onClose: () => void;
}
```

- 内部本地 state 初始化自 `useAddress().addressInfo`（编辑态草稿，避免每次按键都写全局 state）。
- 三个字段：
  - 收件人：`<input type="text">`
  - 手机号：`<input type="tel">`
  - 收货地址：`<textarea rows={2}>`
  三者都复用 Cart.tsx 备注框的 Tailwind 样式（`border border-gray-100 rounded-lg p-2.5 text-sm ... focus:border-orange-300`），做成统一的 label+input 结构。
- 面板底部：一行灰色小字隐私提示 + "保存"按钮（`bg-orange-500 text-white py-3 rounded-2xl font-black`，视觉对齐 `MenuItemOptionsSheet` 的"加入购物车"按钮）。
- "保存"调用 `setAddressInfo(草稿)` 后 `onClose()`。
- 整体结构（遮罩 + 底部面板 + 头部标题"收货信息" + 关闭×按钮）照抄 `MenuItemOptionsSheet.tsx` 的外层结构。

### 3. `src/pages/Home.tsx` 改动

- 删除第 36-40 行整个"Search"块。
- 地址栏（29-34行）：
  - 加 `onClick={() => setSheetOpen(true)}`（新增本地 `sheetOpen` state）。
  - 文本从硬编码改为 `{addressInfo.address}`。
  - ETA 文本原样保留（不在本次范围）。
- 底部条件渲染 `{sheetOpen && <AddressEditSheet onClose={() => setSheetOpen(false)} />}`。

### 4. `src/pages/Cart.tsx` 改动

- 引入 `useAddress()`，新增本地 `sheetOpen` state。
- 地址卡片（43-60行）整体加 `onClick` 打开同一个 `AddressEditSheet`（`cursor-pointer`）。
- 展示逻辑：
  - 若 `recipientName` 或 `phone` 为空 → 显示一行提示"点击填写收货信息"（替代原第49/52/53行的三行硬编码文本）。
  - 若都已填写 → 第一行 `{recipientName} {phone}`（加粗），第二行 `{address}`（灰色小字）。
- 配送 ETA 提示（56-59行）不动。
- 页面底部渲染 `{sheetOpen && <AddressEditSheet onClose={...} />}`。

## 验证方式

无自动化测试，手动过 `npm run dev`：

1. 首页顶部地址栏可点击，弹出编辑面板，字段初始值符合默认（地址有预填文本，收件人/手机号为空占位符）。
2. 编辑三个字段后点"保存"，首页地址栏文字同步更新。
3. 加购后进入购物车页，地址卡片显示与首页一致的收件人/手机号/地址（若已在首页填写过）。
4. 在购物车页再次编辑并保存，返回首页确认地址栏也同步更新（验证共享同一个 Context，而非各页面独立状态）。
5. 未填写收件人/手机号时，购物车地址卡片显示"点击填写收货信息"提示而非空白。
6. 确认首页"搜索餐厅或菜品"占位框已消失，其余首页布局（分类 tab、餐厅列表、底部购物车条）不受影响。
7. `tsc --noEmit`、`npm run build`、`npm run lint` 全部通过。

## 关键文件

- `src/context/AddressContext.tsx`（新建）
- `src/components/AddressEditSheet.tsx`（新建）
- `src/pages/Home.tsx` — 删除搜索块，地址栏接入 Context 与编辑面板
- `src/pages/Cart.tsx` — 地址卡片接入 Context 与编辑面板
- `src/App.tsx` — 新增 `AddressProvider` 包裹
