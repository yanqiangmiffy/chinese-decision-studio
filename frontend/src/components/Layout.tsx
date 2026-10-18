import {
  BookOpen,
  FlaskConical,
  Gauge,
  History,
  LayoutDashboard,
  Microscope,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Sparkles,
  Sun,
  Target,
} from "lucide-react";
import type { ReactNode } from "react";
import { useApp } from "../hooks/useApp";
import { ms } from "../lib/format";
import { SCENARIOS } from "../lib/scenarios";
import { Link, usePath } from "../router";
import { Logo, Tip } from "./ui";

const NAV: { group: string; items: { to: string; label: string; icon: ReactNode; badge?: string }[] }[] = [
  {
    group: "探索",
    items: [
      { to: "/", label: "总览", icon: <LayoutDashboard /> },
      { to: "/playground", label: "决策实验台", icon: <FlaskConical /> },
      { to: "/scenarios", label: "场景库", icon: <Sparkles />, badge: String(SCENARIOS.length) },
    ],
  },
  {
    group: "测试",
    items: [
      { to: "/lab", label: "鲁棒性实验室", icon: <Microscope /> },
      { to: "/eval", label: "评测中心", icon: <Target /> },
      { to: "/bench", label: "性能压测", icon: <Gauge /> },
    ],
  },
  {
    group: "数据",
    items: [
      { to: "/history", label: "历史记录", icon: <History /> },
      { to: "/docs", label: "接入文档", icon: <BookOpen /> },
    ],
  },
];

function isActive(path: string, to: string) {
  return to === "/" ? path === "/" : path === to || path.startsWith(`${to}/`);
}

export function Layout({ children }: { children: ReactNode }) {
  const path = usePath();
  const { health, theme, toggleTheme, collapsed, setCollapsed } = useApp();
  const online = health?.decision.online;
  return (
    <div className={`app ${collapsed ? "collapsed" : ""}`}>
      <aside className="sidebar">
        <Link to="/" className="brand">
          <span className="brand-mark">
            <Logo size={22} />
          </span>
          <span className="brand-text">
            <div className="brand-name">Decision Studio</div>
            <div className="brand-sub">决策工坊 · 测试平台</div>
          </span>
        </Link>
        <nav className="nav">
          {NAV.map((g) => (
            <div key={g.group} className="col" style={{ gap: 2 }}>
              <div className="nav-label">{g.group}</div>
              {g.items.map((item) => (
                <Link key={item.to} to={item.to} className={`nav-item ${isActive(path, item.to) ? "active" : ""}`} title={item.label}>
                  {item.icon}
                  <span>{item.label}</span>
                  {item.badge && <span className="nav-badge">{item.badge}</span>}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">
          <Tip text={online ? `决策服务在线：${health?.decision.base_url}` : "决策服务不可达"}>
            <div className="sidebar-status" style={{ width: "100%" }}>
              <div className="row">
                <span className={`dot ${health === null ? "" : online ? "live" : "down"}`} />
                <span className="status-text small" style={{ fontWeight: 600 }}>
                  {health === null ? "连接中…" : online ? "决策服务在线" : "决策服务离线"}
                </span>
              </div>
              <div className="status-text col" style={{ gap: 2 }}>
                <span className="mono tiny faint">chinese-decision-0.8b</span>
                <span className="tiny faint num">
                  {online ? `step ${health?.decision.step ?? "—"} · RTT ${ms(health?.decision.rtt_ms)}` : health?.decision.base_url ?? ""}
                </span>
                {health?.llm.configured && (
                  <span className="tiny faint row" style={{ gap: 6 }}>
                    <span className={`dot ${health.llm.online ? "warn" : "down"}`} style={{ width: 6, height: 6 }} />
                    对照：{health.llm.model}
                  </span>
                )}
              </div>
            </div>
          </Tip>
          <div className="sidebar-tools">
            <button className="btn ghost sm icon" onClick={toggleTheme} aria-label="切换主题" title="切换主题">
              {theme === "dark" ? <Sun /> : <Moon />}
            </button>
            <button className="btn ghost sm icon" onClick={() => setCollapsed(!collapsed)} aria-label="收起侧栏" title={collapsed ? "展开侧栏" : "收起侧栏"}>
              {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
            </button>
          </div>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
