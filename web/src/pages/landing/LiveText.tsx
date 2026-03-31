/** Green "live" text with pulsing dot — used across landing page headings. */
export function LiveText({ children = "live" }: { children?: string }) {
  return (
    <span className="text-emerald-400 inline-flex items-baseline gap-0">
      <span className="relative flex h-[0.3em] w-[0.3em] self-center mr-[0.08em]">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-full w-full bg-emerald-400" />
      </span>
      {children}
    </span>
  );
}
