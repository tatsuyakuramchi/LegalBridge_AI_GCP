import * as React from "react"

// スキン(外観テーマ)切替。light/dark とは独立した軸として <html> の data-skin で
//   管理し、CSS 変数(index.css の [data-skin="..."])で全体を再スキンする。
//   clean = 既定(LegalBridge コーポレート・クリーン)、retro = ペーパー/CRT ターミナル、
//   eva = NERV/MAGI ターミナル風、macos = search-api と同じ macOS(Big Sur) テイスト。
export type Skin = "clean" | "retro" | "eva" | "macos"

export const SKINS: { id: Skin; label: string; tag: string }[] = [
  { id: "clean", label: "LegalBridge Clean", tag: "STD" },
  { id: "retro", label: "Retro Terminal", tag: "RETRO" },
  { id: "eva", label: "NERV / MAGI", tag: "EVA" },
  { id: "macos", label: "Search · macOS", tag: "MAC" },
]

type SkinCtx = { skin: Skin; setSkin: (s: Skin) => void }
const Ctx = React.createContext<SkinCtx>({ skin: "retro", setSkin: () => {} })

const isSkin = (v: any): v is Skin => SKINS.some((s) => s.id === v)

// v2: 既定を clean へ切替。旧キー("arcs-skin")は全ユーザーに "retro" が焼き付いて
//   いるため、新キーにして新既定(clean)へリセットする(明示切替は新キーに保持)。
const SKIN_KEY = "lb-skin"

export function SkinProvider({ children }: { children: React.ReactNode }) {
  const [skin, setSkin] = React.useState<Skin>(() => {
    if (typeof window === "undefined") return "clean"
    const s = localStorage.getItem(SKIN_KEY)
    return isSkin(s) ? s : "clean"
  })

  React.useEffect(() => {
    const root = document.documentElement
    // retro のみ base(:root) を使う(data-skin 無し)。clean/eva/macos は data-skin。
    if (skin === "retro") root.removeAttribute("data-skin")
    else root.setAttribute("data-skin", skin)
    localStorage.setItem(SKIN_KEY, skin)
  }, [skin])

  return <Ctx.Provider value={{ skin, setSkin }}>{children}</Ctx.Provider>
}

export function useSkin() {
  return React.useContext(Ctx)
}
