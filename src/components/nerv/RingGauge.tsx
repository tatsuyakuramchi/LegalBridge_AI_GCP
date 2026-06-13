import * as React from "react"

// NERV 風リングゲージ(SVG 円形プログレス)。value=0..100、tone は CSS color。
export function RingGauge({
  value,
  label,
  sub,
  tone = "hsl(var(--primary))",
  size = 116,
  stroke = 7,
}: {
  value: number
  label: string
  sub?: string
  tone?: string
  size?: number
  stroke?: number
}) {
  const pct = Math.max(0, Math.min(100, Math.round(value)))
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const dash = (pct / 100) * c
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="hsl(var(--border))"
            strokeWidth={stroke}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={tone}
            strokeWidth={stroke}
            strokeDasharray={`${dash} ${c}`}
            strokeLinecap="butt"
            style={{ filter: `drop-shadow(0 0 4px ${tone})`, transition: "stroke-dasharray .6s ease" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span
            className="text-2xl font-mono font-bold tab-mono leading-none"
            style={{ color: tone }}
          >
            {pct}
            <span className="text-sm">%</span>
          </span>
        </div>
      </div>
      <p className="text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-center">
        {label}
      </p>
      {sub && (
        <p className="text-[9px] font-mono uppercase tracking-[0.16em] text-muted-foreground text-center">
          {sub}
        </p>
      )}
    </div>
  )
}
