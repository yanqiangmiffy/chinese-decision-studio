FROM node:22-alpine AS build
WORKDIR /app

# 国内网络可以在 .env 里设置 NPM_REGISTRY，compose 会作为 build-arg 传进来
ARG NPM_REGISTRY=https://registry.npmjs.org
COPY package.json package-lock.json ./
RUN npm config set registry "$NPM_REGISTRY" && npm ci --no-audit --no-fund

COPY . .
# 前端只请求相对路径 /api，构建时不需要注入任何后端地址
RUN npm run build

FROM nginx:stable-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1/ >/dev/null 2>&1 || exit 1
