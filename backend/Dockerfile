FROM python:3.12-slim

WORKDIR /app
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# 先装依赖再拷代码：只改代码时，依赖层直接命中缓存
# 国内网络可以在 .env 里设置 PIP_INDEX_URL，compose 会作为 build-arg 传进来
ARG PIP_INDEX_URL=https://pypi.org/simple
COPY requirements.txt .
RUN pip install -i "$PIP_INDEX_URL" -r requirements.txt

COPY . .
# Windows 上编辑过的脚本带 \r，不处理的话容器启动会报 no such file or directory
RUN sed -i 's/\r$//' docker-entrypoint.sh && chmod +x docker-entrypoint.sh

EXPOSE 8000
# slim 镜像里没有 curl，用 Python 自己探活
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/health', timeout=4)" || exit 1

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
