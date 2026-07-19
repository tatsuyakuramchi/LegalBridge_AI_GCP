import * as React from "react"
import { useLocation } from "react-router-dom"
import { Sun, Moon, Search, ChevronRight } from "lucide-react"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { NativeSelect } from "@/components/ui/native-select"
import { useSkin, SKINS } from "@/src/lib/skin"

const TITLES: Array<[RegExp, string, string]> = [
  [/^\/$/, "Dashboard", "Operations Overview"],
  [/^\/documents\/new/, "Document Editor", "Generation pipeline"],
  [/^\/requests/, "Requests", "Backlog tickets"],
  [/^\/archive/, "Archive", "Concluded artifacts"],
  [/^\/master\/contracts/, "Contract Matrix", "Master · Contracts"],
  [/^\/master\/vendors/, "Vendors", "Master · External partners"],
  [/^\/master\/staff/, "Staff", "Master · Internal"],
  [/^\/master\/rules/, "Routing Rules", "Master · Workflow"],
  [/^\/master/, "Masters", "Reference data"],
  [/^\/templates\/(.+)/, "Blueprint Editor", "Templates"],
  [/^\/templates/, "Blueprint Studio", "HTML templates"],
  [/^\/settings/, "System Settings", "Environment & profile"],
]

function useTitle() {
  const { pathname } = useLocation()
  for (const [re, title, subtitle] of TITLES) {
    if (re.test(pathname)) return { title, subtitle }
  }
  return { title: "Arcs Legal OS", subtitle: "" }
}

// 統合 Phase 2: admin-ui ホストの /whoami から実ユーザー(email/role)を取得。
//   IAP 配下なら IAP メール、未配下/ローカルでは null になり得る。
function useWhoami() {
  const [who, setWho] = React.useState<{ email: string | null; role: string } | null>(null)
  React.useEffect(() => {
    let cancelled = false
    fetch("/whoami")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!cancelled && j) setWho({ email: j.email ?? null, role: j.role || "viewer" })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])
  return who
}

function useTheme() {
  const [theme, setTheme] = React.useState<"light" | "dark">(() => {
    if (typeof window === "undefined") return "light"
    return (localStorage.getItem("arcs-theme") as "light" | "dark") || "light"
  })
  React.useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark")
    localStorage.setItem("arcs-theme", theme)
  }, [theme])
  return { theme, toggle: () => setTheme((t) => (t === "light" ? "dark" : "light")) }
}

export function Topbar() {
  const { title, subtitle } = useTitle()
  const { theme, toggle } = useTheme()
  const { skin, setSkin } = useSkin()
  const who = useWhoami()
  const now = new Date()
  const displayName = who?.email ? who.email.split("@")[0] : "—"
  const roleLabel =
    who == null ? "…" : who.role === "admin" ? "Administrator" : "Viewer"
  const initials = (who?.email ? who.email.slice(0, 2) : "KT").toUpperCase()
  return (
    <header className="sticky top-0 z-30 h-14 flex items-center gap-4 px-6 bg-background/80 backdrop-blur border-b border-border">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
          {skin === "eva" ? "NERV" : skin === "clean" ? "LegalBridge" : "ARCS"}
        </span>
        <ChevronRight className="h-3 w-3 text-muted-foreground" />
        <div className="leading-none">
          <h1 className="text-sm font-mono font-bold uppercase tracking-[0.14em] truncate">
            {title}
          </h1>
          {subtitle && (
            <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-muted-foreground mt-0.5">
              {subtitle}
            </p>
          )}
        </div>
      </div>

      <div className="flex-1" />

      {/* Search */}
      <div className="relative hidden md:block w-64">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          type="search"
          placeholder="Search · Cmd+K"
          className="pl-8 h-8 text-xs"
        />
      </div>

      {/* Clock */}
      <div className="hidden md:flex flex-col items-end leading-none px-2 border-l border-border">
        <span className="text-[10px] font-mono tab-mono font-bold tracking-[0.14em]">
          {now.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}
        </span>
        <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground mt-0.5">
          {now.toLocaleDateString("ja-JP", { month: "short", day: "2-digit", weekday: "short" })}
        </span>
      </div>

      {/* Skin switcher (外観テーマ。新スキンは src/lib/skin.tsx の SKINS に追加) */}
      <NativeSelect
        value={skin}
        onChange={(e) => setSkin(e.target.value as any)}
        aria-label="Skin"
        className="h-8 w-auto px-2 text-[10px] font-mono font-bold uppercase tracking-[0.12em]"
        title="スキン(外観)を切り替え"
      >
        {SKINS.map((s) => (
          <option key={s.id} value={s.id}>
            {s.tag} · {s.label}
          </option>
        ))}
      </NativeSelect>

      {/* Theme toggle */}
      <Button variant="ghost" size="icon-sm" onClick={toggle} aria-label="Toggle theme">
        {theme === "light" ? <Moon className="h-3.5 w-3.5" /> : <Sun className="h-3.5 w-3.5" />}
      </Button>

      {/* User */}
      <div className="flex items-center gap-2.5 pl-3 border-l border-border">
        <div className="text-right leading-none hidden sm:block">
          <p className="text-[10px] font-mono font-bold uppercase tracking-[0.14em] truncate max-w-[160px]">
            {displayName}
          </p>
          <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground mt-0.5">
            {roleLabel}
          </p>
        </div>
        <Avatar>
          <AvatarFallback>{initials}</AvatarFallback>
        </Avatar>
      </div>
    </header>
  )
}
