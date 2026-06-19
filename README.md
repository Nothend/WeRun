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

### 防作弊机制
- **图片哈希查重**：同一用户不能重复使用同一张截图（跨天、跨周均有效）
- **日期校验**：Qwen-VL 识别截图中的运动日期，非今日或昨日截图将被拒绝

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

> 运维小工具见 [`server/tools/README.md`](server/tools/README.md)，含运动截图识别的多模型测速 / 测准脚本（换模型、调提示词前做选型）。

## 首个管理员
- 默认：**第一个登录的用户**自动成为管理员。
- 或在 `.env` 设 `BOOTSTRAP_ADMIN_OPENID=<你的openid>` 指定。
- 管理员可在小程序「后台管理」页踢出成员、给他人设/取消管理员（至少保留一名管理员）。

## 上线流程

### 一、服务端部署

1. **小程序账号**：在 [mp.weixin.qq.com](https://mp.weixin.qq.com) 注册个人小程序，记下 `AppID` / `AppSecret`。
2. **GitHub Secrets**（仓库 Settings → Secrets and variables → Actions）：
   - `ALIYUN_REGISTRY_URL`、`ALIYUN_REGISTRY_USERNAME`、`ALIYUN_REGISTRY_PASSWORD`、`ALIYUN_REGISTRY_NAMESPACE`
   - `ALIYUN_ECS_IP`、`ALIYUN_ECS_USERNAME`、`ALIYUN_ECS_PASSWORD`、`ALIYUN_ECS_PORT`（可选，默认 22）
3. **阿里云 ACR**：创建命名空间与 `werun` 镜像仓库。
4. **ECS 准备**：安装 Docker + docker compose；建目录 `/dockers/werun/`，放入仓库里的 `server/docker-compose.yml`，再创建 `.env`（参考 `server/.env.example`，必填项见下表），并 `mkdir data`。
5. **域名 HTTPS**：域名 A 记录解析到 ECS IP → Caddy 自动申请证书（已内置在 `Caddyfile` 配置中）。
6. **发布镜像**：`git tag v1.0.0 && git push origin v1.0.0` → GitHub Actions 自动构建并部署。

**ECS `.env` 必填项：**

| 变量 | 说明 |
|---|---|
| `APPID` | 微信小程序 AppID |
| `APPSECRET` | 微信小程序 AppSecret |
| `DASHSCOPE_API_KEY` | 阿里云百炼 Qwen-VL API Key |
| `JWT_SECRET` | 随机长字符串，用于签发登录 token |
| `PUBLIC_BASE_URL` | 服务器对外 HTTPS 域名，如 `https://your.domain.com` |
| `WERUN_IMAGE` | ACR 镜像地址 |

**可选配置：**

| 变量 | 说明 |
|---|---|
| `WECHAT_NOTIFY_TEMPLATE_ID` | 管理员打卡通知的订阅消息模板 ID（留空则不推送） |
| `BOOTSTRAP_ADMIN_OPENID` | 指定首个管理员 openid（留空则第一个登录者自动成为管理员） |

---

### 二、小程序发布前检查清单

> 小程序代码运行在用户手机上，与服务端 Docker 容器**完全独立**，需要单独上传到微信平台。

**第一步：填写 `miniprogram/project.config.json`**

把 `appid` 改为真实的 AppID（在微信公众平台查看）：
```json
{
  "appid": "wx你的真实AppID"
}
```

**第二步：修改 `miniprogram/config.js`**

```js
module.exports = {
  baseUrl: 'https://your.domain.com',  // 与 server/.env 的 PUBLIC_BASE_URL 保持一致
  notifyTemplateId: '',                 // 与 server/.env 的 WECHAT_NOTIFY_TEMPLATE_ID 保持一致
};
```

**第三步：配置服务器域名白名单**

在微信公众平台「开发管理 → 开发设置 → 服务器域名」中添加：

| 类型 | 域名 |
|---|---|
| request 合法域名 | `https://your.domain.com` |
| uploadFile 合法域名 | `https://your.domain.com` |

**第四步：上传发布**

用微信开发者工具导入 `miniprogram/` → 点「上传」→ 登录微信公众平台提交审核（类目选「体育 → 跑步」或「工具」）→ 审核通过后发布 → 生成小程序码发到群里。

---

### 三、打卡通知（可选）

如需管理员收到打卡微信推送，需额外完成：

1. 登录微信公众平台 → 功能 → 订阅消息 → 选用模板，按以下字段定义：

   | 字段 | 类型 | 含义 |
   |---|---|---|
   | `thing1` | 文字（≤20字） | 打卡成员昵称 |
   | `number2` | 数字 | 运动时长（分钟） |
   | `phrase3` | 短语 | 本周状态（如"本周已达标"） |
   | `date4` | 日期时间 | 打卡时间 |

2. 复制模板 ID，填入 `server/.env` 的 `WECHAT_NOTIFY_TEMPLATE_ID`，同时填入 `miniprogram/config.js` 的 `notifyTemplateId`（或重新跑 `gen-config`）。
3. 管理员在小程序「后台管理」页开启「打卡通知」开关，微信会弹出订阅授权窗口，授权后即可收到推送。

## 后续迭代
改代码 → 提交 → 打新 tag（`v1.0.1`）推送，CI 自动重建镜像并滚动更新 ECS 容器；`data/`（SQLite + 头像）为挂载卷，不受重建影响。

## API 一览
| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/login` | `{code}` 换 token |
| POST | `/api/profile` | 更新头像(可选)/昵称 |
| POST | `/api/checkin` | 上传截图打卡（含防作弊） |
| GET | `/api/stats/me` | 我的本周状态 |
| GET | `/api/stats/group` | 群周榜 |
| GET | `/api/admin/users` | 用户列表（管理员）|
| POST | `/api/admin/users/:openid/kick` | 踢出用户（管理员）|
| POST | `/api/admin/users/:openid/admin` | 设/取消管理员（管理员）|
| POST | `/api/admin/users/:openid/nickname` | 修改用户昵称（管理员）|
| GET | `/api/admin/checkins` | 打卡日志，支持分页（管理员）|
| POST | `/api/admin/notify-setting` | 设置自己是否接收打卡通知（管理员）|
| POST | `/api/admin/import` | 导入历史 Excel 打卡数据（管理员）|
| GET | `/health` | 健康检查（含 mock 状态）|
