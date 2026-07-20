#!/usr/bin/env bash
# 一键部署到 txy（腾讯云 CVM）。流程与 DEPLOY.md 保持一致：
# 推到 GitHub main → 服务器从 codeload 拉 tarball 覆盖解压（不 rm -rf，保住 .env）
# → 容器内重建前端 dist → 冒烟验证（源站 + EdgeOne CDN）。
#
# 用法：
#   deploy/deploy.sh             # 只发前端（默认，最常见）
#   deploy/deploy.sh --server    # 前端 + 重建并重启 API 容器 + 跑数据库迁移（server/ 有改动时用）
#
# --server 总是顺带跑一次 db:migrate：Drizzle 迁移是幂等的（没有待跑的迁移就是
# no-op），比"记得手动加 --migrate"更可靠——2026-07-20 审核列表 500 就是因为有人
# --server 重启了带 hidden_at 查询的新代码，但忘了单独跑 --migrate，线上库没建那列。
set -euo pipefail

HOST=txy
APP_DIR=/srv/sim-waimai
DOMAIN=sim-waimai.moonfair.cn
TARBALL_URL=https://codeload.github.com/Moonfair/sim-waimai/tar.gz/refs/heads/main

WITH_SERVER=0
for arg in "$@"; do
  case "$arg" in
    --server) WITH_SERVER=1 ;;
    --migrate) WITH_SERVER=1 ;; # 向后兼容旧用法；现在 --server 已隐含跑迁移
    *) echo "未知参数: $arg（支持 --server）" >&2; exit 2 ;;
  esac
done

step() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
die() { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# ssh 到这台机器偶发 "Connection closed"（见 DEPLOY.md 故障排查），重试最多 3 次。
# 所有远端步骤都是幂等的，重试安全。
remote() {
  local i rc
  for i in 1 2 3; do
    ssh -o ConnectTimeout=15 "$HOST" "$@" && return 0
    rc=$?
    # 命令本身失败（非 255 连接错误）不重试
    if [ "$rc" -ne 255 ]; then return "$rc"; fi
    echo "  ssh 连接抖动（第 ${i} 次），重试…" >&2
    sleep 2
  done
  return 255
}

cd "$(git rev-parse --show-toplevel)"

step "预检：本地 main 已推送到 GitHub"
[ "$(git rev-parse --abbrev-ref HEAD)" = "main" ] || die "当前不在 main 分支（部署源是 GitHub main）"
git fetch -q origin main
LOCAL_SHA=$(git rev-parse HEAD)
REMOTE_SHA=$(git rev-parse origin/main)
[ "$LOCAL_SHA" = "$REMOTE_SHA" ] || die "本地 HEAD ($LOCAL_SHA) ≠ origin/main ($REMOTE_SHA)，先 git push"
if ! git diff --quiet HEAD; then
  echo "  ⚠ 工作区有未提交改动，它们不会被部署（部署源是 GitHub main）"
fi

step "预检：本地生产构建能通过（挡住类型错误，别把坏版本推上去）"
npm run build >/dev/null || die "本地 npm run build 失败"

step "备份服务器 .env（tarball 覆盖解压不会碰它，但留个后手）"
remote "install -m 600 $APP_DIR/.env /root/sim-waimai.env.bak && install -m 600 $APP_DIR/deploy/.env.db /root/sim-waimai.env.db.bak"

# 若 server/ 相对上次部署有改动而没带 --server，给出提醒
PREV_SHA=$(remote "cat $APP_DIR/.deployed-version 2>/dev/null" || true)
if [ "$WITH_SERVER" -eq 0 ] && [ -n "$PREV_SHA" ] && git cat-file -e "$PREV_SHA" 2>/dev/null; then
  if git diff --name-only "$PREV_SHA" HEAD | grep -q '^server/src/\|^server/package\|^server/Dockerfile\|^shared/'; then
    echo "  ⚠ 相对上次部署（${PREV_SHA:0:7}）server/ 或 shared/ 有改动，本次不会重启 API。"
    echo "    需要的话用 deploy/deploy.sh --server 重新跑。"
  fi
fi

step "服务器拉取最新 main tarball 并覆盖解压（保留 .env / dist / node_modules）"
# codeload 偶发超时，重试 3 次
DOWNLOADED=0
for i in 1 2 3; do
  if remote "curl -sSL -m 120 $TARBALL_URL -o /tmp/repo.tar.gz"; then DOWNLOADED=1; break; fi
  echo "  下载失败（第 ${i} 次），重试…" >&2
  sleep 3
done
[ "$DOWNLOADED" -eq 1 ] || die "codeload tarball 下载失败（github 连不通？稍后重试）"
remote "tar -xzf /tmp/repo.tar.gz -C $APP_DIR --strip-components=1 && rm -f /tmp/repo.tar.gz && test -f $APP_DIR/.env"
remote "echo $LOCAL_SHA > $APP_DIR/.deployed-version"

if [ "$WITH_SERVER" -eq 1 ]; then
  step "重建并重启 API 容器"
  remote "cd $APP_DIR && docker compose -f deploy/docker-compose.yml up -d --build server"
  for i in $(seq 1 15); do
    remote "curl -sf -m 5 http://127.0.0.1:3001/api/health >/dev/null" && break
    if [ "$i" -eq 15 ]; then die "API 重启后 /api/health 一直不通，去服务器看 docker compose logs server"; fi
    sleep 2
  done

  step "运行数据库迁移（幂等，没有待跑迁移时是 no-op）"
  remote "cd $APP_DIR && docker compose -f deploy/docker-compose.yml exec -T server npm -w server run migrate"
fi

step "容器内重建前端 dist"
remote "cd $APP_DIR && docker run --rm -v \$(pwd):/app -w /app node:20-alpine sh -c 'npm ci && npm run build' >/dev/null && test -f dist/index.html"
remote "chmod 755 $APP_DIR && chmod -R a+rX $APP_DIR/dist"

step "冒烟验证"
remote "curl -sf -m 5 http://127.0.0.1:3001/api/health >/dev/null" || die "源站 API /api/health 不通"
ORIGIN_JS=$(remote "curl -sk https://127.0.0.1/ -H 'Host: $DOMAIN' | grep -o 'index-[A-Za-z0-9_-]*\.js' | head -1")
DIST_JS=$(remote "ls $APP_DIR/dist/assets/ | grep -o '^index-[A-Za-z0-9_-]*\.js' | head -1")
[ -n "$ORIGIN_JS" ] && [ "$ORIGIN_JS" = "$DIST_JS" ] || die "源站 index.html 引用 ($ORIGIN_JS) 与 dist 产物 ($DIST_JS) 不一致"
CDN_JS=$(curl -s -m 20 "https://$DOMAIN/" | grep -o 'index-[A-Za-z0-9_-]*\.js' | head -1 || true)
if [ "$CDN_JS" != "$DIST_JS" ]; then
  echo "  ⚠ CDN 返回的还是旧版（$CDN_JS ≠ $DIST_JS）——EdgeOne 缓存了 index.html，"
  echo "    去 EdgeOne 控制台刷新缓存后再验证。源站本身已是新版。"
else
  curl -sf -o /dev/null -m 20 "https://$DOMAIN/assets/$DIST_JS" || die "CDN 上新 JS 资产拉不到"
  curl -sf -m 20 "https://$DOMAIN/api/health" >/dev/null || die "经 CDN 的 /api/health 不通"
  echo "  ✓ CDN 与源站一致，新版已生效：$DIST_JS"
fi

printf '\n\033[1;32m✓ 部署完成\033[0m  版本 %s\n' "${LOCAL_SHA:0:7}"
