import { lazy, Suspense } from "react";
import { Layout } from "./components/Layout";
import { Spinner } from "./components/ui";
import { AppProvider } from "./hooks/useApp";
import { match, usePath } from "./router";

const Overview = lazy(() => import("./pages/Overview"));
const Playground = lazy(() => import("./pages/Playground"));
const Scenarios = lazy(() => import("./pages/Scenarios"));
const ScenarioPage = lazy(() => import("./pages/ScenarioPage"));
const Lab = lazy(() => import("./pages/Lab"));
const Eval = lazy(() => import("./pages/Eval"));
const SuitePage = lazy(() => import("./pages/SuitePage"));
const RunPage = lazy(() => import("./pages/RunPage"));
const Bench = lazy(() => import("./pages/Bench"));
const HistoryPage = lazy(() => import("./pages/HistoryPage"));
const Docs = lazy(() => import("./pages/Docs"));
const NotFound = lazy(() => import("./pages/NotFound"));

function Routes() {
  const path = usePath();
  let params: Record<string, string> | null;
  if (path === "/") return <Overview />;
  if (path === "/playground") return <Playground />;
  if (path === "/scenarios") return <Scenarios />;
  if ((params = match("/scenarios/:id", path))) return <ScenarioPage key={params.id} id={params.id} />;
  if (path === "/lab") return <Lab />;
  if (path === "/eval") return <Eval />;
  if ((params = match("/eval/suites/:id", path))) return <SuitePage key={params.id} id={Number(params.id)} />;
  if ((params = match("/eval/runs/:id", path))) return <RunPage key={params.id} id={Number(params.id)} />;
  if (path === "/bench") return <Bench />;
  if (path === "/history") return <HistoryPage />;
  if (path === "/docs") return <Docs />;
  return <NotFound />;
}

export default function App() {
  return (
    <AppProvider>
      <Layout>
        <Suspense
          fallback={
            <div className="row" style={{ justifyContent: "center", padding: 80 }}>
              <Spinner />
            </div>
          }
        >
          <Routes />
        </Suspense>
      </Layout>
    </AppProvider>
  );
}
