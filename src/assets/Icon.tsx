export default function Icon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <defs>
        <filter id="wisp-bloom" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="7" result="blur"/>
          <feMerge>
            <feMergeNode in="blur"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>
        <filter id="wisp-glow" x="-25%" y="-25%" width="150%" height="150%">
          <feGaussianBlur stdDeviation="2.5" result="blur"/>
          <feMerge>
            <feMergeNode in="blur"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>
        <radialGradient id="wisp-body" cx="42%" cy="54%" r="54%">
          <stop offset="0%"   stopColor="#ffffff"/>
          <stop offset="22%"  stopColor="#e0f2fe"/>
          <stop offset="52%"  stopColor="#38bdf8"/>
          <stop offset="85%"  stopColor="#0369a1"/>
          <stop offset="100%" stopColor="#0c2a4a"/>
        </radialGradient>
        <radialGradient id="wisp-halo" cx="50%" cy="52%" r="50%">
          <stop offset="0%"   stopColor="#7dd3fc" stopOpacity="0.55"/>
          <stop offset="60%"  stopColor="#0ea5e9" stopOpacity="0.15"/>
          <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0"/>
        </radialGradient>
        <radialGradient id="wisp-bg" cx="50%" cy="45%" r="62%">
          <stop offset="0%"   stopColor="#0d1f38"/>
          <stop offset="100%" stopColor="#060b14"/>
        </radialGradient>
      </defs>

      <rect width="100" height="100" rx="20" fill="url(#wisp-bg)"/>

      <ellipse cx="50" cy="55" rx="34" ry="31" fill="url(#wisp-halo)" filter="url(#wisp-bloom)"/>

      {/* Left curl tendril */}
      <path
        d="M38 34 C32 27 29 18 34 11 C34 19 36 25 39 31 C36 26 34 19 38 13 C39 22 39 29 38 34Z"
        fill="#7dd3fc" opacity="0.75" filter="url(#wisp-glow)"
      />
      {/* Right curl tendril */}
      <path
        d="M62 34 C68 27 71 18 66 11 C66 19 64 25 61 31 C64 26 66 19 62 13 C61 22 61 29 62 34Z"
        fill="#7dd3fc" opacity="0.75" filter="url(#wisp-glow)"
      />

      {/* Main body: flame teardrop */}
      <path
        d="M50 16 C53 20, 62 30, 64 44 C66 57, 62 68, 55 74 C52 76, 50 80, 50 84
           C50 80, 48 76, 45 74 C38 68, 34 57, 36 44 C38 30, 47 20, 50 16 Z"
        fill="url(#wisp-body)" filter="url(#wisp-glow)"
      />

      {/* Inner core layers */}
      <ellipse cx="49" cy="53" rx="13" ry="14" fill="white" opacity="0.55"/>
      <ellipse cx="49" cy="51" rx="7.5" ry="8.5" fill="white" opacity="0.9"/>
      <ellipse cx="48" cy="49" rx="4"   ry="4.5" fill="white"/>

      {/* Tip sparkle */}
      <circle cx="50" cy="18" r="1.4" fill="#bae6fd" opacity="0.9" filter="url(#wisp-glow)"/>
    </svg>
  )
}
