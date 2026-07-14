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
5. 【可自动化】接入 CDN 后，源站看到的所有请求都会来自 EdgeOne 的回源节点 IP，而不是访客的真实 IP，
   Nginx 必须显式信任这些节点、从 `X-Forwarded-For` 里取真实客户端 IP，否则限流
   （`server/src/middleware/rateLimit.ts`）和访问日志会把所有请求都记成同一批 EdgeOne 节点 IP。

   在腾讯云 EdgeOne 控制台当前页面查到官方最新的回源 IP 网段列表（网段会变化，以控制台/官方文档
   当时展示的为准，不要抄旧文档里的网段），按下面的模板加到 CVM 的
   `/etc/nginx/conf.d/sim-waimai.conf` 里 `server {` block 之前（`http` 作用域）：

   ```nginx
   # EdgeOne 回源 IP 段——从腾讯云 EdgeOne 控制台复制，网段更新时同步这里
   set_real_ip_from <EDGEONE_CIDR_1>;
   set_real_ip_from <EDGEONE_CIDR_2>;
   # ……按控制台列出的网段数量重复
   real_ip_header X-Forwarded-For;
   ```

   改完 `nginx -t && systemctl reload nginx`。

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
