import { Suspense } from "react";
import { AgentTransitionClient } from "./agent-transition-client";

function Fallback() {
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-gradient-to-br from-[#FF6820] via-[#FF4200] to-[#C82C00]">
      <div className="h-10 w-10 animate-spin-ring rounded-full border-[3px] border-white/25 border-t-white" />
    </div>
  );
}

export default function AgentTransitionPage() {
  return (
    <Suspense fallback={<Fallback />}>
      <AgentTransitionClient />
    </Suspense>
  );
}
