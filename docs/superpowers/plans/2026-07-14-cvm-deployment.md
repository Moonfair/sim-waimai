# CVM 生产部署 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 sim-waimai 前端 + 后端 + Postgres 整体部署到腾讯云 CVM（`sim-waimai.moonfair.cn`），前后端同域，HTTPS 可用，并通过真实的端到端冒烟测试。

**Architecture:** 后端 + Postgres 用 Docker Compose 跑在 CVM 上（`server` 只绑 `127.0.0.1:3001`）；前端在 CVM 上用一次性 Docker 容器构建出静态 `dist/`；系统级 Nginx 同时托管静态文件和反代 `/api` 到 `127.0.0.1:3001`，certbot 签发 HTTPS。

**Tech Stack:** Docker CE 26.x + Compose plugin v2、node:20-alpine（容器内构建/运行，宿主机不装 Node）、PostgreSQL 16-alpine、Nginx 1.20（EPEL）、Certbot 1.11（EPEL）。

## Global Constraints（对所有远程任务生效）

以下事实已在真实目标机上逐条验证过，直接照抄执行即可，不要重新猜测：

- **目标机**：SSH 别名 `txy`（`root@106.55.231.31`），CentOS Linux 7 (x86_64)，2 vCPU / 3.6G 内存 / 63G 可用磁盘。
- **域名**：`sim-waimai.moonfair.cn`，A 记录已指向 `106.55.231.31`；腾讯云安全组已放行入站 TCP 80/443（用户已在控制台确认）。
- **仓库**：`https://github.com/Moonfair/sim-waimai.git`（公开仓库，克隆不需要认证）。
- **部署目录**：`/srv/sim-waimai`（**不要用 `/root/sim-waimai`**——`/root` 目录权限是 `750`，Nginx worker 进程以 `nginx` 用户运行，无法穿透 `/root` 读取静态文件，会导致 `stat() ... Permission denied` + 500，这是实测踩到的坑）。
- **SSH 连接不稳定**：约 30% 概率在命令执行中途返回 `Connection closed by 106.55.231.31 port 22`（exit 255），和命令本身是否成功无关，纯粹是连接层抖动。所有 `ssh txy '...'` 调用都要带 `-o ConnectTimeout=20 -o ServerAliveInterval=5 -o ServerAliveCountMax=6`，遇到 exit 255 直接重跑同一条命令（大概率第二次就成功）。
- **GitHub 连接不稳定**：CVM 到 `github.com:443` 经常连接超时/中途断开，`git clone` 必须包一层重试循环（实测需要重试 2-3 次才成功）。
- **Docker Hub 被墙**：`registry-1.docker.io` 从这台机器直连不通，必须给 Docker daemon 配镜像源（已验证 `https://mirror.ccs.tencentyun.com` 可用）。
- **`download.docker.com` 被墙**：装 docker-ce 的 yum repo 源文件本身可以从 `https://mirrors.tencent.com/docker-ce/linux/centos/docker-ce.repo` 拉到，但文件内容里的 `baseurl` 仍写着 `download.docker.com`，需要 `sed` 替换成 `mirrors.tencent.com/docker-ce` 才能真正装上包（已验证到 `docker-ce-26.1.4-1.el7`）。
- **CentOS 7 装不了官方 Node 20**：glibc 2.17 不满足 Node 20 官方包要求的 `GLIBC_2.27`（`yum install nodejs` 直接报依赖错误）。**因此前端构建不装宿主机 Node，改用 `docker run -v $(pwd):/app -w /app node:20-alpine sh -c "npm ci && npm run build"` 在容器里构建**，产物通过 bind mount 落在宿主机 `dist/`。已实测这条路径可行（`npm ci` ~2min，`vite build` ~1s）。
- **Postgres 容器在这台机器上默认起不来**：CentOS 7 的 3.10 内核 + Docker 默认 seccomp profile 组合会让 Postgres 16 的 WAL 预分配（`posix_fallocate`）报 `Operation not permitted` 直接崩溃退出（不是权限或磁盘问题，`--security-opt seccomp=unconfined` 后立刻正常启动，已实测确认）。`deploy/docker-compose.yml` 里 `db` 服务必须带这个 `security_opt`。db 只在 compose 内部网络暴露、宿主机不开端口，这个放宽的影响面很小。
- **种子数据路径**：`server/src/db/seed.ts` 读取的是仓库根目录 `src/data/restaurants/*.json`（前端的数据目录，不在 `server/` 下），`server/Dockerfile` 必须显式 `COPY` 这个子目录，否则 `npm run seed` 会以 `ENOENT: src/data/restaurants` 失败（已实测确认，14 个商家能正确导入）。

---

