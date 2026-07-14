# sim-waimai 生产安全加固设计

日期：2026-07-14 · 分支：`main`

## 背景与目标

`https://sim-waimai.moonfair.cn` 已经部署上线（见 `docs/superpowers/specs/2026-07-14-cvm-deployment-design.md`），用户打算把链接公开分享出去。部署完成后做的一轮安全复查，在真实机器上验证出几个具体缺口（不是泛泛而谈），本设计把这些缺口和后续加固项整理成可执行的方案。

目标机现状（已通过 SSH 验证）：`PasswordAuthentication no`（已关闭密码登录，好事）；`fail2ban` 未安装；`firewalld` 处于 `inactive`（纯靠腾讯云安全组做边界）；`certbot-renew.timer` 处于 `disabled`（证书 10 月 12 日到期后会静默失效）；数据库无任何备份机制；`server` 容器无 healthcheck；登录/注册接口无针对性防护。

## 优先级与范围

| 优先级 | 项目 | 判断依据 |
|---|---|---|
| 🔴 必须 | 证书自动续期 | 已验证 timer 处于 disabled，是真实存在的缺口，不是假设 |
| 🔴 必须 | 数据库每日备份 | 当前完全没有备份，CVM 故障/误操作会丢光业务数据 |
| 🔴 必须 | fail2ban | 公开分享后 22 端口会持续被扫描/爆破，只有密钥登录这一层不够 |
| 🟡 应该 | firewalld 主机防火墙 | 目前只有云安全组一层边界，缺纵深防御 |
| 🟡 应该 | 登录接口限流 | 全局限流对撞库/爆破密码来说太宽松 |
| 🟡 应该 | 注册验证码 | 公开后大概率被脚本批量注册垃圾账号 |
| 🟡 应该 | Docker 日志大小限制 | 默认 json-file 驱动无限制，长期跑有把磁盘写满的风险 |
| 🟢 可以 | 管理后台 IP 白名单 | 提高门槛，用户已知晓动态 IP 场景需要手动维护 |
| 🟢 可以 | CDN/WAF（EdgeOne） | 主要防刷流量/隐藏源站，非必须但用户希望这次一并规划 |
| 🟢 可以 | 可用性监控（UptimeRobot） | 现在服务挂了没人知道 |
| 🟢 可以 | `server` 容器 healthcheck | 服务假死时 Docker 不会自动重启，非阻塞性问题 |

**明确排除**：CentOS 7 已 EOL（2024 年年中起无官方安全更新），但操作系统迁移工作量大、风险高，不在本次范围内，只记录为已知风险（见"不做的事"）。

## 技术方案

### 数据库备份

- Host 上 cron（`/etc/cron.d/sim-waimai-backup`）每日跑 `deploy/backup-db.sh`：
  1. `docker compose -f /srv/sim-waimai/deploy/docker-compose.yml exec -T db pg_dump -U postgres sim_waimai | gzip > /srv/sim-waimai/backups/sim_waimai_$(date +%F).sql.gz`
  2. 用一次性容器跑 `deploy/backup-upload.mjs`：bind-mount 整个 `/srv/sim-waimai`（复用其中已经 `npm ci` 装好的 `cos-nodejs-sdk-v5`，不用额外装 `coscmd`/`coscli` 这类外部工具）把当天的备份文件上传到现有 COS bucket 的 `backups/` 前缀下
  3. 清理本地和 COS 上超过 7 天的备份文件
- 不引入新的运行时依赖，`cos-nodejs-sdk-v5` 已经是 root workspace 的 devDependency

### fail2ban

- `yum install -y fail2ban`（EPEL 已在用，直接可装）
- 标准 sshd jail：5 次失败 / 10 分钟窗口 / 封禁 1 小时，用官方默认配置，不做定制化调参

### firewalld

- 启用并只放行 `ssh`/`http`/`https` 三个 service，和腾讯云安全组规则保持一致
- **必须遵守的安全顺序**（避免把自己锁在外面）：先 `firewall-cmd --permanent --add-service=ssh` 再 `--reload`，然后用**另一个新的 SSH 会话**验证能连上，最后才能认为这一步完成；当前操作用的 SSH 会话中途不能断

### 登录接口限流

- 复用现有 `server/src/middleware/rateLimit.ts` 中间件，给 `POST /api/auth/login` 单独套一层更严格的限流：10 次 / 15 分钟 / IP（现有全局限流是 300 次/分钟，对撞密码来说太宽松）

