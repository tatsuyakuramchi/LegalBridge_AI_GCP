import * as React from "react"

type Node = { key: string; label: string; pct: number; sub?: string }

// MAGI 風の三審判定マトリクス(SVG)。3頂点(例: BUSINESS / LEGAL / APPROVAL)を
//   結ぶ逆三角形。各頂点に割合、中心に総合値を表示する。
export function MagiTriangle({
  nodes,
  center,
  centerLabel = "OVERALL",
}: {
  nodes: [Node, Node, Node]
  center: number
  centerLabel?: string
}) {
  const W = 320
  const H = 240
  // 頂点座標: 左上(BUSINESS) / 右上(LEGAL) / 下中央(APPROVAL)
  const P = [
    { x: 52, y: 54 },
    { x: 268, y: 54 },
    { x: 160, y: 206 },
  ]
  const cx = (P[0].x + P[1].x + P[2].x) / 3
  const cy = (P[0].y + P[1].y + P[2].y) / 3
  const orange = "hsl(var(--primary))"
  const tone = (p: number) =>
    p >= 80 ? "hsl(145 60% 45%)" : p >= 50 ? "hsl(var(--primary))" : "hsl(4 85% 56%)"

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        {/* connecting frame */}
        <polygon
          points={P.map((p) => `${p.x},${p.y}`).join(" ")}
          fill="hsl(var(--primary) / 0.04)"
          stroke={orange}
          strokeWidth={1.2}
        />
        {/* spokes to center */}
        {P.map((p, i) => (
          <line
            key={i}
            x1={cx}
            y1={cy}
            x2={p.x}
            y2={p.y}
            stroke={orange}
            strokeWidth={0.6}
            strokeDasharray="3 3"
            opacity={0.5}
          />
        ))}
        {/* center diamond */}
        <g>
          <polygon
            points={`${cx},${cy - 26} ${cx + 26},${cy} ${cx},${cy + 26} ${cx - 26},${cy}`}
            fill="hsl(var(--background))"
            stroke={orange}
            strokeWidth={1.2}
          />
          <text
            x={cx}
            y={cy - 1}
            textAnchor="middle"
            className="font-mono font-bold"
            fontSize="20"
            fill={tone(center)}
          >
            {Math.round(center)}%
          </text>
          <text
            x={cx}
            y={cy + 13}
            textAnchor="middle"
            className="font-mono"
            fontSize="7"
            letterSpacing="1.5"
            fill="hsl(var(--muted-foreground))"
          >
            {centerLabel}
          </text>
        </g>
        {/* vertex nodes */}
        {P.map((p, i) => {
          const n = nodes[i]
          const anchor = i === 0 ? "start" : i === 1 ? "end" : "middle"
          const tx = i === 0 ? p.x - 6 : i === 1 ? p.x + 6 : p.x
          const ty = i === 2 ? p.y + 22 : p.y - 18
          return (
            <g key={n.key}>
              <circle cx={p.x} cy={p.y} r={6} fill={tone(n.pct)} stroke={orange} strokeWidth={1} />
              <circle cx={p.x} cy={p.y} r={11} fill="none" stroke={tone(n.pct)} strokeWidth={0.6} opacity={0.6} />
              <text
                x={tx}
                y={ty}
                textAnchor={anchor as any}
                className="font-mono font-bold"
                fontSize="9"
                letterSpacing="1.2"
                fill="hsl(var(--foreground))"
              >
                {n.label}
              </text>
              <text
                x={tx}
                y={ty + 11}
                textAnchor={anchor as any}
                className="font-mono font-bold"
                fontSize="11"
                fill={tone(n.pct)}
              >
                {Math.round(n.pct)}%
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