## 文件结构

```
.dockerignore              # 新增（仓库根目录，不是 server/ 下——build context 是仓库根）
server/
  Dockerfile                # 新增
deploy/
  docker-compose.yml         # 新增
  nginx.conf                 # 新增
  DEPLOY.md                  # 新增：整理好的可复用操作手册
.github/workflows/
  deploy.yml                  # 删除：GH Pages 发布不再使用
```

---

### Task 1: `server/Dockerfile` + `.dockerignore`

**Files:**
- Create: `.dockerignore`（仓库根目录）
- Create: `server/Dockerfile`

**Interfaces:**
- Produces：镜像内 `CMD` 启动 `@hono/node-server` 监听 `PORT`（默认 3001），供 Task 2 的 `deploy/docker-compose.yml` 的 `server` 服务 `build` 使用。

- [ ] **Step 1: 写 `.dockerignore`**

```
node_modules
**/node_modules
dist
**/dist
.git
.env
.env.*
server/uploads
*.log
docs
public
```

- [ ] **Step 2: 写 `server/Dockerfile`**

```dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/

RUN npm ci

COPY shared/ shared/
COPY server/ server/
COPY src/data/restaurants src/data/restaurants

EXPOSE 3001

CMD ["npm", "-w", "server", "run", "start"]
```

- [ ] **Step 3: 本地构建验证（在 Mac 上跑，验证 Dockerfile 本身没写错；真正要跑的是 CVM 上 x86_64 的构建，Task 7 会验证）**

先保证本地能拉到基础镜像（Docker Hub 直连在本机也不通，走 DaoCloud 镜像源重新打 tag）：

```bash
docker pull docker.m.daocloud.io/library/node:20-alpine
docker tag docker.m.daocloud.io/library/node:20-alpine node:20-alpine
```

再构建：

```bash
cd /Users/moonfair/Projects/sim-waimai
docker build -t sim-waimai-server:test -f server/Dockerfile .
```

Expected: 构建成功结束，最后一行是 `naming to docker.io/library/sim-waimai-server:test done`。

- [ ] **Step 4: 本地冒烟——启动容器连本地 dev 数据库，确认 API 能起来**

先确保本地开发数据库在跑（如果还没起）：

```bash
npm run db:up
```

再跑刚构建的镜像（Mac 上 Docker Desktop 用 `host.docker.internal` 访问宿主机端口）：

```bash
docker run --rm -d --name sw-server-smoketest \
  -p 3002:3001 \
  -e DATABASE_URL="postgres://postgres:postgres@host.docker.internal:5432/sim_waimai" \
  -e JWT_SECRET=test-secret-not-for-prod \
  -e NODE_ENV=production \
  sim-waimai-server:test
sleep 2
curl -s http://localhost:3002/api/health
```

Expected: 输出 `{"ok":true}`。

- [ ] **Step 5: 清理本地冒烟容器**

```bash
docker stop sw-server-smoketest
```

- [ ] **Step 6: Commit**

```bash
git add .dockerignore server/Dockerfile
git commit -m "feat: add server Dockerfile for CVM deployment"
```

---

### Task 2: `deploy/docker-compose.yml`

**Files:**
- Create: `deploy/docker-compose.yml`

**Interfaces:**
- Consumes：Task 1 的 `server/Dockerfile`（`build.dockerfile`）。
- Consumes：仓库根目录的 `.env`（`env_file: ../.env`，相对于 `deploy/` 目录解析，与运行 `docker compose` 时的 cwd 无关）。
- Produces：`db` 服务（容器名 `sim-waimai-db`）、`server` 服务（容器名 `sim-waimai-server`，只绑 `127.0.0.1:3001`），供 Task 10 的 Nginx `proxy_pass http://127.0.0.1:3001` 使用。

- [ ] **Step 1: 写 `deploy/docker-compose.yml`**

```yaml
services:
  db:
    image: postgres:16-alpine
    container_name: sim-waimai-db
    restart: unless-stopped
    # CentOS 7 的 3.10 内核在 Docker 默认 seccomp profile 下会让 Postgres 的 WAL 预分配
    # (posix_fallocate) 报 "Operation not permitted" 直接崩溃退出。db 只在 compose 内部
    # 网络暴露给 server，不对宿主机/公网开端口，放宽 seccomp 的影响面很小。
    security_opt:
      - seccomp:unconfined
    env_file: ../.env
    environment:
      POSTGRES_DB: sim_waimai
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 5s
      retries: 10

  server:
    build:
      context: ../
      dockerfile: server/Dockerfile
    container_name: sim-waimai-server
    restart: unless-stopped
    env_file: ../.env
    depends_on:
      db:
        condition: service_healthy
    ports:
      - "127.0.0.1:3001:3001"
    volumes:
      - uploads:/app/server/uploads

volumes:
  pgdata:
  uploads:
```

