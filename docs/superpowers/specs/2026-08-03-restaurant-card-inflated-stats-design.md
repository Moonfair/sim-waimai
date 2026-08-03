# 首页店铺卡片"销量/评论数"放大展示 设计

## 背景

首页 `RestaurantCard.tsx` 目前展示的月售数字(`restaurant.monthlyOrders`)是真实值,评论数(`restaurant.ratingCount`)则完全没有在卡片上展示(只在详情页评论列表、商家后台、海报模板里出现)。为了让首页看起来更"热闹",希望卡片上展示的销量和评论数在真实值基础上按 20 倍放大,并叠加随机波动,单纯服务于展示效果。

## 范围确认(已与用户对齐)

- **只改前端展示层**,不改数据库、不改任何后端接口/字段。真实的 `monthlyOrders`、`ratingCount` 完全不受影响。
- **只改首页 `RestaurantCard.tsx` 这一个展示点**。详情页 `ReviewList`、商家后台 `MerchantReviews`、海报模板 `RestaurantPosterTemplate` 继续显示真实数据,不做任何改动。
- 真实值为 0(新店没有真实销量/评价)时,展示值也是 0,不做凭空捏造的下限兜底。

## 放大与波动公式

对销量、评论数分别独立计算:

```
displayValue = round(实际值 × 20 × jitter)
jitter = 1 + (seededRandom(seed) - 0.5) × 0.24   // ±12% 抖动
```

- `seededRandom(seed)` 是一个确定性伪随机函数:给定字符串 seed,始终返回同一个 `[0, 1)` 的数(用简单字符串 hash + 位运算实现,不依赖 `Math.random()`,不需要任何外部依赖)。
- **种子设计**:`seed = ${restaurant.id}:${metric}:${dateStr}`,其中 `metric` 是 `'sales'` 或 `'reviews'`,`dateStr` 是当天日期(`YYYY-MM-DD`,本地时区)。
  - 同一家店、同一天内,不管刷新页面还是重新进首页,展示数字保持不变。
  - 跨天会自然变化一次,不需要任何额外状态存储或定时任务。
  - 销量和评论数用不同的 `metric` 段,两个数字的波动互相独立,不会同步涨跌,看起来更自然。

## UI 展示

卡片信息行从:

```
★ 4.8 | 月售100+ | 起送¥20
```

改为:

```
★ 4.8(2059+) | 月售2016+ | 起送¥20
```

- 评论数以"评分(评论数+)"的形式紧跟在星级评分后面,不再单独占一个 `|` 分隔的段。
- 月售、评论数都复用现有的">1万显示为 X.X万+"格式化规则(当前 `RestaurantCard.tsx` 里月售已有的 `monthlyOrders > 10000 ? (monthlyOrders/10000).toFixed(1)+'万' : monthlyOrders` 逻辑,评论数同理)。

## 实现

新增一个纯函数工具模块 `src/lib/displayStats.ts`:

- `seededRandom(seed: string): number` —— 字符串 hash(如 `Math.imul` 累加)+ finalize mix,返回 `[0,1)`。
- `getDisplayStats(restaurantId: string, monthlyOrders: number, ratingCount: number): { displaySales: number; displayReviews: number }` —— 内部计算当天 `dateStr`,分别调用 `seededRandom` 得到两个 jitter,套用放大公式,`round` 取整后返回。
- `formatCount(n: number): string` —— 复用/提取现有">1万显示 X.X万+"的格式化逻辑,供月售和评论数共用。

`src/components/RestaurantCard.tsx` 改动:

- 引入 `getDisplayStats` 和 `formatCount`,用 `restaurant.id`、`restaurant.monthlyOrders`、`restaurant.ratingCount` 算出 `displaySales`、`displayReviews`。
- 星级评分那一段后追加 `({formatCount(displayReviews)}+)`。
- 月售那一段的格式化改为调用 `formatCount(displaySales)`。

## 明确不处理的边界情况

- 不做单元测试(纯展示层的美化效果,公式已在设计阶段与用户对齐,行为简单确定)。
- 不考虑时区切换导致同一"自然日"内种子跳变的边界情况——本项目其他地方也没有做时区处理,保持一致。

## 影响范围小结

| 层 | 文件 | 改动类型 |
|---|---|---|
| 前端 | `src/lib/displayStats.ts` | 新增文件 |
| 前端 | `src/components/RestaurantCard.tsx` | 引入放大后的展示值,新增评论数展示 |

不涉及共享类型、后端、数据库改动。
