# ---- 构建阶段：编译 better-sqlite3 原生模块 ----
FROM node:18-alpine AS build
WORKDIR /app
# better-sqlite3 与 canvas 在 alpine 下需要编译工具与原生库头文件
RUN apk add --no-cache python3 make g++ pkgconf \
    cairo-dev pango-dev jpeg-dev giflib-dev librsvg-dev pixman-dev
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src

# ---- 运行阶段：只带产物，镜像更小 ----
FROM node:18-alpine
WORKDIR /app
# 时区双保险：日期逻辑已在代码里显式按 UTC+8 计算（src/week.js），
# 这里再把容器时区设为北京时间，让日志时间戳等显示一致
# tzdata + canvas 运行期依赖的原生库 + 中文字体（金主报告海报渲染中文用）
RUN apk add --no-cache tzdata \
    cairo pango jpeg giflib librsvg pixman \
    font-noto-cjk fontconfig
ENV TZ=Asia/Shanghai
ENV NODE_ENV=production
ENV DATA_DIR=/app/data
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/src ./src
COPY package*.json ./
# public-version: 2
COPY public ./public
EXPOSE 3000
VOLUME ["/app/data"]
CMD ["node", "src/app.js"]
