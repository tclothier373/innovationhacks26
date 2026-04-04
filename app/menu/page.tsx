"use client";

import Link from "next/link";

export default function Menu() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-transparent p-8">
      <p className="text-sm text-white/85">Menu is not part of the Grubr demo.</p>
      <Link
        href="/swiping"
        className="font-semibold text-white underline decoration-white/50 underline-offset-4 hover:decoration-white"
      >
        Back to swiping
      </Link>
    </div>
  );
}
