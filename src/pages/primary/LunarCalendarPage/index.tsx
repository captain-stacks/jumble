import PrimaryPageLayout from '@/layouts/PrimaryPageLayout'
import { TPageRef } from '@/types'
import { ChevronLeft, ChevronRight, MoonIcon } from 'lucide-react'
import { forwardRef, useMemo, useState } from 'react'

// ── Julian Day Number ────────────────────────────────────────────────────────

function gregorianToJDN(year: number, month: number, day: number): number {
  const a = Math.floor((14 - month) / 12)
  const y = year + 4800 - a
  const m = month + 12 * a - 3
  return (
    day +
    Math.floor((153 * m + 2) / 5) +
    365 * y +
    Math.floor(y / 4) -
    Math.floor(y / 100) +
    Math.floor(y / 400) -
    32045
  )
}

function JDNtoGregorian(jdn: number): { year: number; month: number; day: number } {
  const a = jdn + 32044
  const b = Math.floor((4 * a + 3) / 146097)
  const c = a - Math.floor((146097 * b) / 4)
  const d = Math.floor((4 * c + 3) / 1461)
  const e = c - Math.floor((1461 * d) / 4)
  const m = Math.floor((5 * e + 2) / 153)
  return {
    day: e - Math.floor((153 * m + 2) / 5) + 1,
    month: m + 3 - 12 * Math.floor(m / 10),
    year: 100 * b + d - 4800 + Math.floor(m / 10)
  }
}

// ── Moon Phase ───────────────────────────────────────────────────────────────

const SYNODIC = 29.530589
const REF_NEW_MOON_JD = 2451549.7569444

function getMoonAge(jd: number): number {
  return ((jd - REF_NEW_MOON_JD) % SYNODIC + SYNODIC) % SYNODIC
}

function getMoonPhaseName(age: number): string {
  const p = age / SYNODIC
  if (p < 0.0625 || p >= 0.9375) return 'New Moon'
  if (p < 0.1875) return 'Waxing Crescent'
  if (p < 0.3125) return 'First Quarter'
  if (p < 0.4375) return 'Waxing Gibbous'
  if (p < 0.5625) return 'Full Moon'
  if (p < 0.6875) return 'Waning Gibbous'
  if (p < 0.8125) return 'Last Quarter'
  return 'Waning Crescent'
}

function getMoonIllumination(age: number): number {
  return Math.round(((1 - Math.cos((2 * Math.PI * age) / SYNODIC)) / 2) * 100)
}

function getMoonPhaseEmoji(age: number): string {
  const p = age / SYNODIC
  if (p < 0.0625 || p >= 0.9375) return '🌑'
  if (p < 0.1875) return '🌒'
  if (p < 0.3125) return '🌓'
  if (p < 0.4375) return '🌔'
  if (p < 0.5625) return '🌕'
  if (p < 0.6875) return '🌖'
  if (p < 0.8125) return '🌗'
  return '🌘'
}

// ── Moon Phase Event Detection ────────────────────────────────────────────────

function isPhaseDay(jdn: number, threshold: number): boolean {
  const a0 = getMoonAge(jdn - 0.5)
  const a1 = getMoonAge(jdn + 0.5)
  const a1u = a1 < a0 ? a1 + SYNODIC : a1
  let t = threshold
  if (t < a0) t += SYNODIC
  return t >= a0 && t < a1u
}

function getNewMoonOnOrBefore(jdn: number): number {
  for (let d = jdn; d >= jdn - 32; d--) {
    if (isPhaseDay(d, 0)) return d
  }
  return jdn - Math.round(getMoonAge(jdn))
}

function getNewMoonAfter(jdn: number): number {
  for (let d = jdn + 1; d <= jdn + 32; d++) {
    if (isPhaseDay(d, 0)) return d
  }
  return jdn + 29
}

function getFirstFullMoonOnOrAfter(jdn: number): number {
  for (let d = jdn; d <= jdn + 32; d++) {
    if (isPhaseDay(d, SYNODIC / 2)) return d
  }
  return jdn + 15
}

// ── Easter (Astronomical) ─────────────────────────────────────────────────────

function getEasterJDN(year: number): number {
  const T = (year - 2000) / 1000
  const T2 = T * T, T3 = T2 * T, T4 = T3 * T
  const equinoxJDE =
    2451623.80984 + 365242.37404 * T + 0.05169 * T2 - 0.00411 * T3 - 0.00057 * T4
  const equinoxJDN = Math.floor(equinoxJDE + 0.5)
  const paschalFullMoon = getFirstFullMoonOnOrAfter(equinoxJDN)
  // First Sunday on or after paschalFullMoon
  // JDN % 7: 0=Mon … 6=Sun
  const dow = paschalFullMoon % 7
  return paschalFullMoon + (6 - dow + 7) % 7
}

