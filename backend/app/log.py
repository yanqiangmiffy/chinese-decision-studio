"""日志：loguru，每条日志带 trace_id（问答链路里就是这次回答的 message_id）。"""

import logging
import sys

from loguru import logger

FORMAT = (
    "<green>{time:YYYY-MM-DD HH:mm:ss.SSS}</green> | <level>{level:<7}</level> | "
    "trace=<cyan>{extra[trace_id]}</cyan> | {name}:{function}:{line} | <level>{message}</level>"
)


def setup_logging(level: str = "INFO") -> None:
    logger.remove()
    # 给 trace_id 一个默认值，否则请求之外打的日志会因为缺字段而格式化失败
    logger.configure(extra={"trace_id": "-"})
    logger.add(sys.stdout, level=level.upper(), format=FORMAT, backtrace=False, diagnose=False)
    # 第三方库的标准 logging 降噪
    for name in ("httpx", "httpcore"):
        logging.getLogger(name).setLevel(logging.WARNING)
