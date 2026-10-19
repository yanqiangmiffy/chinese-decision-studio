"""全局配置：代码默认值 → .env → 环境变量（compose 的 environment）三层覆盖。"""

from functools import lru_cache
from typing import Any, Literal

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
    # 协议：chinese-decision（自部署，支持 batch/compile/tournament）或 startlux（Bamboo Relay 等远端）
    DECISION_API_STYLE: Literal["chinese-decision", "startlux"] = "chinese-decision"
    # startlux 协议的 API key 和模型名；chinese-decision 协议忽略这两项
    DECISION_API_KEY: str = ""
    DECISION_MODEL: str = "startlux-decision-27b-autothink"
    DECISION_THINK_MODE: Literal["auto", "never", "always"] = "auto"
    # startlux 没有 /v1/batch，平台按这个并发数逐条调用
    DECISION_CONCURRENCY: int = 4
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

    # ---- MCP：挂在 FastAPI 的 /api/mcp/ 下，供 Claude Code 等 MCP 客户端调用
    MCP_ENABLED: bool = True
    # 逗号分隔的 Host 白名单；"*" 表示关闭 DNS rebinding 防护（只建议在反向代理已经校验 Host 时使用）
    MCP_ALLOWED_HOSTS: str = "localhost,localhost:*,127.0.0.1,127.0.0.1:*,[::1],[::1]:*"
    # 浏览器客户端才需要：逗号分隔的 Origin 白名单，例如 https://studio.example.com
    MCP_ALLOWED_ORIGINS: str = ""
    # 留空 = 不鉴权；设置后客户端需要带 Authorization: Bearer <token>
    MCP_AUTH_TOKEN: str = ""
    MCP_MAX_REQUEST_MB: int = 32

    # ---- 应用
    CORS_ORIGINS: str = "*"
    # 非容器部署时由后端托管前端构建产物（例如 ../frontend/dist）；容器里由 nginx 托管，留空即可
    STATIC_DIR: str = ""

    @property
    def cors_origin_list(self) -> list[str]:
        if self.CORS_ORIGINS.strip() == "*":
            return ["*"]
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]

    @property
    def mcp_allowed_hosts(self) -> list[str]:
        return [h.strip() for h in self.MCP_ALLOWED_HOSTS.split(",") if h.strip()]

    @property
    def mcp_allowed_origins(self) -> list[str]:
        return [o.strip() for o in self.MCP_ALLOWED_ORIGINS.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
