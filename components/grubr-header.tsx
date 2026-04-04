import Link from "next/link";

export function GrubrHeader() {
  return (
    <header className="border-b border-white/25 bg-white/95 shadow-sm backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <Link href="/" className="flex items-baseline gap-1.5">
          <span className="text-xl font-extrabold tracking-tight text-grubr-orange">
            Grubr
          </span>
          <span className="hidden text-xs font-medium text-grubr-muted-ink sm:inline">
            Swipe. Taste. Go.
          </span>
        </Link>
      </div>
    </header>
  );
}