// ── Month Numbering (relative to Easter) ────────────────────────────────────

function getMonthInfo(lunationStartJDN: number): { monthNum: number; easterYear: number } {
  const { year } = JDNtoGregorian(lunationStartJDN + 15)
  const easterThis = getEasterJDN(year)
  const lunationThis = getNewMoonOnOrBefore(easterThis)

  let refLunation = lunationThis
  let refYear = year
  if (lunationStartJDN < lunationThis) {
    const easterPrev = getEasterJDN(year - 1)
    refLunation = getNewMoonOnOrBefore(easterPrev)
    refYear = year - 1
  }

  const monthNum = Math.round((lunationStartJDN - refLunation) / SYNODIC) + 1
  return { monthNum, easterYear: refYear }
}

// ── Solar Events (Solstices & Equinoxes) ─────────────────────────────────────

type TSolarEvent = { name: string; emoji: string }

function getSolarEventsForYear(year: number): Map<number, TSolarEvent> {
  const T = (year - 2000) / 1000
  const T2 = T * T, T3 = T2 * T, T4 = T3 * T
  const raw: [number, string, string][] = [
    [2451623.80984 + 365242.37404 * T + 0.05169 * T2 - 0.00411 * T3 - 0.00057 * T4, 'March Equinox', '🌸'],
    [2451716.56767 + 365241.62603 * T + 0.00325 * T2 + 0.00888 * T3 - 0.00030 * T4, 'June Solstice', '☀️'],
    [2451810.21715 + 365242.01767 * T - 0.11575 * T2 + 0.00337 * T3 + 0.00078 * T4, 'Sept. Equinox', '🍂'],
    [2451900.05952 + 365242.74049 * T - 0.06223 * T2 - 0.00823 * T3 + 0.00032 * T4, 'Dec. Solstice', '❄️'],
  ]
  const map = new Map<number, TSolarEvent>()
  for (const [jde, name, emoji] of raw) {
    map.set(Math.floor(jde + 0.5), { name, emoji })
  }
  return map
}

// ── Major Phase Events ────────────────────────────────────────────────────────

type TPhaseEvent = { emoji: string; shortName: string; fullName: string }

const MAJOR_PHASES: (TPhaseEvent & { threshold: number })[] = [
  { threshold: 0,               emoji: '🌑', shortName: 'New',    fullName: 'New Moon' },
  { threshold: SYNODIC / 4,     emoji: '🌓', shortName: '1st Q',  fullName: 'First Quarter' },
  { threshold: SYNODIC / 2,     emoji: '🌕', shortName: 'Full',   fullName: 'Full Moon' },
  { threshold: 3 * SYNODIC / 4, emoji: '🌗', shortName: 'Last Q', fullName: 'Last Quarter' },
]

function getMajorPhasesInLunarMonth(
  lunationStartJDN: number,
  monthLength: number
): Map<number, TPhaseEvent> {
  const result = new Map<number, TPhaseEvent>()
  for (let d = 0; d < monthLength; d++) {
    for (const ph of MAJOR_PHASES) {
      if (isPhaseDay(lunationStartJDN + d, ph.threshold)) {
        result.set(d, ph)
        break
      }
    }
  }
  return result
}

// ── Moon SVG ─────────────────────────────────────────────────────────────────

function MoonSVG({ age }: { age: number }) {
  const phase = age / SYNODIC
  const r = 78, cx = 100, cy = 100
  const top = `${cx} ${cy - r}`, bot = `${cx} ${cy + r}`
  const isWaxing = phase <= 0.5
  const subPhase = isWaxing ? phase / 0.5 : (phase - 0.5) / 0.5
  const termRx = Math.cos(subPhase * Math.PI) * r
  const absTermRx = Math.max(0.1, Math.abs(termRx))
  const termSweep = termRx < 0 ? 1 : 0
  const outerSweep = isWaxing ? 1 : 0
  const litPath = `M ${top} A ${r} ${r} 0 0 ${outerSweep} ${bot} A ${absTermRx} ${r} 0 0 ${termSweep} ${top} Z`
  const isNew = phase < 0.02 || phase > 0.98
  const stars = [[18,22],[165,18],[30,75],[170,80],[12,140],[180,140],[40,170],[155,165],[85,12],[115,185]]
  return (
    <svg viewBox="0 0 200 200" width="160" height="160" className="drop-shadow-2xl">
      <defs>
        <radialGradient id="moonGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#f5e6a3" stopOpacity="0.15" />
          <stop offset="100%" stopColor="#f5e6a3" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="moonSurface" cx="40%" cy="35%" r="60%">
          <stop offset="0%" stopColor="#fef9e7" />
          <stop offset="100%" stopColor="#d4a843" />
        </radialGradient>
        <clipPath id="moonClip"><circle cx={cx} cy={cy} r={r} /></clipPath>
      </defs>
      {stars.map(([sx, sy], i) => <circle key={i} cx={sx} cy={sy} r={1.2} fill="white" opacity={0.6} />)}
      {phase > 0.4 && phase < 0.6 && <circle cx={cx} cy={cy} r={r + 12} fill="url(#moonGlow)" />}
      <circle cx={cx} cy={cy} r={r} fill="#1a1a2e" />
      {!isNew && <path d={litPath} fill="url(#moonSurface)" clipPath="url(#moonClip)" />}
      {!isNew && (
        <g clipPath="url(#moonClip)" opacity={0.12}>
          <circle cx={115} cy={85} r={8} fill="none" stroke="#8b6914" strokeWidth={1.5} />
          <circle cx={75} cy={115} r={5} fill="none" stroke="#8b6914" strokeWidth={1} />
          <circle cx={125} cy={120} r={4} fill="none" stroke="#8b6914" strokeWidth={1} />
        </g>
      )}
    </svg>
  )
}

