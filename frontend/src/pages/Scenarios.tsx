import { ArrowUpRight, Bot, FileSearch, Inbox, LayoutGrid, MessagesSquare, Scale, ShieldAlert, Sparkles, Users } from "lucide-react";
import type { ReactNode } from "react";
import { PageHead } from "../components/ui";
import { SCENARIOS } from "../lib/scenarios";
import { Link, useTitle } from "../router";

export const SCENARIO_ICONS: Record<string, ReactNode> = {
  Inbox: <Inbox />,
  MessagesSquare: <MessagesSquare />,
  Users: <Users />,
  ShieldAlert: <ShieldAlert />,
  FileSearch: <FileSearch />,
  Bot: <Bot />,
  LayoutGrid: <LayoutGrid />,
  Scale: <Scale />,
};

export default function Scenarios() {
  useTitle("场景库");
  return (
    <div className="page">
      <PageHead
        eyebrow="SCENARIOS · 场景库"
        icon={<Sparkles />}
        title={
          <>
            决策模型能做什么？<span className="grad-text">直接上手试</span>
          </>
        }
        desc="8 个可交互的小应用，覆盖决策模型最常见的用法：推测式扇出、实时审核、复合评分、护栏、检索重排、置信度门控、批量 Map-Reduce 和 LLM 裁判。每一次点击都是对真实模型的调用。"
      />
      <div className="scn-grid stagger">
        {SCENARIOS.map((s, i) => (
          <Link key={s.id} to={`/scenarios/${s.id}`} className="scn-card card interactive" style={{ ["--h1" as string]: s.hue[0], ["--h2" as string]: s.hue[1] }}>
            <div className="scn-glow" />
            <div className="scn-top">
              <span className="scn-icon">{SCENARIO_ICONS[s.icon]}</span>
              <span className="scn-num mono">{String(i + 1).padStart(2, "0")}</span>
            </div>
            <h3 className="scn-title">{s.title}</h3>
            <p className="scn-tagline">{s.tagline}</p>
            <p className="scn-desc">{s.desc}</p>
            <div className="scn-foot">
              <span className="scn-pattern">{s.pattern}</span>
              <ArrowUpRight className="scn-arrow" />
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
