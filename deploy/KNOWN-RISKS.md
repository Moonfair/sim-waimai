# 已知风险（有意不处理）

## CentOS 7 EOL

`sim-waimai.moonfair.cn` 部署在 CentOS Linux 7 (x86_64) 上。CentOS 7 已于 2024 年 6 月 30 日结束官方
维护，不再收到安全补丁。操作系统换代（迁移到 CentOS Stream / Rocky Linux / Ubuntu 等）工作量大、
风险高，本次安全加固（见 `docs/superpowers/specs/2026-07-14-security-hardening-design.md`）不处理，
只记录为已知风险，留待单独立项评估。

缓解措施（已落地，见同一份设计文档 + `docs/superpowers/plans/2026-07-14-security-hardening.md`）：
`firewalld` 主机防火墙 + `fail2ban` sshd 防护 + 腾讯云安全组，在不换操作系统的前提下缩小攻击面。

## 证书自动续期实测会失败（DNSPod 拦截，疑似 ICP 备案问题）

2026-07-14 执行 `certbot renew --dry-run` 实测失败（`AuthorizationError: Some challenges have
failed.`）。日志显示 Let's Encrypt 校验节点（`43.174.225.201`）请求
`http://sim-waimai.moonfair.cn/.well-known/acme-challenge/...` 时，收到的不是 CVM 上 Nginx 的响应，
而是 `https://dnspod.qcloud.com/static/webblock.html?d=sim-waimai.moonfair.cn`——DNSPod 的拦截/占位
页面。从 CVM 自己 curl 同一个 URL 能正常拿到 200，说明站点本身没问题，问题出在外部校验节点走到这个
域名时被 DNSPod 拦截了，和域名未完成 ICP 备案（在腾讯云 DNSPod 上解析到境内 IP 的域名，境外/部分
校验节点访问时会被展示这个占位页）高度吻合。

**当前状态**：`certbot-renew.timer` 已启用（见部署计划 Task 9），但只要这个拦截问题不解决，证书快
到期时的自动续期大概率还是会用同样的方式静默失败——本次加固只是把"完全没有续期机制"变成"续期机制
已就位但会被卡住"，没有真正解决 10 月 12 日到期失效的根本问题。

**不在本次范围内处理**：ICP 备案是行政/合规流程，不是能通过 SSH/脚本解决的技术问题，需要用户自己
去处理。记录在这里，避免"timer 已启用"被误认为问题已经彻底解决。证书到期前需要人工确认一次
`certbot renew --dry-run` 是否已经能跑通；如果备案短期内办不下来，另一个可行方向是把校验方式从
HTTP-01 换成 DNS-01（需要 DNSPod API 凭证配置 certbot 的 dns-dnspod 插件），但这是超出本次加固范围
的改动，需要单独评估。

**2026-07-15 更新——接入 EdgeOne 后失败原因变了**：用户在 EdgeOne 控制台把域名接入了 CDN 并配置了
EdgeOne 自己的边缘 HTTPS 证书（域名现在 CNAME 到 `sim-waimai.moonfair.cn.eo.dnse1.com`）。这之后重新
跑 `certbot renew --dry-run`，还是失败，但报错变了：不再是 DNSPod 拦截页，而是
`Timeout during connect (likely firewall problem)`（校验节点 `211.95.70.121` 访问
`http://sim-waimai.moonfair.cn/.well-known/acme-challenge/...` 直接连接超时）——说明 EdgeOne 没有把
这个 HTTP-01 校验请求转发到源站。**根因和之前不一样了，此前"办 ICP 备案"这个结论不一定还适用**，需要
重新判断：

- 可能是 EdgeOne 侧默认强制跳转 HTTP→HTTPS 或者 WAF 拦了 `.well-known` 路径；
- 也可能是这类"CDN 边缘证书"架构下，更合适的做法本来就不是让源站自己续期公网可信证书——EdgeOne 已经
  用自己的证书在边缘终止 TLS，源站证书只在 EdgeOne 回源到 106.55.231.31 时才用得到，取决于回源协议
  是否严格校验源站证书。

这部分需要和用户一起确认 EdgeOne 的实际回源配置（HTTPS 回源是否校验证书、能不能关闭/绕开
`.well-known/acme-challenge` 的 CDN 缓存或跳转）之后再决定修复方向，本次不擅自改动。
