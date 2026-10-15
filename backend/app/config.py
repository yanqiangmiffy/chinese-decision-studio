"""全局配置：代码默认值 → .env → 环境变量（compose 的 environment）三层覆盖。"""

from functools import lru_cache
from typing import Any

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # env_ignore_empty：compose 里 ${VAR:-} 传进来的空字符串按"没设置"处理，走默认值
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", env_ignore_empty=True, extra="ignore")

    APP_NAME: str = "Decision Studio"
    APP_VERSION: str = "0.1.0"
    LOG_LEVEL: str = "INFO"

    # ---- 存储：历史记录、评测集、评测运行、压测记录
    DATABASE_URL: str = "postgresql+asyncpg://studio:studio@localhost:5432/studio"

    # ---- 决策服务：chinese-decision 的推理服务（GPU：scripts/serve_gpu.py；CPU：scripts/serve.py）
    DECISION_BASE_URL: str = "http://gpu-server.example.com:8003"
    DECISION_TIMEOUT: float = 120.0
    # 热更新检查点用的令牌，和 GPU 服务器部署目录下的 .admin-token 一致；留空 = 平台里不提供热更新
    DECISION_ADMIN_TOKEN: str = ""

    # ---- 对照大模型：任意 OpenAI 兼容端点；留空 = 不启用"决策模型 vs 大模型"对比
    LLM_BASE_URL: str = ""
    LLM_API_KEY: str = "EMPTY"
    LLM_MODEL: str = "Qwen3-32B"
    LLM_TIMEOUT: float = 60.0
    # 只有 vLLM 等自部署服务认识的扩展参数（JSON），云厂商 API 请保持为空
    LLM_EXTRA_BODY: dict[str, Any] = Field(default_factory=dict)
    # 评测时对照大模型最多跑多少条决策（大模型慢，避免一次评测占用太久）
    LLM_EVAL_LIMIT: int = 200
    LLM_CONCURRENCY: int = 8

    # ---- 评测与压测
    EVAL_BATCH_SIZE: int = 64  # 每次 /v1/batch 提交的请求数
    BENCH_MAX_REQUESTS: int = 20000
    BENCH_MAX_CONCURRENCY: int = 256
    IMPORT_MAX_CASES: int = 20000

    # ---- 应用
    CORS_ORIGINS: str = "*"
    # 非容器部署时由后端托管前端构建产物（例如 ../frontend/dist）；容器里由 nginx 托管，留空即可
    STATIC_DIR: str = ""

    @property
    def cors_origin_list(self) -> list[str]:
        if self.CORS_ORIGINS.strip() == "*":
            return ["*"]
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
