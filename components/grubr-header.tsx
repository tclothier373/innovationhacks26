"use client";
import Link from "next/link";
import { motion } from "framer-motion";

export function GrubrHeader() {
  return (
    <motion.header
      initial={{ y: -8, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="sticky top-0 z-50 border-b border-white/15 bg-white/10 backdrop-blur-xl"
      style={{ WebkitBackdropFilter: "blur(20px)" }}
    >
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <Link href="/" className="flex items-baseline gap-2 group">
          <span
            className="text-[1.35rem] font-extrabold tracking-[-0.03em] text-white transition-opacity group-hover:opacity-80"
            style={{ fontFamily: "var(--font-syne)" }}
          >
            Grubr
          </span>
          <span className="hidden text-[11px] font-semibold tracking-widest text-white/50 uppercase sm:inline">
            Swipe&nbsp;·&nbsp;Taste&nbsp;·&nbsp;Go
          </span>
        </Link>

        <div className="flex items-center gap-2">
          <Link
            href="/swiping"
            className="rounded-full border border-white/20 bg-white/10 px-3.5 py-1.5 text-[12px] font-semibold text-white/90 backdrop-blur-sm transition-all hover:bg-white/18 hover:text-white"
          >
            Discover
          </Link>
        </div>
      </div>
    </motion.header>
  );
}
