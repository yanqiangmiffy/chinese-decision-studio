"""数据库会话：SQLAlchemy 2.0 异步引擎。懒加载——导入时不连库，测试可以注入自己的 sessionmaker。"""

from collections.abc import AsyncIterator

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from app.config import get_settings

_engine: AsyncEngine | None = None
_sessionmaker: async_sessionmaker[AsyncSession] | None = None


def get_sessionmaker() -> async_sessionmaker[AsyncSession]:
    global _engine, _sessionmaker
    if _sessionmaker is None:
        url = get_settings().DATABASE_URL
        kwargs = {} if url.startswith("sqlite") else {"pool_pre_ping": True, "pool_size": 10, "max_overflow": 20}
        _engine = create_async_engine(url, **kwargs)
        _sessionmaker = async_sessionmaker(_engine, expire_on_commit=False)
    return _sessionmaker


def set_sessionmaker(maker: async_sessionmaker[AsyncSession]) -> None:
    """测试用：换成内存 SQLite。"""
    global _sessionmaker
    _sessionmaker = maker


async def get_db() -> AsyncIterator[AsyncSession]:
    """普通 CRUD 接口用：Depends(get_db)。后台任务和流式生成器里不要用它，自己开会话。"""
    async with get_sessionmaker()() as session:
        yield session


async def ping() -> bool:
    try:
        async with get_sessionmaker()() as session:
            await session.execute(text("SELECT 1"))
        return True
    except Exception:  # noqa: BLE001
        return False


async def dispose_engine() -> None:
    """脚本退出前调用，避免连接池在事件循环关闭后才清理。"""
    global _engine, _sessionmaker
    if _engine is not None:
        await _engine.dispose()
    _engine, _sessionmaker = None, None
