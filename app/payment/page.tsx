"use client";

import Link from "next/link";

export default function Payment() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-grubr-cream p-8">
      <p className="text-sm text-grubr-muted">Payment is not part of the Grubr demo.</p>
      <Link href="/swiping" className="font-semibold text-grubr-orange hover:underline">
        Back to swiping
      </Link>
    </div>
  );
}
