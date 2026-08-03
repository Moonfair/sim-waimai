# 商店详情页菜单连续滚动 设计

## 背景

`src/pages/Restaurant.tsx` 当前菜单区是"点击式"的:左侧分类栏 + 右侧只渲染 `activeMenuCat` 过滤出的单个分类商品。点击左侧分类才切换右侧内容,向下滑动看不到下一个分类。

希望改成类似美团/饿了么的连续滚动体验:右侧把所有分类的商品按顺序连续排列,向下滑动自然进入下一个分类;滑动过程中左侧分类自动同步高亮;点击左侧分类平滑滚动到对应位置。整页仍保持现有的自然滚动(不引入独立滚动容器)。

## 范围确认(已与用户对齐)

- 交互方式:连续滚动 + 左侧联动高亮(滚动时自动更新高亮,点击时平滑滚动跳转)。
- 空分类(该分类下无商品)处理:右侧**跳过**不渲染,左侧分类栏仍正常显示且可点击。

## 渲染结构变化

- 去掉现有的 `filteredMenu`(单一分类过滤)写法。
- 改为遍历 `restaurant.menuCategories`,为每个分类分组出该分类下的商品列表;跳过商品数为 0 的分类。
- 每个非空分类渲染为一个 `<section id={`menu-cat-${cat}`}>`(标题 + 商品列表),按 `menuCategories` 原有顺序连续排列在右侧容器内。

## 滚动联动

- 用 `IntersectionObserver` 监听每个分类 `section`。当某分类 section 的顶部进入视口内的识别区间(如 `rootMargin: '-64px 0px -70% 0px'`,即视口顶部往下一小段作为触发线,避免临界抖动/多个分类同时"命中")时,将其设为 `activeMenuCat`。
- 点击左侧分类按钮:
  - 立即 `setActiveMenuCat(cat)`(不等观察者回调,保证点击响应即时)。
  - 对应 `section` 调用 `scrollIntoView({ behavior: 'smooth', block: 'start' })`。
  - 跳转期间(约 600ms,用 `setTimeout` 配合一个 ref 标志位)临时忽略 IntersectionObserver 的更新,避免平滑滚动经过中间分类时高亮乱跳;超时后恢复正常的滚动监听。

## 左侧分类栏保持可见

- 左侧分类栏容器加 `sticky top-0 self-start`,使其在菜单区域内滚动时吸顶;菜单区域结束(进入评价区 `ReviewList`)后随父容器自然滚出,不做全局固定定位。
- 加 `max-h-screen overflow-y-auto` 兜底,防止分类数量过多时左侧栏本身超出视口高度。

## 边界情况

- 所有分类下商品都为空(理论上不太可能出现,因为 `menuCategories` 通常来自有商品的分类):右侧不渲染任何分类,可复用现有的"暂无菜品"文案作为整体兜底。
- 店铺打烊(`isActive === false`):不影响滚动/高亮逻辑,购买行为仍由已有的 `purchasable` prop 透传给 `MenuItemComponent` 控制,本次不改动。
- 首次加载:`activeMenuCat` 默认取 `menuCategories[0]`(沿用现状),对应 IntersectionObserver 尚未触发前的初始高亮。

## 影响范围

| 层 | 文件 | 改动类型 |
|---|---|---|
| 前端 | `src/pages/Restaurant.tsx` | 菜单渲染结构改为按分类分组连续渲染;新增 IntersectionObserver 滚动联动;左侧分类栏加 sticky |

不涉及后端、数据库、共享类型改动。不新增依赖(`IntersectionObserver` 为浏览器原生 API)。
