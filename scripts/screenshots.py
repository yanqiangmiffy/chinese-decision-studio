"""给 README 截图：用 Playwright 打开正在运行的平台，逐页截图到 docs/assets/。

需要平台已经启动（docker compose up -d）、决策服务在线，并且已经跑过至少一次评测：

  pip install playwright && playwright install chromium
  python scripts/screenshots.py --base http://localhost:8080 --run 10

截图里的数字都是真实调用模型得到的，每次运行会略有不同。
"""

import argparse
from pathlib import Path

from playwright.sync_api import Page, sync_playwright

OUT = Path(__file__).resolve().parents[1] / "docs" / "assets"


def shot(page: Page, name: str, full: bool = False) -> None:
    path = OUT / f"{name}.png"
    page.screenshot(path=str(path), full_page=full)
    print(f"saved {path.relative_to(OUT.parents[1])}")


def click(page: Page, text: str) -> None:
    page.get_by_role("button", name=text).first.click()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--base", default="http://localhost:8080")
    parser.add_argument("--run", type=int, help="评测报告截图用的运行 id")
    parser.add_argument("--scale", type=float, default=1.25, help="设备像素比，越大越清晰、文件越大")
    args = parser.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    base = args.base.rstrip("/")

    with sync_playwright() as p:
        browser = p.chromium.launch()
        context = browser.new_context(viewport={"width": 1600, "height": 1000}, device_scale_factor=args.scale,
                                      locale="zh-CN", color_scheme="dark")
        page = context.new_page()

        page.goto(f"{base}/")
        page.wait_for_timeout(3200)  # 等实时演示打完字、拿到概率（每 5.2 秒换一题）
        shot(page, "overview")

        page.goto(f"{base}/playground")
        page.wait_for_timeout(800)
        click(page, "运行决策")
        page.wait_for_selector(".result-card", timeout=30000)
        page.wait_for_timeout(1500)
        shot(page, "playground")

        page.goto(f"{base}/scenarios")
        page.wait_for_timeout(1500)
        shot(page, "scenarios")

        page.goto(f"{base}/scenarios/danmaku")
        page.wait_for_timeout(11000)  # 让弹幕飞一会儿
        shot(page, "scenario-danmaku")

        page.goto(f"{base}/scenarios/triage")
        page.wait_for_timeout(1500)
        click(page, "批量分诊")
        page.wait_for_selector(".kanban", timeout=30000)
        page.wait_for_timeout(1200)
        shot(page, "scenario-triage")

        page.goto(f"{base}/scenarios/guardrail")
        page.wait_for_selector(".verdict-banner", timeout=30000)
        page.wait_for_timeout(1200)
        shot(page, "scenario-guardrail")

        page.goto(f"{base}/scenarios/reviews")
        page.wait_for_timeout(800)
        click(page, "分析全部评论")
        page.wait_for_selector(".diverge", timeout=60000)
        page.wait_for_timeout(2500)
        shot(page, "scenario-reviews")

        page.goto(f"{base}/scenarios/agent")
        page.wait_for_selector(".trace-step", timeout=30000)
        page.wait_for_timeout(1200)
        shot(page, "scenario-agent")

        page.goto(f"{base}/lab")
        page.wait_for_timeout(800)
        click(page, "开始测试")
        page.wait_for_selector(".lab-facts", timeout=60000)
        page.wait_for_timeout(6000)
        page.evaluate("window.scrollTo(0, 0)")
        page.wait_for_timeout(500)
        shot(page, "lab")

        page.goto(f"{base}/eval")
        page.wait_for_timeout(2000)
        shot(page, "eval")

        if args.run:
            page.goto(f"{base}/eval/runs/{args.run}")
            page.wait_for_timeout(2500)
            shot(page, "eval-report")
            page.evaluate("window.scrollTo(0, 1050)")
            page.wait_for_timeout(1000)
            shot(page, "eval-report-2")

        page.goto(f"{base}/bench")
        page.wait_for_timeout(1000)
        click(page, "开始压测")
        page.wait_for_timeout(9000)  # 压测进行中截图，曲线是实时的
        shot(page, "bench")
        stop = page.get_by_role("button", name="停止")
        if stop.count():  # 压测可能已经跑完
            stop.first.click()

        browser.close()


if __name__ == "__main__":
    main()