- [ ] **Step 2: 本地 dry-run 验证 YAML 语法和变量解析**

仓库根目录本来就有本地开发用的 `.env`，直接用它验证即可（不会真的起容器）：

```bash
cd /Users/moonfair/Projects/sim-waimai
docker compose -f deploy/docker-compose.yml config --quiet && echo COMPOSE_CONFIG_VALID
```

Expected: 输出 `COMPOSE_CONFIG_VALID`，无报错。

- [ ] **Step 3: Commit**

```bash
git add deploy/docker-compose.yml
git commit -m "feat: add production docker-compose for CVM (db + server)"
```

---

### Task 3: `deploy/nginx.conf`

**Files:**
- Create: `deploy/nginx.conf`

**Interfaces:**
- Consumes：Task 9 产出的 `/srv/sim-waimai/dist`（`root` 指令）、Task 2 的 `server` 服务（`proxy_pass http://127.0.0.1:3001`）。
- Produces：Task 10 部署到 CVM `/etc/nginx/conf.d/sim-waimai.conf` 的配置模板。

- [ ] **Step 1: 写 `deploy/nginx.conf`**

```nginx
server {
    listen 80;
    server_name sim-waimai.moonfair.cn;

    client_max_body_size 6m;

    root /srv/sim-waimai/dist;
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        try_files $uri /index.html;
    }
}
```

（443/HTTPS 部分不手写——Task 10 跑 `certbot --nginx` 时会自动在这份配置基础上追加 `listen 443 ssl` 块、证书路径，并把这个 80 端口块改写成跳转到 HTTPS。这里保留的是 certbot 改写前的干净版本。）

- [ ] **Step 2: 本地验证 Nginx 配置语法（用容器跑 `nginx -t`，不需要本地装 Nginx）**

```bash
docker pull docker.m.daocloud.io/library/nginx:alpine
docker tag docker.m.daocloud.io/library/nginx:alpine nginx:alpine
docker run --rm -v "$(pwd)/deploy/nginx.conf:/etc/nginx/conf.d/default.conf:ro" nginx:alpine nginx -t
```

Expected: 最后两行是
```
nginx: the configuration file /etc/nginx/nginx.conf syntax is ok
nginx: configuration file /etc/nginx/nginx.conf test is successful
```

- [ ] **Step 3: Commit**

```bash
git add deploy/nginx.conf
git commit -m "feat: add nginx reverse-proxy config for CVM deployment"
```

---

### Task 4: `deploy/DEPLOY.md`

**Files:**
- Create: `deploy/DEPLOY.md`

**Interfaces:**
- 纯文档，汇总 Task 6-11 里已经跑通的确切命令，作为以后重新部署/换机器时的参照。不依赖任何代码接口。

- [ ] **Step 1: 写 `deploy/DEPLOY.md`**

```markdown
# 部署到腾讯云 CVM

目标机：CentOS 7 (x86_64)，SSH 别名 `txy`。域名 `sim-waimai.moonfair.cn` 需已解析到目标机 IP，
且云厂商安全组已放行入站 TCP 80/443（这一步只能在控制台做，SSH 做不到）。

## 1. 装 Docker

```bash
ssh txy 'yum install -y yum-utils'
ssh txy 'curl -sf -o /etc/yum.repos.d/docker-ce.repo https://mirrors.tencent.com/docker-ce/linux/centos/docker-ce.repo'
ssh txy "sed -i 's|download.docker.com|mirrors.tencent.com/docker-ce|g' /etc/yum.repos.d/docker-ce.repo"
ssh txy 'yum install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin git'
ssh txy 'mkdir -p /etc/docker && cat > /etc/docker/daemon.json' <<'EOF'
{
  "registry-mirrors": ["https://mirror.ccs.tencentyun.com"]
}
EOF
ssh txy 'systemctl enable --now docker'
```

（`download.docker.com` 和 Docker Hub 在这台机器上都连不通，上面的镜像源替换是必须的，不是可选优化。）

## 2. 部署应用

```bash
ssh txy 'git clone https://github.com/Moonfair/sim-waimai.git /srv/sim-waimai || true'
# clone 到 github.com 经常超时，失败就重跑上面这条

