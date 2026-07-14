# CDN（EdgeOne）与可用性监控——操作清单

这两项本质是控制台手动操作，无法通过 SSH/脚本自动化。下面按顺序列出需要在浏览器里完成的步骤；
标注"可自动化"的那一小步除外。验收标准是"没有上下文的人能照着做完"，不是要求这次执行时真的注册好
账号——账号/域名接入是用户自己后续在浏览器里完成的操作。

## EdgeOne CDN + WAF

1. 【手动，控制台】登录腾讯云 EdgeOne 控制台，接入域名 `sim-waimai.moonfair.cn`。
2. 【手动，控制台】按控制台向导把域名 DNS 切到 EdgeOne 提供的 CNAME（或改用 EdgeOne 的 NS 接入方式，
   以控制台实际提供的选项为准）。
3. 【手动，控制台】源站配置指回 CVM 的真实 IP（`106.55.231.31`），源站端口 443（保持 HTTPS 回源，
   证书由 CVM 上的 certbot 证书提供）。
4. 【手动，控制台】开启 WAF 基础防护规则（EdgeOne 自带的 Web 应用防火墙模块，按控制台默认推荐规则
   开启即可，不需要自定义规则）。

   **已完成（2026-07-15）**：以上 1-4 步用户已在控制台完成，域名已 CNAME 到
   `sim-waimai.moonfair.cn.eo.dnse1.com`（EdgeOne 边缘节点），并配置了 EdgeOne 自己签发/托管的边缘
   HTTPS 证书。

5. 【已自动化，已执行】接入 CDN 后，源站看到的所有请求都来自 EdgeOne 的回源节点 IP，而不是访客的
   真实 IP，Nginx 必须显式信任这些节点、从 `X-Forwarded-For` 里取真实客户端 IP，否则限流
   （`server/src/middleware/rateLimit.ts`）和访问日志会把所有请求都记成同一批 EdgeOne 节点 IP。

   实测确认 EdgeOne 同时用 `X-Forwarded-For` 和 `EO-Connecting-IP` 两个头携带真实客户端 IP（用临时
   调试 location 加 `$http_x_forwarded_for`/`$http_eo_connecting_ip` 验证过，两者取值一致）；选用
   `X-Forwarded-For` 是因为 `server/src/middleware/rateLimit.ts` 和 `deploy/nginx.conf` 里
   `proxy_set_header X-Forwarded-For` 已经在用这个头，不需要再引入一个新头。

   `deploy/update-edgeone-real-ip.sh` 从 EdgeOne 官方回源 IP 列表接口
   （`https://api.edgeone.ai/ips`）拉取当前网段，生成 `/etc/nginx/conf.d/edgeone-real-ip.conf`
   （`set_real_ip_from` × N + `real_ip_header X-Forwarded-For;`），测试并 reload nginx。**不要手抄一份
   静态网段列表进版本库**——EdgeOne 会不定期变更回源 IP（提前 14/7/3/1 天通知），网段应该用这个脚本
   重新拉取而不是手工维护。已在 CVM 上跑过一次并验证：跑之前 `access.log` 里的来源 IP 是 EdgeOne
   节点 IP（如 `222.79.116.201`），跑完之后变成真实访客 IP（如 `219.134.95.147`）。

   **注意**：`https://api.edgeone.ai/ips` 接口自带下线公告——"2026-07-31 停止服务，2026-08-31 正式
   下线"。到期前需要在 <https://cloud.tencent.com/document/product/1552/76086> 或 EdgeOne 控制台的
   源站防护页面找到替代数据源，更新 `deploy/update-edgeone-real-ip.sh` 里的 URL。

   **后续维护**：EdgeOne 网段变更时，重新在 CVM 上跑一次
   `bash /srv/sim-waimai/deploy/update-edgeone-real-ip.sh` 即可（幂等，直接覆盖生成的文件）。

6. 【手动，验证】CDN 生效后，用 `curl -s https://sim-waimai.moonfair.cn/api/health` 确认站点仍可
   访问；在 CVM 上 `tail -f /var/log/nginx/access.log` 观察请求日志里的来源 IP 是否变回访客真实 IP
   （而不是全部变成同几个 EdgeOne 节点 IP），确认 `real_ip` 生效。

## 可用性监控（UptimeRobot）

1. 【手动，控制台】注册 UptimeRobot 账号（或复用已有账号）。
2. 【手动，控制台】新建一个 HTTP(s) 监控项，URL 填 `https://sim-waimai.moonfair.cn/api/health`，
   检测间隔用免费版最小间隔（通常是 5 分钟）。
3. 【手动，控制台】断言规则设为"响应体包含 `"ok":true`"（而不只是 HTTP 200），这样服务端进程假死
   但端口还开着的情况也能被发现。
4. 【手动，控制台】配置告警通道（邮箱/短信/Webhook，任选其一），确保站点下线时能实际收到通知。
