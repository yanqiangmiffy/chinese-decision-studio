"""SSE 帧格式：每帧一行 data: {json}，以 data: [DONE] 结束。协议见 docs/event-protocol.md。"""

import json
from typing import Any

SSE_HEADERS = {
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",  # 告诉 nginx：这个响应别缓冲
}
SSE_DONE = "data: [DONE]\n\n"


def sse(event: dict[str, Any]) -> str:
    return f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
