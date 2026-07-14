# sim-waimai 生产部署设计（腾讯云 CVM，前后端同源）

日期：2026-07-14 · 分支：`main`

## 背景与目标

前端目前经 `.github/workflows/deploy.yml` 自动发布到 GitHub Pages；后端（`server/`）自实现以来从未部署过，只有本地 `docker-compose.yml` 起一个开发用 Postgres。

用户已有一台全新腾讯云 CVM（TencentOS/CentOS，只装了系统），要把前端 + 后端 + 数据库整体部署上去，并配好 Nginx 反代/HTTPS。目标：前后端**同域**部署（而非前端留在 GH Pages、后端单独走跨域），从根源避免跨站 Cookie/CORS 的复杂度和后续浏览器对三方 Cookie 的收紧风险。

## 技术选型

| 决策 | 选择 | 理由 |
|---|---|---|
| 部署形态 | 前端静态文件 + 后端容器，同域、同一台 CVM | 避免跨站 `SameSite=None` Cookie + CORS；`fetch('/api...')` 相对路径天然可用，前端代码零改动 |
| 操作系统 | TencentOS / CentOS（用户已定） | 决定用 `yum`/`dnf` 装 Docker，而非 `apt` |
| 数据库位置 | 同一台 CVM 上用 Docker 跑 Postgres 16 | 和本地 `docker-compose.yml` 保持一致，成本最低；不外映射端口，只在 compose 内部网络给 `server` 访问 |
| 后端运行方式 | Docker 容器，`node:20-alpine` | `sharp` 在 lockfile 里已有 `linuxmusl-x64` 预编译二进制，alpine 无需装编译工具链，镜像小 |
| 后端启动命令 | 容器内直接 `tsx src/index.ts`（不额外编译到 JS） | `server/tsconfig.json` 本来就是 `noEmit: true`；`start` 脚本已经是这个模式，沿用即改动最小 |
| 前端构建方式 | 不进容器，CVM 本机 `npm ci && npm run build` 产出 `dist/` | 静态文件没有运行时依赖，没必要为它单独维护镜像 |
| 反向代理 | Nginx **直接装在 CVM 系统上**（非容器化） | 证书管理更省心：腾讯云证书直接放系统目录、`systemctl reload` 即可；只代理一个后端服务，容器化收益不大 |
| TLS 证书 | 腾讯云签发证书（手动/腾讯云证书管理下载） | 用户已有域名，选择用腾讯云证书而非 Let's Encrypt |
| 部署机制（首版） | 手动 SSH 上去拉代码、构建、`docker compose up -d` | 先跑通，CI/CD 自动化留作后续迭代，避免一次性引入过多变量 |
| CORS / Cookie SameSite | **不改动**（继续 `SameSite=Lax`，无需 CORS 中间件） | 同域部署后请求都是同站请求，跨站问题不存在 |

## 组件与目录

```
server/
  Dockerfile              # 新增：单阶段 node:20-alpine 构建
  .dockerignore            # 新增：排除 node_modules/dist/uploads 等
deploy/
  docker-compose.yml       # 新增：db + server 两个服务，仅供 CVM 上使用
  nginx.conf               # 新增：静态站点 + /api 反代的 server block 模板
  DEPLOY.md                # 新增：从零到上线的完整操作手册
.github/workflows/
  deploy.yml                # 删除：GH Pages 发布不再使用，避免和新方案冲突
```

### `server/Dockerfile`

- Base：`node:20-alpine`
- 只拷贝 monorepo 中 `server` 运行所需的部分：根 `package.json` + `package-lock.json`、`shared/`、`server/`（不拷前端 `src/`，保持镜像内容聚焦）
- `npm ci`（含 devDependencies——`tsx` 是 server 的 devDependency，`start` 脚本运行时需要它，故不加 `--omit=dev`）
- `EXPOSE 3001`
- `CMD ["npm", "-w", "server", "run", "start"]`

### `deploy/docker-compose.yml`

- `db`：`postgres:16-alpine`，`POSTGRES_PASSWORD` 从 `.env` 读取（CVM 上生成的强密码，不再用开发默认的 `postgres`），数据卷持久化，**不映射端口到宿主机**
- `server`：`build: ../server`，`env_file: .env`，依赖 `db`，端口只绑 `127.0.0.1:3001:3001`（宿主机上只有 Nginx 能访问，不直接暴露公网）
- 额外挂一个 volume 到容器内 `server/uploads`，作为 COS 未配置时的兜底（正常应该走 COS，这只是防御性兜底，不常用）

### `deploy/nginx.conf`

单个 `server` 块，同时做两件事：

- `location /` → `root` 指向 CVM 上 checkout 目录的 `dist/`；`try_files $uri /index.html` 做 SPA fallback
- `location /api/` → `proxy_pass http://127.0.0.1:3001`，带 `X-Forwarded-For`/`X-Forwarded-Proto`
- `client_max_body_size 6m`（上传接口限制 5MB，留出余量）
- `listen 443 ssl`，证书路径指向腾讯云下载的 `.crt`/`.key`；`listen 80` 做 `301` 跳转到 `https`

### `deploy/DEPLOY.md`

按顺序覆盖：

1. CVM 上装 Docker（`yum`，标注国内镜像加速，避免重蹈 Docker Hub 直连超时的坑）
2. `git clone` 仓库到 CVM
3. 基于 `.env.example` 在 CVM 上手填 `.env`：真实 `COS_SECRET_ID/COS_SECRET_KEY/COS_BUCKET/COS_REGION`、强随机 `JWT_SECRET`、强随机 Postgres 密码、`DATABASE_URL` 指向 compose 内部的 `db` 服务名
4. `docker compose -f deploy/docker-compose.yml up -d`
5. 一次性初始化：`docker compose exec server npm -w server run migrate`、`docker compose exec server npm -w server run seed`
6. CVM 本机 `npm ci && npm run build` 产出 `dist/`
7. 装系统 Nginx（`yum install nginx`），落地 `deploy/nginx.conf`（替换域名/证书路径占位符），配腾讯云证书，`systemctl enable --now nginx`
8. 冒烟：浏览器访问域名，走一遍注册/登录/下单/上传图片

## 不做的事（本次范围外）

- 不加 CORS 中间件、不改 Cookie `SameSite`——同域部署下没有必要
- 不加 `VITE_API_BASE_URL`——前端继续用相对路径 `/api/...`
- 不容器化 Nginx——后续如需在同机跑多站点再重新评估
- 不做 GitHub Actions 自动化部署（SSH 免密同步/重启容器等）——首版手动跑通，后续可迭代
- 不迁移到腾讯云 TencentDB 托管数据库——同机 Docker Postgres 已选定

## 验收

- `docker compose -f deploy/docker-compose.yml up -d` 后 `db`/`server` 均健康，`curl 127.0.0.1:3001/api/health` 返回 `{ok:true}`
- Nginx 启动后，`https://<域名>/` 能加载前端首页，`https://<域名>/api/health` 能拿到同样的健康检查响应
- 浏览器完整走一遍：注册 → 登录（cookie 正确写入且后续请求带上）→ 下单 → 上传图片（校验落到 COS 而非本地回退）→ 刷新页面后登录态仍保持
- `.github/workflows/deploy.yml` 已删除，仓库里不再有指向 GH Pages 的发布流程
