"""依赖装配：所有服务都是懒加载单例。路由里用 Depends 注入，测试里用 app.dependency_overrides 替换。"""

from functools import lru_cache

from app.config import get_settings
from app.db.session import get_sessionmaker
from app.services.decision_client import DecisionClient
from app.services.eval_service import EvalRunner
from app.services.extraction_client import ExtractionClient
from app.services.llm_service import LLMService


@lru_cache
def get_decision_client() -> DecisionClient:
    return DecisionClient(get_settings())


@lru_cache
def get_extraction_client() -> ExtractionClient:
    return ExtractionClient(get_settings())


@lru_cache
def get_llm_service() -> LLMService:
    return LLMService(get_settings())


@lru_cache
def get_eval_runner() -> EvalRunner:
    return EvalRunner(get_decision_client(), get_llm_service(), get_sessionmaker(), get_settings())
