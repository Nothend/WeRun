# WeRun · 微信跑步群打卡统计小程序

一个面向 ~20 人微信跑步群的个人小程序：微信登录 → 上传跑步截图 → 千问 Qwen-VL 识别运动时长（≥30 分钟算一次）→ 每周打卡 ≥3 次算达标 → 群周榜 + 个人状态 + 简单后台管理。

## 目录结构
```
werun/
├─ miniprogram/            # 微信小程序前端（原生，无构建）
│  ├─ pages/{index,checkin,ranking,admin}
│  ├─ utils/api.js         # 请求/上传/登录封装
│  └─ config.js            # 后端地址（改这里切换环境）
├─ server/                 # Node.js + Express 后端
│  ├─ src/                 # 业务代码
│  ├─ Dockerfile  docker-compose.yml  .env.example
│  └─ deploy/nginx.conf.example
└─ .github/workflows/docker-image.yml   # tag 触发：构建镜像→推 ACR→部署 ECS
```

## 打卡规则
- 时长 **≥ 30 分钟** 算一次有效打卡（`MIN_DURATION_MINUTES`）
- 每周 **≥ 3 次** 算达标（`WEEKLY_TARGET`）
- **每天最多记 1 次**（数据库唯一约束）
- 不保存原图，只存识别出的时长与结果

## Mock 模式（未配置真实密钥也能跑）
- 未填真实 `APPID` → 微信登录用 code 派生稳定假 openid。
- 未填真实 `DASHSCOPE_API_KEY` → 打卡识别固定返回 35 分钟。
- `GET /health` 可查看当前是否处于 mock 模式。
> ⚠️ 这两个 mock 仅供本地联调，正式上线务必在 ECS 的 `.env` 填真实值。

## 本地开发
```bash
cd server
cp .env.example .env     # Windows: copy .env.example .env
npm install
npm start                # 监听 http://localhost:3000
```
小程序端：用微信开发者工具导入 `miniprogram/`，详情→本地设置勾选「不校验合法域名」，`config.js` 的 `baseUrl` 改为 `http://localhost:3000`。

## 首个管理员
- 默认：**第一个登录的用户**自动成为管理员。
- 或在 `.env` 设 `BOOTSTRAP_ADMIN_OPENID=<你的openid>` 指定。
- 管理员可在小程序「后台管理」页踢出成员、给他人设/取消管理员（至少保留一名管理员）。

## 上线流程
1. **小程序账号**：mp.weixin.qq.com 注册个人小程序 → 记下 `AppID` / `AppSecret`，并把 `miniprogram/project.config.json` 的 `appid` 改成真实 AppID。
2. **GitHub Secrets**（仓库 Settings → Secrets and variables → Actions）：
   - `ALIYUN_REGISTRY_URL`、`ALIYUN_REGISTRY_USERNAME`、`ALIYUN_REGISTRY_PASSWORD`、`ALIYUN_REGISTRY_NAMESPACE`
   - `ALIYUN_ECS_IP`、`ALIYUN_ECS_USERNAME`、`ALIYUN_ECS_PASSWORD`、`ALIYUN_ECS_PORT`（可选，默认 22）
3. **阿里云 ACR**：创建命名空间与 `werun` 镜像仓库。
4. **ECS 准备**：安装 Docker + docker compose；建目录 `/dockers/werun/`，放入仓库里的 `server/docker-compose.yml`，再创建真实 `.env`（含 `APPID/APPSECRET/DASHSCOPE_API_KEY/JWT_SECRET/PUBLIC_BASE_URL/WERUN_IMAGE`），并 `mkdir data`。
5. **域名 HTTPS**：域名 A 记录解析到 ECS IP → 申请 SSL 证书 → 按 `server/deploy/nginx.conf.example` 配置 nginx（443 反代到 `127.0.0.1:3000`）。
6. **发布镜像**：本地 `git tag v1.0.0 && git push origin v1.0.0` → GitHub Actions 自动构建并部署。
7. **服务器域名白名单**：小程序后台「开发管理→开发设置→服务器域名」把 HTTPS 域名加入 **request / uploadFile / downloadFile**。
8. **小程序发布**：开发者工具上传代码 → 提交审核（类目选「体育」或「工具」）→ 通过后发布 → 生成小程序码发到群里。

## 后续迭代
改代码 → 提交 → 打新 tag（`v1.0.1`）推送，CI 自动重建镜像并滚动更新 ECS 容器；`data/`（SQLite + 头像）为挂载卷，不受重建影响。

## API 一览
| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/login` | `{code}` 换 token |
| POST | `/api/profile` | 更新头像(可选)/昵称 |
| POST | `/api/checkin` | 上传截图打卡 |
| GET | `/api/stats/me` | 我的本周状态 |
| GET | `/api/stats/group` | 群周榜 |
| GET | `/api/admin/users` | 用户列表（管理员）|
| POST | `/api/admin/users/:openid/kick` | 踢出用户（管理员）|
| POST | `/api/admin/users/:openid/admin` | 设/取消管理员（管理员）|
| GET | `/health` | 健康检查 |
