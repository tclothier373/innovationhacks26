"use client";

import { useMemo } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { useIsClient } from "@/lib/use-is-client";

export default function OrderConfirmedPage() {
  const isClient = useIsClient();

  const data = useMemo(() => {
    if (!isClient) return { mode: "delivery", time: "—" };
    const params = new URLSearchParams(window.location.search);
    return {
      mode: params.get("mode") === "pickup" ? "pickup" : "delivery",
      time: params.get("time") || "—",
    };
  }, [isClient]);

  const modeLabel = data.mode === "pickup" ? "ready for pickup" : "delivered";

  return (
    <div
      className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-6 text-center"
      style={{
        background: "radial-gradient(ellipse 100% 80% at 50% 0%, #FF8020 0%, #FF4800 45%, #CC2800 100%)",
      }}
    >
      {/* Ambient orbs */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-20 -left-20 h-80 w-80 rounded-full bg-white/10 blur-3xl animate-orb-a" />
        <div className="absolute -bottom-20 -right-20 h-96 w-96 rounded-full bg-orange-900/30 blur-3xl animate-orb-b" />
        <div className="absolute top-1/2 left-1/2 h-60 w-60 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/5 blur-2xl animate-orb-c" />
      </div>

      <div className="relative z-10 max-w-md">
        {/* Animated checkmark */}
        <motion.div
          className="mx-auto mb-8 flex h-24 w-24 items-center justify-center rounded-full border-4 border-white/30 bg-white/15 backdrop-blur-md"
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 340, damping: 22, delay: 0.1 }}
        >
          <motion.svg
            width="44"
            height="44"
            viewBox="0 0 44 44"
            fill="none"
            className="text-white"
          >
            <motion.path
              d="M8 22L18 32L36 12"
              stroke="currentColor"
              strokeWidth="4"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray="48"
              strokeDashoffset="48"
              animate={{ strokeDashoffset: 0 }}
              transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1], delay: 0.32 }}
            />
          </motion.svg>
        </motion.div>

        {/* Thank you */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.28, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        >
          <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-white/55 mb-2">
            Order confirmed
          </p>
          <h1
            className="text-5xl font-extrabold leading-tight tracking-tight text-white sm:text-6xl"
            style={{ fontFamily: "var(--font-syne)" }}
          >
            Thank you!
          </h1>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.44, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          className="mt-6"
        >
          <p className="text-lg font-semibold text-white/90 leading-relaxed">
            Your order will be{" "}
            <span className="font-extrabold text-white">{modeLabel}</span> at
          </p>
          <div className="mt-3 inline-block rounded-2xl border border-white/25 bg-white/12 px-6 py-3 backdrop-blur-md">
            <p
              className="text-4xl font-extrabold tracking-tight text-white"
              style={{ fontFamily: "var(--font-syne)" }}
            >
              {data.time}
            </p>
          </div>
        </motion.div>

        {/* Mode badge */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.60 }}
          className="mt-5"
        >
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3.5 py-1.5 text-xs font-semibold text-white/85 backdrop-blur-md">
            <span>{data.mode === "pickup" ? "🏠" : "🚗"}</span>
            {data.mode === "pickup" ? "Pickup" : "Delivery"} confirmed
          </span>
        </motion.div>

        {/* CTA */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.72, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className="mt-10"
        >
          <Link
            href="/"
            className="inline-block rounded-2xl bg-white px-8 py-3.5 text-sm font-extrabold text-brand shadow-xl shadow-black/20 transition-all hover:bg-s2 active:scale-[0.97]"
            style={{ fontFamily: "var(--font-syne)" }}
          >
            Return to Grubr
          </Link>
        </motion.div>
      </div>
    </div>
  );
}