### 注册验证码

- 无状态设计，不引入 session/Redis：
  - 新增 `GET /api/auth/captcha`：随机生成一道算术题（如 `3 + 5`），返回 `{token, question}`；`token` 是用 `JWT_SECRET` 签名的 `{answer, exp}`（复用现有 JWT 签名机制，短过期时间，如 5 分钟）
  - `POST /api/auth/register` 请求体新增 `captchaToken`/`captchaAnswer` 两个必填字段，校验 token 签名 + 未过期 + 答案匹配，任一失败返回 400
  - 前端 `Register.tsx` 加验证码展示区（题目 + 输入框），提交时带上 `captchaToken`

### Docker 日志限制

- `deploy/docker-compose.yml` 的 `db`/`server` 两个服务都加：
  ```yaml
  logging:
    driver: json-file
    options:
      max-size: "10m"
      max-file: "3"
  ```

### 管理后台 IP 白名单

- `deploy/nginx.conf` 给 `/api/admin/` 单独加一个 `location` block：`allow <用户公网 IP>; deny all;` 再 `proxy_pass` 到 `127.0.0.1:3001`
- 用户是动态 IP 场景，计划里要包含"如何查当前公网 IP（`curl ifconfig.me`）、如何更新这条规则"的操作步骤，不是一次性写死就完事

### CDN/WAF（EdgeOne）+ 可用性监控

- 这两项本质是控制台手动操作，SSH 自动化不了，计划里写成**操作清单**（accept 域名接入、源站配置、开 WAF 规则 / 注册监控账号、添加 `https://sim-waimai.moonfair.cn/api/health` 监控项），明确标注哪几步需要用户在浏览器里自己做
- 唯一能自动化的部分：接入 CDN 后，Nginx 需要正确识别真实客户端 IP（否则限流/日志会把所有请求都记成 CDN 节点 IP），这部分作为一个可执行任务，加 `set_real_ip_from`（EdgeOne 回源 IP 段）+ `real_ip_header X-Forwarded-For`

### `server` 容器 healthcheck

- `node:20-alpine` 没有 `curl`/`wget`，用 Node 20 自带的 `fetch` 写健康检查命令：
  ```yaml
  healthcheck:
    test: ["CMD", "node", "-e", "fetch('http://localhost:3001/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
    interval: 10s
    timeout: 5s
    retries: 3
  ```

## 不做的事（本次范围外）

- **不迁移 CentOS 7**：系统换代工作量大、风险高，值得单独立项。只在 `deploy/KNOWN-RISKS.md`（新建）里记录这个已知风险，不采取行动
- **不引入外部验证码服务**（Google reCAPTCHA / 腾讯云验证码）：国内网络加载 reCAPTCHA 常失败；腾讯云验证码需要额外控制台配置和网络请求依赖，用户选择了自实现方案
- **不做管理后台 TOTP 二次验证**：用户选择了更轻量的 Nginx IP 白名单方案
- **不做 Redis/会话存储**：验证码用签名 token 保持无状态，不为这一个小功能引入新的基础设施

## 验收

- `systemctl list-timers | grep certbot` 显示 timer 已启用且有下次触发时间
- 手动跑一次 `deploy/backup-db.sh`，确认本地和 COS 上都出现当天的 `.sql.gz` 文件；确认 7 天前的旧备份被正确清理（可用改短测试窗口的方式验证清理逻辑，不用真等 7 天）
- `systemctl status fail2ban` 为 active，`fail2ban-client status sshd` 能看到 jail 生效
- `firewall-cmd --list-services` 只有 ssh/http/https；改动过程中 SSH 会话未断线
- 用错误密码连续请求 `/api/auth/login` 超过 10 次后收到 429
- 不带验证码或验证码错误调用 `/api/auth/register` 返回 400；正确验证码能正常注册
- `docker inspect` 确认 `db`/`server` 容器的 `LogConfig` 里 `max-size`/`max-file` 生效
- 从白名单外的 IP 访问 `/api/admin/*` 返回 403（或连接被拒绝），白名单内 IP 正常
- `deploy/KNOWN-RISKS.md` 存在且包含 CentOS 7 EOL 的记录
- CDN/监控两项：以"操作清单是否完整、可被没有上下文的人照做"为验收标准，而不是要求真的在这次执行时注册好账号（那是用户自己后续要做的）
