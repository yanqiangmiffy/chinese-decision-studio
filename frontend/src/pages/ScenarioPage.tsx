import { ArrowLeft, Lightbulb } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { Spinner } from "../components/ui";
import { SCENARIOS } from "../lib/scenarios";
import { Link, useTitle } from "../router";
import NotFound from "./NotFound";
import { SCENARIO_ICONS } from "./Scenarios";

const VIEWS: Record<string, ReturnType<typeof lazy>> = {
  triage: lazy(() => import("./scenarios/TicketTriage")),
  danmaku: lazy(() => import("./scenarios/DanmakuGuard")),
  resume: lazy(() => import("./scenarios/ResumeRanking")),
  guardrail: lazy(() => import("./scenarios/Guardrail")),
  rag: lazy(() => import("./scenarios/RagRerank")),
  agent: lazy(() => import("./scenarios/AgentRouter")),
  reviews: lazy(() => import("./scenarios/ReviewInsights")),
  judge: lazy(() => import("./scenarios/LLMJudge")),
  intents: lazy(() => import("./scenarios/IntentTournament")),
  extraction: lazy(() => import("./scenarios/ExtractionGallery")),
  events: lazy(() => import("./scenarios/EventPipeline")),
  triples: lazy(() => import("./scenarios/TripleGraph")),
};

export default function ScenarioPage({ id }: { id: string }) {
  const meta = SCENARIOS.find((s) => s.id === id);
  useTitle(meta?.title ?? "场景");
  const [showIdea, setShowIdea] = useState(false);
  if (!meta || !VIEWS[id]) return <NotFound />;
  const View = VIEWS[id];
  return (
    <div className="page" style={{ ["--h1" as string]: meta.hue[0], ["--h2" as string]: meta.hue[1] }}>
      <div className="scn-head">
        <Link to="/scenarios" className="btn ghost sm">
          <ArrowLeft /> 场景库
        </Link>
        <div className="scn-head-main">
          <span className="scn-icon lg">{SCENARIO_ICONS[meta.icon]}</span>
          <div className="grow">
            <div className="row" style={{ gap: 10 }}>
              <h1 className="page-title">{meta.title}</h1>
              <span className="scn-pattern">{meta.pattern}</span>
            </div>
            <p className="page-desc">{meta.tagline}</p>
          </div>
          <button className={`chip ${showIdea ? "on" : ""}`} onClick={() => setShowIdea(!showIdea)}>
            <Lightbulb /> 设计思路
          </button>
        </div>
        {showIdea && <div className="scn-idea">{meta.desc}</div>}
      </div>
      <Suspense
        fallback={
          <div className="row" style={{ justifyContent: "center", padding: 60 }}>
            <Spinner />
          </div>
        }
      >
        <View />
      </Suspense>
    </div>
  );
}
