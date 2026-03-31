export default function Logo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 220 68"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <defs>
        {/* Heavy bloom — shared by flame and letters */}
        <filter id="lg-bloom" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="4" result="blur"/>
          <feMerge>
            <feMergeNode in="blur"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>

        {/* Crisp inner glow */}
        <filter id="lg-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="1.8" result="blur"/>
          <feMerge>
            <feMergeNode in="blur"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>

        {/* Wide atmospheric haze */}
        <filter id="lg-haze" x="-40%" y="-60%" width="180%" height="220%">
          <feGaussianBlur stdDeviation="11"/>
        </filter>

        {/* Flame body: white core → sky → ocean */}
        <radialGradient id="lg-fire" cx="40%" cy="52%" r="55%">
          <stop offset="0%"   stopColor="#ffffff"/>
          <stop offset="20%"  stopColor="#e0f2fe"/>
          <stop offset="52%"  stopColor="#38bdf8"/>
          <stop offset="86%"  stopColor="#0369a1"/>
          <stop offset="100%" stopColor="#0b2340"/>
        </radialGradient>

        {/* Letters: same palette, top-to-bottom */}
        <linearGradient id="lg-letters" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%"   stopColor="#e0f2fe"/>
          <stop offset="35%"  stopColor="#7dd3fc"/>
          <stop offset="75%"  stopColor="#0ea5e9"/>
          <stop offset="100%" stopColor="#0369a1"/>
        </linearGradient>

        {/* Atmospheric pool: fans right from the flame */}
        <radialGradient id="lg-atm" cx="18%" cy="50%" r="70%">
          <stop offset="0%"   stopColor="#38bdf8" stopOpacity="0.45"/>
          <stop offset="55%"  stopColor="#0ea5e9" stopOpacity="0.12"/>
          <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0"/>
        </radialGradient>

        {/* Background */}
        <radialGradient id="lg-bg" cx="20%" cy="50%" r="75%">
          <stop offset="0%"   stopColor="#0c1e36"/>
          <stop offset="100%" stopColor="#050b16"/>
        </radialGradient>
      </defs>

      {/* ── Canvas ── */}
      <rect width="220" height="68" rx="14" fill="url(#lg-bg)"/>

      {/* Atmospheric pool linking flame → letters */}
      <ellipse cx="110" cy="34" rx="115" ry="32" fill="url(#lg-atm)" filter="url(#lg-haze)"/>

      {/* ─────────── Flame (left, free-floating) ─────────── */}
      <g transform="translate(8, 2)">
        {/* Left tendril */}
        <path
          d="M22 24 C17 17 15 9 19 4 C19 11 21 16 23.5 21 C21 17 19 10 22.5 6 C23 13 23 19 22 24Z"
          fill="#7dd3fc" opacity="0.8" filter="url(#lg-glow)"
        />
        {/* Right tendril */}
        <path
          d="M38 24 C43 17 45 9 41 4 C41 11 39 16 36.5 21 C39 17 41 10 37.5 6 C37 13 37 19 38 24Z"
          fill="#7dd3fc" opacity="0.8" filter="url(#lg-glow)"
        />
        {/* Body */}
        <path
          d="M30 7 C32.2 10 38.5 18 39.8 27.5 C41 36.5 38.5 44 33.8 47.8 C32 49 30 52 30 54.5 C30 52 28 49 26.2 47.8 C21.5 44 19 36.5 20.2 27.5 C21.5 18 27.8 10 30 7Z"
          fill="url(#lg-fire)" filter="url(#lg-glow)"
        />
        {/* Core */}
        <ellipse cx="29.5" cy="32.5" rx="8.5" ry="9.2"  fill="white" opacity="0.5"/>
        <ellipse cx="29.5" cy="31"   rx="5"   ry="5.6"  fill="white" opacity="0.88"/>
        <ellipse cx="29"   cy="29.5" rx="2.7" ry="3"    fill="white"/>
        {/* Tip sparkle */}
        <circle  cx="30"   cy="8.2"  r="1"   fill="#bae6fd" opacity="0.95" filter="url(#lg-glow)"/>
      </g>

      {/* ─────────── "wisp" — ethereal gradient letters ─────────── */}
      {/*
        fontSize=47, baseline y=52, letterSpacing=-1
        Approximate glyph geometry (Space Grotesk 700):
          w : x≈62–100   3 peaks at x≈68, 81, 94   top y≈19
          i : x≈100–111  dot center ≈ (105, 12)
          s : x≈111–136
          p : x≈136–164
      */}
      <text
        x="62"
        y="52"
        fontSize="47"
        fontWeight="700"
        fontFamily="'Space Grotesk', system-ui, sans-serif"
        letterSpacing="-1"
        fill="url(#lg-letters)"
        filter="url(#lg-bloom)"
      >
        wisp
      </text>

      {/* Wisps off the three "w" peaks */}
      <path
        d="M68 19 C67 15 65.5 11 67.5 7.5 C67.8 11 68.2 14 69 18 C67.5 13.5 67 10 68.5 7 C69 11 69 16 68 19Z"
        fill="#7dd3fc" opacity="0.65" filter="url(#lg-glow)"
      />
      <path
        d="M81 17 C80 12.5 78 8 80.5 4 C80.8 8.5 81.5 12 82.5 16 C80.5 11 79.5 7 81.5 3.5 C82.5 8 82.5 13.5 81 17Z"
        fill="#bae6fd" opacity="0.75" filter="url(#lg-bloom)"
      />
      <path
        d="M94 19 C93 15 91.5 11 93.5 7.5 C93.8 11 94.2 14 95 18 C93.5 13.5 93 10 94.5 7 C95 11 95 16 94 19Z"
        fill="#7dd3fc" opacity="0.65" filter="url(#lg-glow)"
      />

      {/* Sparkle dot on the "i" (replaces typographic dot) */}
      <circle cx="105" cy="12" r="2.6" fill="white" opacity="0.9" filter="url(#lg-bloom)"/>
      <circle cx="105" cy="12" r="1.3" fill="white"/>
    </svg>
  )
}