// ── Lunar Month Grid ──────────────────────────────────────────────────────────

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const GREG_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function formatGregDate(jdn: number): string {
  const { month, day } = JDNtoGregorian(jdn)
  return `${GREG_MONTHS[month - 1]} ${day}`
}

function LunarMonthGrid({
  lunationStartJDN,
  selectedJDN,
  onDayClick,
  onPrevMonth,
  onNextMonth
}: {
  lunationStartJDN: number
  selectedJDN: number | null
  onDayClick: (jdn: number) => void
  onPrevMonth: () => void
  onNextMonth: () => void
}) {
  const nextNewMoon = useMemo(() => getNewMoonAfter(lunationStartJDN), [lunationStartJDN])
  const monthLength = nextNewMoon - lunationStartJDN

  const { monthNum, easterYear } = useMemo(() => getMonthInfo(lunationStartJDN), [lunationStartJDN])

  const phaseEvents = useMemo(
    () => getMajorPhasesInLunarMonth(lunationStartJDN, monthLength),
    [lunationStartJDN, monthLength]
  )

  const solarEvents = useMemo(() => {
    const { year } = JDNtoGregorian(lunationStartJDN)
    return new Map([...getSolarEventsForYear(year), ...getSolarEventsForYear(year + 1)])
  }, [lunationStartJDN])

  // JDN % 7: 0=Mon … 6=Sun → blanks for Sun-first grid
  const blanksCount = (lunationStartJDN % 7 + 1) % 7

  return (
    <div className="w-full">
      {/* Phase event summary */}
      <div className="mb-3 flex flex-wrap justify-center gap-x-3 gap-y-1">
        {Array.from(phaseEvents.entries()).map(([d, ev]) => (
          <span key={d} className="flex items-center gap-1 text-xs text-muted-foreground">
            <span>{ev.emoji}</span>
            <span>{ev.fullName} — {formatGregDate(lunationStartJDN + d)}</span>
          </span>
        ))}
      </div>

      {/* Navigation */}
      <div className="mb-1 flex items-center justify-between">
        <button onClick={onPrevMonth} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-sm font-semibold">
          Month {monthNum}
          <span className="ml-1.5 text-xs font-normal text-muted-foreground">Easter {easterYear}</span>
        </span>
        <button onClick={onNextMonth} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-7 gap-px">
        {WEEKDAY_LABELS.map((label) => (
          <div key={label} className="py-1 text-center text-xs font-medium text-muted-foreground">
            {label}
          </div>
        ))}
        {Array(blanksCount).fill(null).map((_, i) => <div key={`b-${i}`} />)}
        {Array.from({ length: monthLength }, (_, d) => {
          const jdn = lunationStartJDN + d
          const age = getMoonAge(jdn)
          const phaseEv = phaseEvents.get(d)
          const solarEv = solarEvents.get(jdn)
          const isSelected = jdn === selectedJDN
          return (
            <div
              key={d}
              onClick={() => onDayClick(jdn)}
              className={`relative flex min-h-[3.5rem] cursor-pointer flex-col items-center justify-center rounded-md ${
                isSelected ? 'bg-primary text-primary-foreground' : 'hover:bg-muted/60'
              }`}
            >
              {solarEv && (
                <span className="absolute right-0.5 top-0.5 text-[10px] leading-none" title={solarEv.name}>
                  {solarEv.emoji}
                </span>
              )}
              <span className={`text-[10px] leading-none ${isSelected ? 'opacity-60' : 'text-muted-foreground/60'}`}>
                {d + 1}
              </span>
              <span className="text-lg leading-tight">{getMoonPhaseEmoji(age)}</span>
              {phaseEv && d > 0 && (
                <span className={`text-[9px] leading-none font-medium ${isSelected ? 'opacity-80' : 'text-muted-foreground'}`}>
                  {phaseEv.shortName}
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

interface TDateState { y: number; m: number; d: number }

function getToday(): TDateState {
  const now = new Date()
  return { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() }
}

function parseInput(s: string, defaultYear: number): TDateState | null {
  const t = s.trim()
  if (!t) return null
  const md = t.match(/^(\d{1,2})\/(\d{1,2})$/)
  if (md) {
    const m = +md[1], d = +md[2]
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) return { y: defaultYear, m, d }
  }
  const mdyy = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/)
  if (mdyy) {
    const m = +mdyy[1], d = +mdyy[2], y = 2000 + +mdyy[3]
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) return { y, m, d }
  }
  const mdyyyy = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (mdyyyy) {
    const m = +mdyyyy[1], d = +mdyyyy[2], y = +mdyyyy[3]
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) return { y, m, d }
  }
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (iso) {
    const y = +iso[1], m = +iso[2], d = +iso[3]
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) return { y, m, d }
  }
  return null
}

const LunarCalendarPage = forwardRef<TPageRef>((_, ref) => {
  const today = useMemo(getToday, [])

  const todayJDN = useMemo(
    () => gregorianToJDN(today.y, today.m, today.d),
    [today]
  )

  const [selectedJDN, setSelectedJDN] = useState<number>(todayJDN)
  const [viewLunation, setViewLunation] = useState<number>(
    () => getNewMoonOnOrBefore(todayJDN)
  )
  const [inputStr, setInputStr] = useState('')

  const handleInput = (val: string) => {
    setInputStr(val)
    const p = parseInput(val, today.y)
    if (p) {
      const jdn = gregorianToJDN(p.y, p.m, p.d)
      setSelectedJDN(jdn)
      setViewLunation(getNewMoonOnOrBefore(jdn))
    }
  }

  const handleCellClick = (jdn: number) => {
    setSelectedJDN(jdn)
    const { year, month, day } = JDNtoGregorian(jdn)
    setInputStr(`${month}/${day}/${year}`)
  }

  const prevMonth = () => setViewLunation((jdn) => getNewMoonOnOrBefore(jdn - 1))
  const nextMonth = () => setViewLunation((jdn) => getNewMoonAfter(jdn))

  const data = useMemo(() => {
    const moonAge = getMoonAge(selectedJDN)
    return {
      moonAge,
      phaseName: getMoonPhaseName(moonAge),
      illumination: getMoonIllumination(moonAge),
      phaseEmoji: getMoonPhaseEmoji(moonAge)
    }
  }, [selectedJDN])

  return (
    <PrimaryPageLayout ref={ref} pageName="lunarCalendar" titlebar={<LunarCalendarTitlebar />}>
      <div className="flex flex-col items-center gap-5 px-4 py-5">

        <div className="w-full max-w-xs">
          <input
            type="text"
            value={inputStr}
            onChange={(e) => handleInput(e.target.value)}
            placeholder="6/2  or  6/2/2025"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <div className="flex items-center gap-5">
          <div className="rounded-full bg-[#0a0a1a] p-3 ring-1 ring-white/10">
            <MoonSVG age={data.moonAge} />
          </div>
          <div className="flex flex-col gap-2">
            <div>
              <div className="text-base font-bold">{data.phaseEmoji} {data.phaseName}</div>
              <div className="text-xs text-muted-foreground">Moon Phase</div>
            </div>
            <div>
              <div className="text-base font-bold">{data.illumination}%</div>
              <div className="text-xs text-muted-foreground">Illuminated</div>
            </div>
            <div>
              <div className="text-base font-bold">{data.moonAge.toFixed(1)}d</div>
              <div className="text-xs text-muted-foreground">Moon Age</div>
            </div>
          </div>
        </div>

        <div className="w-full max-w-sm">
          <LunarMonthGrid
            lunationStartJDN={viewLunation}
            selectedJDN={selectedJDN}
            onDayClick={handleCellClick}
            onPrevMonth={prevMonth}
            onNextMonth={nextMonth}
          />
        </div>

      </div>
    </PrimaryPageLayout>
  )
})
LunarCalendarPage.displayName = 'LunarCalendarPage'
export default LunarCalendarPage

function LunarCalendarTitlebar() {
  return (
    <div className="flex h-full items-center gap-2 pl-3">
      <MoonIcon className="h-5 w-5" />
      <div className="text-lg font-semibold">Lunar Calendar</div>
    </div>
  )
}
