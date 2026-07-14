# 管理后台 IP 白名单

`/api/admin/*` 只允许指定公网 IP 访问，其余一律拒绝。这条规则**不通过 `deploy/nginx.conf` 下发**——
真实 IP 是运维者的个人出口 IP，写进这个公开仓库的版本控制文件会把它永久暴露在 GitHub 历史里。
规则直接改在 CVM 上部署好的 `/etc/nginx/conf.d/sim-waimai.conf`，不进 git。

## 首次配置 / IP 变更后更新

1. 在**本机**（不是 CVM 上）查当前公网 IP：

   ```bash
   curl -s ifconfig.me
   ```

2. SSH 到 CVM，在 `/etc/nginx/conf.d/sim-waimai.conf` 里加一个 `location /api/admin/` block
   （Nginx 对前缀 location 按最长匹配优先，写在文件里靠前还是靠后不影响生效，放前面只是方便人读）：

   ```nginx
   location /api/admin/ {
       allow <YOUR_PUBLIC_IP>;
       deny all;
       proxy_pass http://127.0.0.1:3001;
       proxy_set_header Host $host;
       proxy_set_header X-Real-IP $remote_addr;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
       proxy_set_header X-Forwarded-Proto $scheme;
   }
   ```

   把 `<YOUR_PUBLIC_IP>` 换成第 1 步查到的地址（可以是单个 IP，也可以是 CIDR，如 `1.2.3.0/24`）。

3. `nginx -t && systemctl reload nginx`。

4. 验证：白名单外的来源访问 `https://sim-waimai.moonfair.cn/api/admin/...` 应该收到 403（或连接被
   拒绝）；白名单内的来源正常拿到响应。

## 动态 IP 场景

家庭/移动网络的公网 IP 通常会变。IP 变化后，管理后台会开始返回 403——这不是故障，重新跑一遍上面
1-3 步换成新 IP 即可。
