import * as React from "react"

// スキン(外観テーマ)切替。light/dark とは独立した軸として <html> の data-skin で
//   管理し、CSS 変数(index.css の [data-skin="..."])で全体を再スキンする。
//   retro = 既定(ペーパー/CRT ターミナル)、eva = NERV/MAGI ターミナル風、
//   macos = search-api と同じ macOS(Big Sur) テイスト。
export type Skin = "retro" | "eva" | "macos"

export const SKINS: { id: Skin; label: string; tag: string }[] = [
  { id: "retro", label: "Retro Terminal", tag: "STD" },
  { id: "eva", label: "NERV / MAGI", tag: "EVA" },
  { id: "macos", label: "Search · macOS", tag: "MAC" },
]

type SkinCtx = { skin: Skin; setSkin: (s: Skin) => void }
const Ctx = React.createContext<SkinCtx>({ skin: "retro", setSkin: () => {} })

const isSkin = (v: any): v is Skin => SKINS.some((s) => s.id === v)

export function SkinProvider({ children }: { children: React.ReactNode }) {
  const [skin, setSkin] = React.useState<Skin>(() => {
    if (typeof window === "undefined") return "retro"
    const s = localStorage.getItem("arcs-skin")
    return isSkin(s) ? s : "retro"
  })

  React.useEffect(() => {
    const root = document.documentElement
    if (skin === "retro") root.removeAttribute("data-skin")
    else root.setAttribute("data-skin", skin)
    localStorage.setItem("arcs-skin", skin)
  }, [skin])

  return <Ctx.Provider value={{ skin, setSkin }}>{children}</Ctx.Provider>
}

export function useSkin() {
  return React.useContext(Ctx)
}
