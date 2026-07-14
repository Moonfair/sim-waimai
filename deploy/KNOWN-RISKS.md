# 已知风险（有意不处理）

## CentOS 7 EOL

`sim-waimai.moonfair.cn` 部署在 CentOS Linux 7 (x86_64) 上。CentOS 7 已于 2024 年 6 月 30 日结束官方
维护，不再收到安全补丁。操作系统换代（迁移到 CentOS Stream / Rocky Linux / Ubuntu 等）工作量大、
风险高，本次安全加固（见 `docs/superpowers/specs/2026-07-14-security-hardening-design.md`）不处理，
只记录为已知风险，留待单独立项评估。

缓解措施（已落地，见同一份设计文档 + `docs/superpowers/plans/2026-07-14-security-hardening.md`）：
`firewalld` 主机防火墙 + `fail2ban` sshd 防护 + 腾讯云安全组，在不换操作系统的前提下缩小攻击面。
