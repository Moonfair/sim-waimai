# 吃了嘛外卖 (sim-waimai)

节省外卖费和卡路里的**假外卖 App**：像点外卖一样浏览、下单、看骑手配送，但不花钱、不长胖。

前端 React 19 + Vite + Tailwind；后端 Hono + PostgreSQL（Drizzle ORM），npm workspaces 单仓：

```
├─ src/       # 客户端（Vite React，root workspace）
├─ shared/    # @sim-waimai/shared：前后端共享类型/DTO
├─ server/    # @sim-waimai/server：Hono API + Drizzle schema/迁移/种子
└─ docs/superpowers/{specs,plans}/  # 设计与实施文档
```

## 功能

- 🏠 餐厅浏览/品类筛选、✨ 个性化推荐（按历史订单品类）
- 👤 账号系统（用户名+密码，JWT httpOnly cookie）
- 🛒 购物车 → 下单（服务端计价与快照）→ 骑手配送动画 → 订单完成
- 📋 订单历史（keyset 游标分页，应对海量订单）与订单详情
- ⭐ 订单评价（评分+文字+图片，餐厅聚合评分精确更新）
- ❤️ 收藏餐厅
- 🏪 用户开店与商家管理后台（店铺信息/营业状态/菜品与规格组管理）
- 🖼️ 图片上传：腾讯云 COS 预签名直传；未配置 COS 时本地磁盘回退

## 本地开发

前置：Node 20+、Docker（跑 PostgreSQL）。

```bash
npm install
cp .env.example .env        # 默认值即可本地跑通；COS 变量可留空
npm run db:up               # 启动 postgres:16 容器
npm run db:migrate          # 应用 Drizzle 迁移
npm run db:seed             # 导入 14 家预置餐厅（幂等，可重复执行）
npm run dev                 # 同时启动 Vite(5173) 和 API(3001，经 /api 代理)
```

打开 http://localhost:5173/sim-waimai/ 即可使用。

## 常用命令

| 命令 | 作用 |
|---|---|
| `npm run dev` | web + api 并行开发 |
| `npm run dev:client` | 仅前端 |
| `npm run build` | `tsc -b`（含 shared/server 类型检查）+ vite build |
| `npm run lint` | oxlint |
| `npm run test:server` | 服务端 vitest（需要数据库在运行） |
| `npm -w server run generate` | 修改 schema 后生成迁移 |
| `npm run db:migrate` / `db:seed` | 迁移 / 种子 |

## 环境变量（.env）

- `DATABASE_URL` — 默认匹配 docker-compose 的本地 Postgres
- `JWT_SECRET` — 生产必须修改
- `PORT` — API 端口（默认 3001，Vite 代理 `/api` 指向它）
- `COS_SECRET_ID/COS_SECRET_KEY/COS_BUCKET/COS_REGION`（可选）— 配置后图片直传腾讯云 COS；留空则上传到 `server/uploads/` 本地回退
- `VITE_RUM_ID`（可选）— 腾讯云 RUM 前端监控

架构与 API 细节见 `docs/superpowers/specs/2026-07-09-backend-design.md`。
