# sim-waimai 后端设计（账号 / 订单 / 商家注册及周边）

日期：2026-07-09 · 分支：`feature/backend`

## 背景与目标

sim-waimai 目前是纯前端模拟应用：商家数据为构建期硬编码 JSON，购物车/地址为内存态，订单从不落盘。本次为其引入真实后端，提供：

1. **账号系统**：用户名 + 密码注册/登录，JWT 会话（httpOnly cookie）。
2. **订单记录**：下单即落库，含商品/价格/规格的不可变快照；订单历史支持游标分页（应对单用户海量订单）。
3. **用户注册商家**：登录用户可开店成为店主，并通过商家管理后台维护店铺与菜品。
4. **周边**：订单评价（评分+文字+图片，聚合评分）、收藏餐厅、餐厅推荐。
5. **对象存储**：新上传图片（店铺横幅/菜品图/评价图）走腾讯云 COS；无凭证时本地磁盘回退，开发零依赖。

## 技术选型

| 决策 | 选择 | 理由 |
|---|---|---|
| 数据库 | PostgreSQL 16（docker-compose） | 关系型用户/商家/订单模型；`(user_id, created_at DESC, id DESC)` 复合索引 + keyset 游标分页应对单用户大量订单；JSONB 承载快照与规格 |
| 服务框架 | Hono + @hono/node-server | TS 原生、内置 jwt/cookie 助手、zod-validator、testClient |
| ORM/迁移 | Drizzle ORM + drizzle-kit | 纯 TS schema、无 codegen、SQL 透明（游标分页/聚合更新） |
| 密码 | bcryptjs（cost 10） | 无原生编译依赖 |
| 金额 | 数据库存整数分（`*_fen`）；JSONB 快照保留前端元单位显示值 | 汇总无浮点漂移，前端展示不变 |
| 规格选项 | `menu_items.option_groups` JSONB（复用现有 `MenuItemOptionGroup[]` 类型） | 永远整体读写、不做关系查询，规范化零收益 |
| 订单行 | `orders.items` JSONB（不建 order_items 表） | 需求是不可变快照，单表扫描即可分页 |
| 仓库布局 | npm workspaces：根为客户端，新增 `shared/`、`server/` | 共享类型/DTO 直接以 `.ts` 源码导出，Vite 转译、tsx 运行、`tsc -b` 项目引用检查 |
| 图片上传 | 客户端直传 COS 预签名 PUT URL；COS 未配置时回退 `/api/uploads/local/*` | 图片字节不过 Node 服务；开发无需真实凭证 |

## 数据库 Schema 摘要

- `users(id uuid PK, username unique-lower, password_hash, created_at)`
- `restaurants(id text PK, owner_id uuid NULL→users, sort_order, name, category, rating, rating_count, rating_sum, monthly_orders, delivery_fee_fen, min_order_fen, delivery_time, emoji, bg_color, tags jsonb, menu_categories jsonb, banner_image, is_active, created_at)`；索引：category / owner_id / (rating DESC, monthly_orders DESC)。owner_id 为 NULL 表示平台预置商家。
- `menu_items(PK(restaurant_id, id), name, description, price_fen, calories, emoji, menu_category, popular, image, option_groups jsonb, is_listed, sort_order)`
- `orders(id uuid PK, user_id→users, restaurant_id→restaurants, restaurant_snapshot jsonb, status pending|delivering|completed, items jsonb, subtotal_fen, delivery_fee_fen, total_fen, total_calories, address_snapshot jsonb, rider_snapshot jsonb NULL, created_at, completed_at)`；核心索引 `(user_id, created_at DESC, id DESC)`，另 `(restaurant_id, created_at DESC)`。
- `reviews(id uuid PK, order_id unique→orders, user_id, restaurant_id, rating 1..5, content, photos jsonb, created_at)`；索引 `(restaurant_id, created_at DESC)`。评分聚合在同事务内更新 restaurants.rating_sum/rating_count/rating。
- `favorites(PK(user_id, restaurant_id), created_at)`

