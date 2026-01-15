# 自托管 Supabase 部署指南

本文档介绍如何在公司服务器上部署自托管的 Supabase，以替代 Supabase Cloud 服务。

## 服务器要求

| 资源 | 最低配置 | 推荐配置 |
|-----|---------|---------|
| CPU | 2 核 | 4 核+ |
| 内存 | 4 GB | 8 GB+ |
| 磁盘 | 20 GB | 50 GB+ SSD |
| 系统 | Linux (Ubuntu 20.04+) | Ubuntu 22.04 LTS |

**必备软件**：
- Docker 20.10+
- Docker Compose v2.0+
- Git

## 一、服务器部署

### 1.1 安装 Docker（如未安装）

```bash
# Ubuntu/Debian
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# 重新登录后验证
docker --version
docker compose version
```

### 1.2 克隆 Supabase 仓库

```bash
cd /opt
sudo git clone --depth 1 https://github.com/supabase/supabase
sudo chown -R $USER:$USER supabase
cd supabase/docker
```

### 1.3 配置环境变量

```bash
# 复制示例配置
cp .env.example .env
```

编辑 `.env` 文件，**必须修改以下安全相关的值**：

```bash
############
# Secrets - 必须修改！
############

# 生成新的 JWT Secret（至少 32 字符）
JWT_SECRET=your-super-secret-jwt-token-at-least-32-characters-long

# 生成新的 ANON KEY（使用 https://supabase.com/docs/guides/self-hosting/docker#generate-api-keys）
ANON_KEY=your-anon-key

# 生成新的 SERVICE ROLE KEY
SERVICE_ROLE_KEY=your-service-role-key

# PostgreSQL 密码
POSTGRES_PASSWORD=your-strong-database-password

# Dashboard 登录密码
DASHBOARD_PASSWORD=your-dashboard-password

############
# 站点配置
############

# 你的服务器域名或 IP
SITE_URL=https://your-domain.com
API_EXTERNAL_URL=https://your-domain.com

# Studio 配置
STUDIO_PORT=3000
STUDIO_PG_META_URL=http://kong:8000/pg
```

### 1.4 生成 API Keys

使用官方工具生成安全的 API Keys：

```bash
# 安装 Node.js（如未安装）
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# 生成 keys
npx supabase-keys generate --jwt-secret "your-jwt-secret"
```

或者访问 https://supabase.com/docs/guides/self-hosting/docker#generate-api-keys 在线生成。

### 1.5 配置 SMTP（邮件发送）

在 `.env` 文件中配置 SMTP：

```bash
############
# SMTP 配置（用于发送注册确认邮件等）
############

SMTP_ADMIN_EMAIL=admin@your-company.com
SMTP_HOST=smtp.your-company.com
SMTP_PORT=587
SMTP_USER=your-smtp-user
SMTP_PASS=your-smtp-password
SMTP_SENDER_NAME=Presales Agent
```

常用 SMTP 服务配置示例：

**阿里云邮件推送**：
```bash
SMTP_HOST=smtpdm.aliyun.com
SMTP_PORT=465
```

**腾讯企业邮箱**：
```bash
SMTP_HOST=smtp.exmail.qq.com
SMTP_PORT=465
```

### 1.6 启动服务

```bash
# 拉取镜像并启动
docker compose pull
docker compose up -d

# 查看服务状态
docker compose ps

# 查看日志
docker compose logs -f
```

### 1.7 验证部署

- **Supabase Studio**: http://your-server:3000
- **API 端点**: http://your-server:8000
- **数据库**: your-server:5432

## 二、应用配置

### 2.1 修改项目环境变量

在项目根目录创建或修改 `.env.local`：

```bash
# 将 Supabase Cloud URL 替换为自托管地址
NEXT_PUBLIC_SUPABASE_URL=http://your-server:8000
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key

# 站点 URL
NEXT_PUBLIC_SITE_URL=http://your-app-domain:3000
```

### 2.2 初始化数据库

