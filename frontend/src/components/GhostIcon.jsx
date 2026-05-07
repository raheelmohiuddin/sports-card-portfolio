import { useId } from "react";

// Premium ghost icon — pearl-white body with a subtle silver gradient and
// outline, two ink-dot eyes, and a gentle float+sway animation. Designed to
// feel collectible-luxury, not Halloween-cartoon.
//
// Sizes: 32 × 36 on grid tiles, 16 × 18 in list rows, 48 × 54 in the modal.
export default function GhostIcon({ size = 32, animated = true }) {
  const reactId = useId();
  // useId emits values containing ":" which aren't safe in CSS url(#id) refs.
  const gradId = `ghost-${reactId.replace(/:/g, "")}`;

  const w = size;
  const h = (size * 36) / 32;

  return (
    <svg
      viewBox="0 0 32 36"
      width={w}
      height={h}
      style={{
        display: "block",
        animation: animated ? "ghostAlive 4.2s ease-in-out infinite" : "none",
        // Soft outer glow gives the icon presence on any background without
        // resorting to a backdrop pill — keeps it premium and clean.
        filter:
          "drop-shadow(0 0 6px rgba(255,255,255,0.45)) drop-shadow(0 0 2px rgba(255,255,255,0.7))",
        overflow: "visible",
      }}
      aria-label="Ghost rarity"
      role="img"
    >
      <defs>
        <radialGradient id={gradId} cx="48%" cy="32%" r="68%">
          <stop offset="0%"   stopColor="#ffffff" />
          <stop offset="55%"  stopColor="#f1f5f9" />
          <stop offset="100%" stopColor="#cbd5e1" />
        </radialGradient>
      </defs>

      {/* Body: rounded dome top, straight sides, four-bump wavy bottom */}
      <path
        d="M 4 14
           C 4 7 9 2 16 2
           C 23 2 28 7 28 14
           L 28 28
           Q 25 35.5 22 28
           Q 19 35.5 16 28
           Q 13 35.5 10 28
           Q 7  35.5 4  28
           Z"
        fill={`url(#${gradId})`}
        stroke="rgba(148,163,184,0.75)"
        strokeWidth="0.6"
        strokeLinejoin="round"
      />

      {/* Eyes — slightly tall ovals for a softer, less cartoonish look */}
      <ellipse cx="12.5" cy="13" rx="1.35" ry="1.95" fill="#1e293b" />
      <ellipse cx="19.5" cy="13" rx="1.35" ry="1.95" fill="#1e293b" />
    </svg>
  );
}
