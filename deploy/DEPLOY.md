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