连接到 PostgreSQL 并执行数据库 Schema：

```bash
# 方法 1：通过 psql
psql -h your-server -p 5432 -U postgres -d postgres < docs/database-schema.sql

# 方法 2：通过 Supabase Studio
# 1. 打开 http://your-server:3000
# 2. 进入 SQL Editor
# 3. 粘贴 docs/database-schema.sql 内容并执行
```

### 2.3 测试连接

```bash
# 启动项目
pnpm dev

# 测试注册/登录功能
```

## 三、生产环境配置

### 3.1 配置 Nginx 反向代理（推荐）

```nginx
# /etc/nginx/sites-available/supabase
server {
    listen 80;
    server_name supabase.your-domain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name supabase.your-domain.com;

    ssl_certificate /etc/letsencrypt/live/supabase.your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/supabase.your-domain.com/privkey.pem;

    # Kong API Gateway
    location / {
        proxy_pass http://localhost:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 443 ssl http2;
    server_name studio.your-domain.com;

    ssl_certificate /etc/letsencrypt/live/studio.your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/studio.your-domain.com/privkey.pem;

    # Supabase Studio
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### 3.2 配置 SSL 证书

```bash
# 使用 Let's Encrypt
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d supabase.your-domain.com -d studio.your-domain.com
```

### 3.3 配置数据备份

创建备份脚本 `/opt/supabase/backup.sh`：

```bash
#!/bin/bash
BACKUP_DIR="/var/backups/supabase"
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p $BACKUP_DIR

# 备份 PostgreSQL
docker compose -f /opt/supabase/docker/docker-compose.yml exec -T db \
  pg_dump -U postgres > "$BACKUP_DIR/supabase_$DATE.sql"

# 压缩并保留最近 7 天
gzip "$BACKUP_DIR/supabase_$DATE.sql"
find $BACKUP_DIR -name "*.gz" -mtime +7 -delete

echo "Backup completed: supabase_$DATE.sql.gz"
```

设置定时任务：

```bash
chmod +x /opt/supabase/backup.sh

# 每天凌晨 3 点备份
crontab -e
# 添加：0 3 * * * /opt/supabase/backup.sh
```

## 四、运维命令

```bash
cd /opt/supabase/docker

# 查看服务状态
docker compose ps

# 查看日志
docker compose logs -f [service_name]

# 重启所有服务
docker compose restart

# 重启单个服务
docker compose restart kong
docker compose restart auth
docker compose restart db

# 更新到最新版本
docker compose pull
docker compose up -d

# 停止所有服务
docker compose down

# 停止并删除数据（危险！）
docker compose down -v
```

## 五、故障排查

### 5.1 无法连接数据库

```bash
# 检查数据库容器状态
docker compose logs db

# 测试数据库连接
docker compose exec db psql -U postgres -c "SELECT 1"
```

### 5.2 认证服务异常

```bash
# 检查 Auth 服务日志
docker compose logs auth

# 常见问题：JWT_SECRET 配置错误
```

### 5.3 邮件发送失败

```bash
# 检查 SMTP 配置
docker compose logs auth | grep -i smtp

# 测试 SMTP 连接
telnet smtp.your-company.com 587
```

## 六、安全建议

1. **修改默认密码**：确保所有默认密码都已更改
2. **限制网络访问**：使用防火墙限制 5432 端口的外部访问
3. **启用 SSL**：生产环境务必使用 HTTPS
4. **定期备份**：配置自动备份策略
5. **监控告警**：配置服务器监控和告警
6. **定期更新**：关注 Supabase 安全更新

## 七、资源链接

- [Supabase 自托管文档](https://supabase.com/docs/guides/self-hosting)
- [Docker 部署指南](https://supabase.com/docs/guides/self-hosting/docker)
- [API Keys 生成器](https://supabase.com/docs/guides/self-hosting/docker#generate-api-keys)
- [Supabase GitHub](https://github.com/supabase/supabase)
