// Decorative bottom-right card-tile animation indicating "this card is
// actively trading" — driven by the server-computed isLiquid flag
// (5+ distinct sales of the same grade in the last 30 days; see
// backend/functions/cards/get-cards.js for the rule).
//
// Visual: SVG-only "leaky faucet" surface ripple. Drops fall from the
// top of a 110×110 region and ripple outward on impact. Two parallel
// drop+rings sets offset by half a cycle, so a new drop arrives every
// ~1.25s and Set B's drop is mid-fall while Set A's rings are still
// expanding — overlapping ripples on the same impact point.
//
// All animation is native SMIL inside the SVG: no React state, no
// useEffect, no CSS keyframes. pointer-events:none so clicks pass
// through to the underlying tile. aria-hidden because the animation
// is purely decorative.
//
// Caller is responsible for the parent container's position:relative
// (matches the rest of the app's badge-positioning convention — see
// imageWrap in PortfolioPage). Default placement is bottom-right with
// 14px inset; override via the optional `style` prop for non-tile
// contexts that want different sizing/positioning.
export default function LiquidityRipple({ style }) {
  return (
    <div style={{ ...defaultStyle, ...(style ?? {}) }} aria-hidden="true">
      <svg viewBox="0 0 110 110" xmlns="http://www.w3.org/2000/svg"
           width="110" height="110" preserveAspectRatio="none">

        {/* ─── Set A: drop + 3 rings, begin=0s (implicit) ─── */}
        {/* Falling drop — fades in at top, falls to surface (cy=80),
            then disappears while Set A's rings expand. */}
        <circle cx="55" cy="10" r="3" fill="#a5f3fc" opacity="0">
          <animate attributeName="cy" dur="2.5s"
                   values="10;80;80;10"
                   keyTimes="0;0.27;0.95;1"
                   repeatCount="indefinite" />
          <animate attributeName="opacity" dur="2.5s"
                   values="0;0.85;0.85;0;0"
                   keyTimes="0;0.05;0.26;0.27;1"
                   repeatCount="indefinite" />
        </circle>

        {/* Ring 1 — largest (max r=30), brightest (#06b6d4 cyan, 0.7
            opacity), first to expand at t=0.28. */}
        <circle cx="55" cy="80" r="0" fill="none"
                stroke="#06b6d4" strokeWidth="1.5">
          <animate attributeName="r" dur="2.5s"
                   values="0;0;30;0"
                   keyTimes="0;0.28;0.70;1"
                   repeatCount="indefinite" />
          <animate attributeName="opacity" dur="2.5s"
                   values="0;0;0.7;0;0"
                   keyTimes="0;0.27;0.30;0.70;1"
                   repeatCount="indefinite" />
        </circle>

        {/* Ring 2 — medium (max r=26), blue (#60a5fa, 0.55 opacity),
            slight delay (t=0.34) for the layered-wave look. */}
        <circle cx="55" cy="80" r="0" fill="none"
                stroke="#60a5fa" strokeWidth="1.2">
          <animate attributeName="r" dur="2.5s"
                   values="0;0;26;0"
                   keyTimes="0;0.34;0.74;1"
                   repeatCount="indefinite" />
          <animate attributeName="opacity" dur="2.5s"
                   values="0;0;0.55;0;0"
                   keyTimes="0;0.33;0.36;0.74;1"
                   repeatCount="indefinite" />
        </circle>

        {/* Ring 3 — smallest (max r=22), faintest (#06b6d4, 0.4 opacity),
            latest (t=0.40) — fades into the wake of the first two. */}
        <circle cx="55" cy="80" r="0" fill="none"
                stroke="#06b6d4" strokeWidth="1">
          <animate attributeName="r" dur="2.5s"
                   values="0;0;22;0"
                   keyTimes="0;0.40;0.78;1"
                   repeatCount="indefinite" />
          <animate attributeName="opacity" dur="2.5s"
                   values="0;0;0.4;0;0"
                   keyTimes="0;0.39;0.42;0.78;1"
                   repeatCount="indefinite" />
        </circle>

        {/* ─── Set B: same shapes/timing, begin offset 1.25s ─── */}
        {/* The half-cycle offset is the leaky-faucet effect: Set B's drop
            starts falling while Set A's rings are still expanding, so a
            new drop arrives every ~1.25s instead of every 2.5s. Same
            impact point (cx=55) so ripples overlap on the same spot. */}

        <circle cx="55" cy="10" r="3" fill="#a5f3fc" opacity="0">
          <animate attributeName="cy" dur="2.5s" begin="1.25s"
                   values="10;80;80;10"
                   keyTimes="0;0.27;0.95;1"
                   repeatCount="indefinite" />
          <animate attributeName="opacity" dur="2.5s" begin="1.25s"
                   values="0;0.85;0.85;0;0"
                   keyTimes="0;0.05;0.26;0.27;1"
                   repeatCount="indefinite" />
        </circle>

        <circle cx="55" cy="80" r="0" fill="none"
                stroke="#06b6d4" strokeWidth="1.5">
          <animate attributeName="r" dur="2.5s" begin="1.25s"
                   values="0;0;30;0"
                   keyTimes="0;0.28;0.70;1"
                   repeatCount="indefinite" />
          <animate attributeName="opacity" dur="2.5s" begin="1.25s"
                   values="0;0;0.7;0;0"
                   keyTimes="0;0.27;0.30;0.70;1"
                   repeatCount="indefinite" />
        </circle>

        <circle cx="55" cy="80" r="0" fill="none"
                stroke="#60a5fa" strokeWidth="1.2">
          <animate attributeName="r" dur="2.5s" begin="1.25s"
                   values="0;0;26;0"
                   keyTimes="0;0.34;0.74;1"
                   repeatCount="indefinite" />
          <animate attributeName="opacity" dur="2.5s" begin="1.25s"
                   values="0;0;0.55;0;0"
                   keyTimes="0;0.33;0.36;0.74;1"
                   repeatCount="indefinite" />
        </circle>

        <circle cx="55" cy="80" r="0" fill="none"
                stroke="#06b6d4" strokeWidth="1">
          <animate attributeName="r" dur="2.5s" begin="1.25s"
                   values="0;0;22;0"
                   keyTimes="0;0.40;0.78;1"
                   repeatCount="indefinite" />
          <animate attributeName="opacity" dur="2.5s" begin="1.25s"
                   values="0;0;0.4;0;0"
                   keyTimes="0;0.39;0.42;0.78;1"
                   repeatCount="indefinite" />
        </circle>
      </svg>
    </div>
  );
}

const defaultStyle = {
  position: "absolute",
  bottom: 14,
  right: 14,
  width: 110,
  height: 110,
  pointerEvents: "none",
  // z-index 2 sits above the image but below the bottom imageGradient
  // (which is rendered AFTER this in JSX order, so its painter-default
  // z is higher). Lets the gradient softly tint the bottom of the
  // ripple — matches the mockup's visual treatment.
  zIndex: 2,
  overflow: "hidden",
};
