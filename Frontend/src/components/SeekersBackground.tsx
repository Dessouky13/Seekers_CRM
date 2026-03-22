/**
 * SeekersBackground — Animated symbol backdrop
 * Fixed layer, pointer-events-none, sits behind all content.
 * White Seekers symbol floats at very low opacity against the dark indigo theme.
 */

interface SymbolConfig {
  size: number;
  top: string;
  left: string;
  opacity: number;
  animation: string;
  duration: string;
  delay: string;
  rotate: number;
  blur?: number;
}

const SYMBOLS: SymbolConfig[] = [
  // Large ghost — top right
  { size: 320, top: "-6%",  left: "72%",  opacity: 0.035, animation: "seekers-drift-1", duration: "38s", delay: "0s",    rotate: 15,  blur: 0 },
  // Medium — bottom left
  { size: 240, top: "60%",  left: "-4%",  opacity: 0.04,  animation: "seekers-drift-2", duration: "44s", delay: "6s",    rotate: -20 },
  // Small sharp — center right
  { size: 120, top: "30%",  left: "80%",  opacity: 0.055, animation: "seekers-drift-3", duration: "28s", delay: "3s",    rotate: 30 },
  // Tiny accent — top left
  { size: 80,  top: "8%",   left: "8%",   opacity: 0.06,  animation: "seekers-drift-1", duration: "22s", delay: "10s",   rotate: -45 },
  // Large soft glow — bottom right
  { size: 400, top: "55%",  left: "62%",  opacity: 0.025, animation: "seekers-drift-2", duration: "52s", delay: "2s",    rotate: 10,  blur: 2 },
  // Medium — center left
  { size: 160, top: "42%",  left: "18%",  opacity: 0.04,  animation: "seekers-drift-3", duration: "34s", delay: "14s",   rotate: 60 },
  // Small — upper center
  { size: 90,  top: "12%",  left: "45%",  opacity: 0.05,  animation: "seekers-drift-1", duration: "26s", delay: "8s",    rotate: -30 },
  // XL background ghost — dead center
  { size: 520, top: "20%",  left: "28%",  opacity: 0.018, animation: "seekers-drift-2", duration: "60s", delay: "0s",    rotate: 5,   blur: 4 },
];

// Purple glow orbs that pulse behind the symbols
const GLOWS = [
  { size: 600, top: "10%",  left: "60%",  opacity: 0.06, delay: "0s",  duration: "18s" },
  { size: 500, top: "55%",  left: "5%",   opacity: 0.05, delay: "8s",  duration: "22s" },
  { size: 400, top: "35%",  left: "40%",  opacity: 0.04, delay: "4s",  duration: "26s" },
];

export function SeekersBackground() {
  return (
    <div
      aria-hidden="true"
      className="fixed inset-0 overflow-hidden pointer-events-none"
      style={{ zIndex: 0 }}
    >
      {/* Purple glow orbs */}
      {GLOWS.map((g, i) => (
        <div
          key={`glow-${i}`}
          style={{
            position: "absolute",
            width:  g.size,
            height: g.size,
            top:    g.top,
            left:   g.left,
            borderRadius: "50%",
            background: "radial-gradient(circle, hsl(262 83% 58% / 1) 0%, transparent 70%)",
            opacity: g.opacity,
            filter: "blur(60px)",
            animation: `seekers-glow-pulse ${g.duration} ease-in-out ${g.delay} infinite`,
          }}
        />
      ))}

      {/* Floating symbols */}
      {SYMBOLS.map((s, i) => (
        <img
          key={`symbol-${i}`}
          src="/logo-symbol.png"
          alt=""
          style={{
            position:   "absolute",
            width:      s.size,
            height:     s.size,
            top:        s.top,
            left:       s.left,
            opacity:    s.opacity,
            transform:  `rotate(${s.rotate}deg)`,
            filter:     s.blur ? `blur(${s.blur}px)` : undefined,
            objectFit:  "contain",
            // Combine drift + opacity pulse
            animation: [
              `${s.animation} ${s.duration} ease-in-out ${s.delay} infinite`,
              `seekers-pulse-opacity ${s.duration} ease-in-out ${s.delay} infinite`,
            ].join(", "),
            // CSS custom property for opacity pulse
            ["--s-op" as string]: String(s.opacity),
          }}
        />
      ))}

      {/* Subtle vignette to ground the background */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(ellipse 80% 80% at 50% 50%, transparent 40%, hsl(244 48% 5% / 0.7) 100%)",
          pointerEvents: "none",
        }}
      />
    </div>
  );
}
