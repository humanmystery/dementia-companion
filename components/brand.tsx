export const BRAND = "Forget Me Not";
export const TAGLINE = "Remembering, together.";

export const PETALS: [number, number][] = [
  [50, 29],
  [69.97, 43.51],
  [62.34, 66.99],
  [37.66, 66.99],
  [30.03, 43.51],
];

export function Flower({
  className = "h-8 w-8",
  petal = "var(--petal)",
  ring = "#fffaf0",
  centre = "var(--bloom)",
}: {
  className?: string;
  petal?: string;
  ring?: string;
  centre?: string;
}) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true">
      {PETALS.map(([cx, cy]) => (
        <circle key={cx} cx={cx} cy={cy} r="15" fill={petal} />
      ))}
      <circle cx="50" cy="50" r="10" fill={ring} />
      <circle cx="50" cy="50" r="6" fill={centre} />
    </svg>
  );
}

export function Wordmark({ className = "", size = "text-2xl" }: { className?: string; size?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-display font-semibold tracking-tight ${size} ${className}`}>
      <Flower className="h-[1.3em] w-[1.3em]" />
      {BRAND}
    </span>
  );
}
