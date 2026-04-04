"use client";

import Link from "next/link";

export default function LoadingRoutePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-grubr-cream p-8">
      <p className="text-sm text-grubr-muted">This route is unused in Grubr.</p>
      <Link
        href="/"
        className="font-semibold text-grubr-orange hover:underline"
      >
        Go home
      </Link>
    </div>
  );
}