cd /Users/moonfair/Projects/sim-waimai
set -a; source .env; set +a
JWT_SECRET=$(openssl rand -hex 32)
POSTGRES_PASSWORD=$(openssl rand -hex 20)
ssh txy "cat > /srv/sim-waimai/.env" <<EOF
NODE_ENV=production
PORT=3001
DATABASE_URL=postgres://postgres:${POSTGRES_PASSWORD}@db:5432/sim_waimai
JWT_SECRET=${JWT_SECRET}
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
COS_SECRET_ID=${COS_SECRET_ID}
COS_SECRET_KEY=${COS_SECRET_KEY}
COS_BUCKET=${COS_BUCKET}
COS_REGION=${COS_REGION}
COS_PUBLIC_BASE_URL=${COS_PUBLIC_BASE_URL}
VITE_COS_BASE_URL=${VITE_COS_BASE_URL}
VITE_RUM_ID=${VITE_RUM_ID}
ADMIN_USERNAMES=${ADMIN_USERNAMES}
EOF
ssh txy 'chmod 600 /srv/sim-waimai/.env'   # 默认 umask 会把新建文件设成 644，必须收紧

ssh txy 'cd /srv/sim-waimai && docker compose -f deploy/docker-compose.yml up -d --build'
ssh txy 'curl -s http://127.0.0.1:3001/api/health'   # 期望 {"ok":true}
```

## 3. 初始化数据库

```bash
ssh txy 'cd /srv/sim-waimai && docker compose -f deploy/docker-compose.yml exec -T server npm -w server run migrate'
ssh txy 'cd /srv/sim-waimai && docker compose -f deploy/docker-compose.yml exec -T server npm -w server run seed'
ssh txy 'docker compose -f /srv/sim-waimai/deploy/docker-compose.yml exec -T db psql -U postgres -d sim_waimai -c "select count(*) from restaurants;"'
# 期望 14
```

## 4. 构建前端（CentOS 7 的 glibc 装不了官方 Node 20，改用容器构建）

```bash
ssh txy 'cd /srv/sim-waimai && docker run --rm -v $(pwd):/app -w /app node:20-alpine sh -c "npm ci && npm run build"'
ssh txy 'test -f /srv/sim-waimai/dist/index.html && echo BUILD_OK'
ssh txy 'chmod 755 /srv/sim-waimai && chmod -R a+rX /srv/sim-waimai/dist'
# 只放开顶层目录穿透权限 + dist/ 本身，不要对整个目录递归 chmod（.env 里有真实密钥）
```

## 5. Nginx + HTTPS

```bash
ssh txy 'yum install -y epel-release'
ssh txy 'yum install -y nginx certbot python2-certbot-nginx'
scp deploy/nginx.conf txy:/etc/nginx/conf.d/sim-waimai.conf
ssh txy 'rm -f /etc/nginx/conf.d/default.conf; nginx -t && systemctl enable --now nginx'
ssh txy 'certbot --nginx -d sim-waimai.moonfair.cn --non-interactive --agree-tos --register-unsafely-without-email --redirect'
```

`--register-unsafely-without-email` 跳过邮箱注册（证书到期提醒），续期靠 certbot 自带的 systemd timer 自动完成，不依赖邮件通知。

## 6. 冒烟

```bash
curl -s https://sim-waimai.moonfair.cn/api/health
curl -s https://sim-waimai.moonfair.cn/ | head -5
```

## 故障排查

- `ssh` 报 `Connection closed by ... port 22`：连接层抖动，重跑同一条命令。
- `git clone` 卡住/超时：重跑，GitHub 连接不稳定，通常 2-3 次内会成功。
- certbot 报 `Timeout during connect (likely firewall problem)`：去云厂商控制台检查这台机器绑定的安全组有没有放行入站 TCP 80/443。
- Nginx 返回 500，错误日志里有 `stat() ... Permission denied`：说明部署目录挂在了 `/root` 之类 Nginx worker 用户读不到的地方，必须放在 `/srv` 或其他世界可穿透的路径下。
```

- [ ] **Step 2: Commit**

```bash
git add deploy/DEPLOY.md
git commit -m "docs: add CVM deployment runbook"
```

---

### Task 5: 删除 GitHub Pages 发布 workflow

**Files:**
- Delete: `.github/workflows/deploy.yml`

**Interfaces:** 无——纯删除，不影响其他任务。

- [ ] **Step 1: 删除文件**

```bash
git rm .github/workflows/deploy.yml
```

- [ ] **Step 2: 验证已删除**

```bash
test ! -f .github/workflows/deploy.yml && echo DELETED
ls .github/workflows/ 2>&1 || echo "no workflows dir left"
```

Expected: 输出 `DELETED`。

- [ ] **Step 3: Commit**

```bash
git commit -m "chore: remove GitHub Pages deploy workflow (frontend now on CVM)"
```

---

### Task 6: 在 CVM 上装 Docker + Git（远程操作，无仓库改动）

这个任务只改变远程服务器状态，不产生本地 git 提交——最后一步是验证输出，没有 commit 步骤。