无 sessions 表：无状态 JWT，登出即清 cookie。

## API 概览（均在 `/api` 下）

认证：公开 / 登录（requireAuth）/ 店主（owner 校验）。

- 认证：`POST /auth/register`、`POST /auth/login`、`POST /auth/logout`、`GET /auth/me`
- 餐厅：`GET /restaurants?category=`、`GET /restaurants/:id`（映射回现有 `Restaurant` 形状，分→元）、`GET /restaurants/:id/reviews?cursor=`
- 推荐：`GET /recommendations`（登录按近 50 单品类加权；冷启动按评分×月售）
- 订单：`POST /orders`（服务端按数据库重新计价，构建快照）、`GET /orders?cursor=`、`GET /orders/:id`、`PATCH /orders/:id/status`（pending→delivering 时落 rider 快照；→completed 时记 completed_at 并加月售）
- 评价：`POST /orders/:id/reviews`（仅 completed 且未评过）
- 收藏：`GET /favorites`、`PUT /favorites/:rid`、`DELETE /favorites/:rid`
- 商家：`GET/POST /merchant/restaurants`、`PATCH /merchant/restaurants/:id`、菜品 `POST/PATCH/DELETE /merchant/restaurants/:id/items[/:itemId]`（删除=下架 is_listed=false）
- 上传：`POST /uploads/presign`；本地回退 `PUT/GET /uploads/local/:key`

游标：`base64url(JSON [createdAtISO, id])`，`WHERE (created_at, id) < ($2,$3) ORDER BY created_at DESC, id DESC LIMIT n+1`，响应 `{items, nextCursor}`。

JWT：HS256，payload `{sub, username}`，7 天；cookie `sw_token`（httpOnly, SameSite=Lax, path=/，生产 secure）。开发经 Vite 代理同源，无需 CORS。

## 前端变更摘要

- 新增 `src/lib/api.ts`（fetch 封装）、`src/lib/upload.ts`、`AuthContext`；Provider 层级 Theme > Auth > Address > Cart。
- 新页面：`/login`、`/register`、`/profile`（个人中心）、`/orders`（历史，游标加载更多）、`/orders/:id`（详情+评价表单）、`/favorites`、`/merchant`（我的店铺+开店）、`/merchant/:id`（店铺/菜品管理）。
- 改造：Home/Restaurant 改为 API 取数（首页加推荐区、餐厅页加收藏与评价区）；Cart 结算调 `POST /orders`；Order/Tracking/Done 携带 orderId 推进状态、骑手来自订单快照；`src/data/types.ts` 改为 re-export shared；运行时不再 glob JSON（JSON 仅作种子数据）。
- `assetUrl.ts` 支持绝对 URL（COS）与 `/api/` 路径直通。
- AddressContext 保持现状（单地址内存态），地址以快照形式随订单落库。

## 种子与工具链

- `server/src/db/seed.ts`：读取 `src/data/restaurants/*.json` 幂等 upsert（餐厅 ON CONFLICT DO UPDATE；菜品先删后插），元→分转换，剥离 prompt 字段。
- `docker-compose.yml`（postgres:16-alpine）、`.env.example`（DATABASE_URL/JWT_SECRET/PORT/COS_*）、Vite 代理 `/api → :3001`、根脚本 `dev`（concurrently 双进程）/`db:up`/`db:migrate`/`db:seed`/`test:server`。

## 测试与验收

- 服务端 vitest + hono testClient：注册登录回路、下单服务端计价（篡改客户端价格无效）、状态机约束、评价唯一性与聚合、游标分页（45 单 3 页无重漏）、收藏幂等、越权 403。
- 终验：`npm run lint`、`npm -w server run typecheck`、`npm run build`、`npm run test:server`、浏览器全流程冒烟。
