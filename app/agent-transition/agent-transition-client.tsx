"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  AGENT_PHASES,
  resolveAgentPhase,
  safeInternalPath,
} from "@/lib/agent-transition";

const STEP_MS = 520;
const DONE_HOLD_MS = 780;

export function AgentTransitionClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextRaw = searchParams.get("next");
  const phaseKey = resolveAgentPhase(searchParams.get("phase"));
  const safeNext = useMemo(() => safeInternalPath(nextRaw), [nextRaw]);

  const phase = AGENT_PHASES[phaseKey];
  const steps = phase.steps;

  const [completedCount, setCompletedCount] = useState(0);

  useEffect(() => {
    const timeouts: Array<ReturnType<typeof globalThis.setTimeout>> = [];
    const clearAll = () => timeouts.forEach((id) => globalThis.clearTimeout(id));

    if (steps.length === 0) {
      timeouts.push(globalThis.setTimeout(() => router.replace(safeNext), 400));
      return clearAll;
    }

    let n = 0;
    const tick = () => {
      n += 1;
      setCompletedCount(n);
      if (n >= steps.length) {
        timeouts.push(globalThis.setTimeout(() => router.replace(safeNext), DONE_HOLD_MS));
        return;
      }
      timeouts.push(globalThis.setTimeout(tick, STEP_MS));
    };

    timeouts.push(globalThis.setTimeout(tick, STEP_MS));
    return clearAll;
  }, [router, safeNext, steps.length]);

  return (
    <div className="fixed inset-0 z-[200] flex flex-col items-center justify-center overflow-hidden px-4">
      <div
        className="pointer-events-none absolute inset-0 opacity-90"
        style={{
          background:
            "radial-gradient(ellipse 80% 60% at 50% -10%, rgba(255,255,255,0.18) 0%, transparent 55%), linear-gradient(152deg, #FF6820 0%, #FF4200 45%, #C82C00 100%)",
        }}
      />
      <div className="pointer-events-none absolute -left-24 top-1/4 h-72 w-72 rounded-full bg-white/10 blur-3xl animate-orb-a" />
      <div className="pointer-events-none absolute -right-16 bottom-1/4 h-64 w-64 rounded-full bg-amber-200/15 blur-3xl animate-orb-b" />

      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 380, damping: 32 }}
        className="relative w-full max-w-md rounded-3xl border border-white/20 bg-white/12 px-6 py-8 shadow-2xl shadow-black/25 backdrop-blur-xl"
      >
        <div className="mb-6 flex items-center gap-3">
          <motion.div
            className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-2xl shadow-lg shadow-black/10"
            animate={{ scale: [1, 1.06, 1] }}
            transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
            aria-hidden
          >
            🤖
          </motion.div>
          <div>
            <p
              className="text-lg font-extrabold tracking-tight text-white"
              style={{ fontFamily: "var(--font-syne)" }}
            >
              {phase.headline}
            </p>
            <p className="text-sm text-white/75">{phase.subline}</p>
          </div>
        </div>

        <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.22em] text-white/45">
          Agent checklist
        </p>

        <ul className="space-y-3">
          {steps.map((label, idx) => {
            const done = idx < completedCount;
            const active =
              idx === completedCount && completedCount < steps.length;

            return (
              <motion.li
                key={`${phaseKey}-${idx}`}
                layout
                className="flex items-start gap-3 rounded-2xl border border-white/12 bg-white/8 px-3.5 py-3"
                initial={false}
                animate={{
                  borderColor: done
                    ? "rgba(255,255,255,0.35)"
                    : active
                      ? "rgba(255,255,255,0.28)"
                      : "rgba(255,255,255,0.10)",
                  backgroundColor: done
                    ? "rgba(255,255,255,0.14)"
                    : active
                      ? "rgba(255,255,255,0.10)"
                      : "rgba(255,255,255,0.05)",
                }}
                transition={{ duration: 0.28 }}
              >
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/25 bg-white/10">
                  <AnimatePresence mode="wait">
                    {done ? (
                      <motion.span
                        key="check"
                        initial={{ scale: 0.2, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.5, opacity: 0 }}
                        className="text-sm font-bold text-white"
                      >
                        ✓
                      </motion.span>
                    ) : active ? (
                      <motion.span
                        key="dot"
                        className="h-2 w-2 rounded-full bg-white"
                        animate={{ opacity: [0.35, 1, 0.35] }}
                        transition={{ duration: 1.1, repeat: Infinity }}
                      />
                    ) : (
                      <span key="wait" className="text-[10px] text-white/35">
                        ○
                      </span>
                    )}
                  </AnimatePresence>
                </span>
                <span
                  className={`text-sm font-medium leading-snug ${
                    done ? "text-white" : active ? "text-white/90" : "text-white/45"
                  }`}
                >
                  {label}
                </span>
              </motion.li>
            );
          })}
        </ul>

        <motion.div
          className="mt-6 h-1 overflow-hidden rounded-full bg-white/15"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
        >
          <motion.div
            className="h-full rounded-full bg-white/70"
            initial={{ width: "0%" }}
            animate={{ width: "100%" }}
            transition={{
              duration: Math.max(1.8, (steps.length * STEP_MS + DONE_HOLD_MS) / 1000),
              ease: "linear",
            }}
          />
        </motion.div>
      </motion.div>

      <p className="relative mt-6 max-w-sm text-center text-xs text-white/50">
        Grubr is a demo ordering assistant — not affiliated with Grubhub.
      </p>
    </div>
  );
}
