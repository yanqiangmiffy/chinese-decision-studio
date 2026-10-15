import { Compass } from "lucide-react";
import { Button, Empty } from "../components/ui";
import { navigate, useTitle } from "../router";

export default function NotFound() {
  useTitle("页面不存在");
  return (
    <div className="page">
      <Empty icon={<Compass />} title="这个页面不存在" action={<Button onClick={() => navigate("/")}>回到总览</Button>}>
        链接可能已经过期，或者地址拼错了。
      </Empty>
    </div>
  );
}