**Files:** 无本地文件改动。

**Interfaces:**
- Produces：CVM 上可用的 `docker`、`docker compose`、`git` 命令，供 Task 7 使用。

- [ ] **Step 1: 添加并修正 docker-ce yum 源**

```bash
ssh -o ConnectTimeout=20 -o ServerAliveInterval=5 -o ServerAliveCountMax=6 txy 'yum install -y yum-utils'
ssh -o ConnectTimeout=20 -o ServerAliveInterval=5 -o ServerAliveCountMax=6 txy 'curl -sf -o /etc/yum.repos.d/docker-ce.repo https://mirrors.tencent.com/docker-ce/linux/centos/docker-ce.repo'
ssh -o ConnectTimeout=20 -o ServerAliveInterval=5 -o ServerAliveCountMax=6 txy "sed -i 's|download.docker.com|mirrors.tencent.com/docker-ce|g' /etc/yum.repos.d/docker-ce.repo"
```

若某条因连接抖动返回 exit 255，直接重跑同一条。

- [ ] **Step 2: 安装 Docker CE、Compose 插件、Git**

```bash
ssh -o ConnectTimeout=30 -o ServerAliveInterval=5 -o ServerAliveCountMax=8 txy 'yum install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin git'
```

Expected: 结尾是 `Complete!`。

- [ ] **Step 3: 配置 Docker 镜像加速（Docker Hub 直连不通）**

```bash
ssh -o ConnectTimeout=20 -o ServerAliveInterval=5 -o ServerAliveCountMax=6 txy 'mkdir -p /etc/docker && cat > /etc/docker/daemon.json' <<'EOF'
{
  "registry-mirrors": ["https://mirror.ccs.tencentyun.com"]
}
EOF
```

- [ ] **Step 4: 启动 Docker 并验证**

```bash
ssh -o ConnectTimeout=20 -o ServerAliveInterval=5 -o ServerAliveCountMax=6 txy 'systemctl enable --now docker'
ssh -o ConnectTimeout=20 -o ServerAliveInterval=5 -o ServerAliveCountMax=6 txy 'docker version --format "{{.Server.Version}}" && docker compose version && git --version'
```

Expected: 三行输出，分别是类似 `26.1.4`、`Docker Compose version v2.27.1`、`git version 1.8.3.1`，都不报错。

---

### Task 7: 克隆仓库 + 生成生产环境 `.env` + 启动 compose stack

**Files:** 无本地文件改动（在 CVM 上创建 `/srv/sim-waimai/.env`，内容含真实密钥，不落回本仓库）。

**Interfaces:**
- Consumes：Task 1 的 `server/Dockerfile`、Task 2 的 `deploy/docker-compose.yml`（此时已在 Task 1/2 commit 到远端仓库，`git clone` 时一并拉下来）。
- Consumes：本地仓库根目录的 `.env`（读取 `COS_SECRET_ID`/`COS_SECRET_KEY`/`COS_BUCKET`/`COS_REGION`/`COS_PUBLIC_BASE_URL`/`VITE_COS_BASE_URL`/`VITE_RUM_ID`/`ADMIN_USERNAMES`）。
- Produces：CVM 上 `/srv/sim-waimai/.env`、运行中的 `sim-waimai-db` + `sim-waimai-server` 容器，供 Task 8/9/10 使用。

**先决条件**：Task 1、2 已经 commit 并 push 到 `origin/main`（`git clone` 拉的是远端仓库，不是本地未推送的改动）。执行本任务前确认：

```bash
git push origin main
```

- [ ] **Step 1: 克隆仓库到 `/srv/sim-waimai`（带重试）**

```bash
for i in 1 2 3 4 5; do
  ssh -o ConnectTimeout=20 -o ServerAliveInterval=5 -o ServerAliveCountMax=6 txy \
    'rm -rf /srv/sim-waimai && git clone https://github.com/Moonfair/sim-waimai.git /srv/sim-waimai' \
    && break
  echo "retry $i"
  sleep 3
done
ssh -o ConnectTimeout=20 -o ServerAliveInterval=5 -o ServerAliveCountMax=6 txy 'ls /srv/sim-waimai/deploy'
```

Expected: 最后一条输出包含 `docker-compose.yml`、`nginx.conf`、`DEPLOY.md`。

- [ ] **Step 2: 生成生产 `.env` 并写到 CVM（本地起草，SSH 传输，绝不落进任何 git 仓库）**

