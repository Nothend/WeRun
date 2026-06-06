# ---- 构建阶段：编译 better-sqlite3 原生模块 ----
FROM node:18-alpine AS build
WORKDIR /app
# better-sqlite3 在 alpine 下需要编译工具
RUN apk add --no-cache python3 make g++
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src

# ---- 运行阶段：只带产物，镜像更小 ----
FROM node:18-alpine
WORKDIR /app
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
