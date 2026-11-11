import midnightSky from "@/assets/midnight-sky.webp";

const PATHS = [
  "M-50 760 C 300 620, 700 560, 1000 420 S 1560 160, 1980 120",
  "M120 1080 C 380 760, 900 700, 1300 520 S 1800 260, 1700 120 S 1200 320, 900 360",
  "M-80 520 C 400 480, 900 300, 1400 180 S 1900 80, 2000 60",
  "M600 1100 C 700 900, 1100 820, 1500 760 S 1950 700, 2000 640",
];

export function MidnightBackdrop({ variant = "hero" }: { variant?: "hero" | "quiet" }) {
  return (
    <div className="midnight-backdrop" data-variant={variant} aria-hidden="true">
      <img
        className="midnight-backdrop-photo"
        src={midnightSky}
        alt=""
        width={1920}
        height={1088}
        fetchPriority="low"
        decoding="async"
      />
      <svg className="flight-paths" viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice">
        {PATHS.map((d, i) => (
          <path
            key={i}
            d={d}
            className={`flight-path${i > 1 ? " faint" : ""}`}
            strokeWidth={i > 1 ? 1 : 1.6}
          />
        ))}
        <path d={PATHS[0]} className="flight-glow" strokeWidth={2.4} />
        <path d={PATHS[1]} className="flight-glow slow" strokeWidth={2} />
        <path d={PATHS[2]} className="flight-glow slower" strokeWidth={1.6} />
      </svg>
    </div>
  );
}