```bash
cd /Users/moonfair/Projects/sim-waimai
set -a
source .env
set +a
JWT_SECRET=$(openssl rand -hex 32)
POSTGRES_PASSWORD=$(openssl rand -hex 20)
ssh -o ConnectTimeout=20 -o ServerAliveInterval=5 -o ServerAliveCountMax=6 txy "cat > /srv/sim-waimai/.env" <<EOF
NODE_ENV=production
PORT=3001
DATABASE_URL=postgres://postgres:${POSTGRES_PASSWORD}@db:5432/sim_waimai
JWT_SECRET=${JWT_SECRET}
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
COS_SECRET_ID=${COS_SECRET_ID}
COS_SECRET_KEY=${COS_SECRET_KEY}
COS_BUCKET=${COS_BUCKET}
COS_REGION=${COS_REGION}
COS_PUBLIC_BASE_URL=${COS_PUBLIC_BASE_URL}
VITE_COS_BASE_URL=${VITE_COS_BASE_URL}
VITE_RUM_ID=${VITE_RUM_ID}
ADMIN_USERNAMES=${ADMIN_USERNAMES}
EOF
ssh -o ConnectTimeout=20 -o ServerAliveInterval=5 -o ServerAliveCountMax=6 txy 'chmod 600 /srv/sim-waimai/.env'
```

`chmod 600` 是必须的一步，不是可选加固：`cat > file` 在默认 umask 下新建文件是 `644`（其他用户可读），而 `.env` 里有 `JWT_SECRET`/`COS_SECRET_KEY` 等真实密钥，必须收紧成只有 root 能读。

- [ ] **Step 3: 验证 `.env` 已写入且权限正确（不打印内容，只数行数）**

```bash
ssh -o ConnectTimeout=20 -o ServerAliveInterval=5 -o ServerAliveCountMax=6 txy 'test -f /srv/sim-waimai/.env && grep -c "=" /srv/sim-waimai/.env && stat -c "%a" /srv/sim-waimai/.env'
```

Expected: 两行输出，`13`（字段数）和 `600`（权限）。

- [ ] **Step 4: 构建并启动 compose stack**

```bash
ssh -o ConnectTimeout=60 -o ServerAliveInterval=5 -o ServerAliveCountMax=15 txy 'cd /srv/sim-waimai && docker compose -f deploy/docker-compose.yml up -d --build'
```

Expected: 看到 `Container sim-waimai-db  Healthy`、`Container sim-waimai-server  Started`。构建含 `npm ci`，第一次跑大概 1-2 分钟，若 SSH 中途断开直接重跑同一条命令（`docker compose up -d --build` 是幂等的）。

- [ ] **Step 5: 验证健康检查**

```bash
ssh -o ConnectTimeout=20 -o ServerAliveInterval=5 -o ServerAliveCountMax=6 txy 'sleep 2 && curl -s http://127.0.0.1:3001/api/health'
ssh -o ConnectTimeout=20 -o ServerAliveInterval=5 -o ServerAliveCountMax=6 txy 'docker compose -f /srv/sim-waimai/deploy/docker-compose.yml ps'
```

Expected: `{"ok":true}`；`ps` 里两个服务都是 `Up`/`healthy`。

---

### Task 8: 数据库迁移 + 种子数据

**Files:** 无本地文件改动。

**Interfaces:**
- Consumes：Task 7 启动的 `sim-waimai-server`/`sim-waimai-db` 容器。
- Produces：数据库里的 14 家餐厅 + 菜品数据，供 Task 11 端到端验证使用。

- [ ] **Step 1: 跑迁移**

```bash
ssh -o ConnectTimeout=30 -o ServerAliveInterval=5 -o ServerAliveCountMax=10 txy 'cd /srv/sim-waimai && docker compose -f deploy/docker-compose.yml exec -T server npm -w server run migrate'
```

Expected: 输出包含 `migrations applied successfully!`。

- [ ] **Step 2: 跑种子数据**

```bash
ssh -o ConnectTimeout=30 -o ServerAliveInterval=5 -o ServerAliveCountMax=10 txy 'cd /srv/sim-waimai && docker compose -f deploy/docker-compose.yml exec -T server npm -w server run seed'
```

Expected: 输出 `Seeded 14 restaurants, 429 menu items.`

- [ ] **Step 3: 验证数据库里的餐厅数量**

```bash
ssh -o ConnectTimeout=20 -o ServerAliveInterval=5 -o ServerAliveCountMax=6 txy 'docker compose -f /srv/sim-waimai/deploy/docker-compose.yml exec -T db psql -U postgres -d sim_waimai -c "select count(*) from restaurants;"'
```

Expected: 结果行是 `14`。

---

### Task 9: 构建前端

**Files:** 无本地文件改动（CVM 上产出 `/srv/sim-waimai/dist/`）。

**Interfaces:**
- Produces：`/srv/sim-waimai/dist/index.html` 等静态资源，供 Task 10 的 Nginx `root` 使用。

- [ ] **Step 1: 容器内构建（CentOS 7 装不了官方 Node 20，不装宿主机 Node）**

```bash
ssh -o ConnectTimeout=60 -o ServerAliveInterval=5 -o ServerAliveCountMax=15 txy 'cd /srv/sim-waimai && docker run --rm -v $(pwd):/app -w /app node:20-alpine sh -c "npm ci && npm run build"'
```

Expected: 输出结尾包含 `✓ built in` 字样。第一次跑 `npm ci` 大约 2 分钟。

- [ ] **Step 2: 验证产物 + 权限（必须世界可读，Nginx worker 是非 root 用户）**

```bash
ssh -o ConnectTimeout=20 -o ServerAliveInterval=5 -o ServerAliveCountMax=6 txy 'test -f /srv/sim-waimai/dist/index.html && echo BUILD_OK'
ssh -o ConnectTimeout=20 -o ServerAliveInterval=5 -o ServerAliveCountMax=6 txy 'chmod 755 /srv/sim-waimai && chmod -R a+rX /srv/sim-waimai/dist && namei -l /srv/sim-waimai/dist/index.html'
```

只放开 `/srv/sim-waimai`（顶层目录本身的穿透权限）和 `dist/`（静态产物）——**不要**对整个 `/srv/sim-waimai` 递归 `chmod`，那样会把 `.env` 里的真实密钥也变成其他用户可读，和 Task 7 Step 2 里特意收紧的 `chmod 600 .env` 矛盾。

Expected: 第一条输出 `BUILD_OK`；第二条 `namei -l` 输出里每一级目录的权限都带 `r-x`/`r--`（不是 `---`），确认 Nginx worker 能穿透读取。

---

### Task 10: Nginx + HTTPS

**Files:** 无本地文件改动（`deploy/nginx.conf` 的内容通过 `scp` 部署到 CVM）。

**Interfaces:**
- Consumes：Task 3 的 `deploy/nginx.conf`、Task 9 的 `/srv/sim-waimai/dist`、Task 7 的 `127.0.0.1:3001`。
- Produces：`https://sim-waimai.moonfair.cn` 可访问，供 Task 11 冒烟测试使用。

- [ ] **Step 1: 装 Nginx + Certbot**

```bash
ssh -o ConnectTimeout=20 -o ServerAliveInterval=5 -o ServerAliveCountMax=6 txy 'yum install -y epel-release'
ssh -o ConnectTimeout=30 -o ServerAliveInterval=5 -o ServerAliveCountMax=10 txy 'yum install -y nginx certbot python2-certbot-nginx'
```

- [ ] **Step 2: 部署 Nginx 配置**

```bash
scp -o ConnectTimeout=20 /Users/moonfair/Projects/sim-waimai/deploy/nginx.conf txy:/etc/nginx/conf.d/sim-waimai.conf
ssh -o ConnectTimeout=20 -o ServerAliveInterval=5 -o ServerAliveCountMax=6 txy 'rm -f /etc/nginx/conf.d/default.conf && nginx -t'
```

Expected: `nginx -t` 输出 `syntax is ok` / `test is successful`。

- [ ] **Step 3: 启动 Nginx**

```bash
ssh -o ConnectTimeout=20 -o ServerAliveInterval=5 -o ServerAliveCountMax=6 txy 'systemctl enable --now nginx && systemctl is-active nginx'
```

Expected: 输出 `active`。

- [ ] **Step 4: 申请/复用 HTTPS 证书**

```bash
ssh -o ConnectTimeout=30 -o ServerAliveInterval=5 -o ServerAliveCountMax=10 txy \
  'certbot --nginx -d sim-waimai.moonfair.cn --non-interactive --agree-tos --register-unsafely-without-email --redirect'
```

Expected: 输出包含 `Congratulations! You have successfully enabled https://sim-waimai.moonfair.cn`（如果这个域名之前已经签过有效证书，certbot 会检测到未过期直接复用/跳过重新签发，同样视为成功）。

若报 `Timeout during connect (likely firewall problem)`：说明云厂商安全组入站 80/443 没放行，需要去控制台加规则，SSH 无法解决，需要暂停并让用户处理。

- [ ] **Step 5: 验证 HTTPS**

```bash
ssh -o ConnectTimeout=20 -o ServerAliveInterval=5 -o ServerAliveCountMax=6 txy 'curl -s https://sim-waimai.moonfair.cn/api/health'
ssh -o ConnectTimeout=20 -o ServerAliveInterval=5 -o ServerAliveCountMax=6 txy 'curl -s -o /dev/null -w "%{http_code}\n" http://sim-waimai.moonfair.cn/'
```

Expected: 第一条 `{"ok":true}`；第二条是 `301`（HTTP 已被 certbot 改写为跳转到 HTTPS）。

---

### Task 11: 端到端冒烟测试

**Files:** 无文件改动，纯验证。

**Interfaces:**
- Consumes：Task 7-10 部署完成的完整生产站点 `https://sim-waimai.moonfair.cn`。

- [ ] **Step 1: 健康检查 + 首页**

```bash
curl -s https://sim-waimai.moonfair.cn/api/health
curl -s https://sim-waimai.moonfair.cn/ | grep -o '<title>[^<]*</title>'
```

Expected: `{"ok":true}`；能看到 `<title>` 标签内容（确认前端 `dist/index.html` 被正确served）。

- [ ] **Step 2: 注册 + 登录态验证（走真实同域 cookie 流程）**

```bash
STAMP=$(date +%s)
curl -s -c /tmp/sw-cookie.txt -X POST https://sim-waimai.moonfair.cn/api/auth/register \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"e2e_test_${STAMP}\",\"password\":\"Test1234!\"}"
echo
curl -s -b /tmp/sw-cookie.txt https://sim-waimai.moonfair.cn/api/auth/me
```

Expected: 第一条返回创建的用户对象（含 `id`/`username`）；第二条（带 cookie 复用）返回同一个用户，证明同源 Cookie（`SameSite=Lax`）在真实域名下正常工作，不需要任何 CORS 配置。

- [ ] **Step 3: 验证种子餐厅数据可通过公网 API 访问**

```bash
curl -s https://sim-waimai.moonfair.cn/api/restaurants | grep -o '"id"' | wc -l
```

Expected: `14`。

- [ ] **Step 4: 下单（服务端计价，验证订单落库）**

```bash
RID=$(curl -s https://sim-waimai.moonfair.cn/api/restaurants | node -e "
let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d)[0].id))")
DETAIL=$(curl -s "https://sim-waimai.moonfair.cn/api/restaurants/${RID}")
MID=$(echo "$DETAIL" | node -e "
let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).menu[0].id))")

curl -s -b /tmp/sw-cookie.txt -X POST https://sim-waimai.moonfair.cn/api/orders \
  -H 'Content-Type: application/json' \
  -d "{\"restaurantId\":\"${RID}\",\"items\":[{\"menuItemId\":\"${MID}\",\"quantity\":1}],\"address\":{\"address\":\"测试地址1号\"}}"
```

Expected: 返回创建的订单对象，含 `id`、`status: "pending"`、服务端计算出的 `total`（非 0）。证明服务端重新计价、写库、以及跨请求 Cookie 会话在真实域名下都工作正常。

- [ ] **Step 5: 上传图片，验证落到 COS 而不是本地回退**

```bash
# 1x1 像素的最小合法 PNG，仅用于测试
echo 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=' \
  | base64 -d > /tmp/sw-test.png

GRANT=$(curl -s -b /tmp/sw-cookie.txt -X POST https://sim-waimai.moonfair.cn/api/uploads/presign \
  -H 'Content-Type: application/json' \
  -d '{"kind":"review","contentType":"image/png"}')
echo "$GRANT"

UPLOAD_URL=$(echo "$GRANT" | node -e "
let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).uploadUrl))")
PUBLIC_URL=$(echo "$GRANT" | node -e "
let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).publicUrl))")

curl -s -o /dev/null -w "PUT status: %{http_code}\n" -b /tmp/sw-cookie.txt -X PUT \
  "https://sim-waimai.moonfair.cn${UPLOAD_URL}" \
  -H 'Content-Type: image/png' --data-binary @/tmp/sw-test.png

echo "publicUrl: $PUBLIC_URL"
curl -s -o /dev/null -w "GET status: %{http_code}\n" "$PUBLIC_URL"
```

Expected：`PUT status: 200`；`publicUrl` 是一个 `https://<bucket>.cos.<region>.myqcloud.com/...` 的绝对地址（**不是** `/api/uploads/local/...`——如果是后者说明 `.env` 里的 `COS_*` 没有正确传到 CVM，需要回去检查 Task 7 Step 2）；最后一条 `GET status: 200`，证明图片真的落到了 COS 上且可公开访问。

- [ ] **Step 6: 清理测试文件**

```bash
rm -f /tmp/sw-cookie.txt /tmp/sw-test.png
```

Expected: 至此，`https://sim-waimai.moonfair.cn` 已是可正常使用的生产站点：静态前端 + API + 数据库 + 种子数据 + 下单 + COS 图片上传 + HTTPS 全部就绪，和设计文档里的验收标准逐条对上。
