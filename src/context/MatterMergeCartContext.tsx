import * as React from "react"

// 案件統合カート。重複案件を「籠」へ集めてから、残す1件(統合先)を選んで
//   一括統合する。案件IDの手入力を廃し、案件コード・件名・相手方を見ながら
//   直感的に統合先を選べるようにする(実行は MatterMergeCartPanel)。
//   MattersListPage の各行 / MatterDetailPage の「カートに追加」から投入する。
//   ※ 課題統合カート(MergeCartContext)の案件版。

export interface MatterCartItem {
  id: number
  matter_code?: string | null
  title?: string | null
  counterparty?: string | null
}

interface MatterMergeCartValue {
  items: MatterCartItem[]
  // 統合先(残す側)。items から1件選ぶ。未選択時は null。
  targetId: number | null
  open: boolean
  setOpen: (v: boolean) => void
  add: (item: MatterCartItem, opts?: { openPanel?: boolean }) => void
  remove: (id: number) => void
  clear: () => void
  setTarget: (id: number | null) => void
  has: (id: number) => boolean
}

const MatterMergeCartContext = React.createContext<MatterMergeCartValue | null>(null)

// ページ遷移(案件詳細で中身を確認しながら集める)を跨いでも消えないよう
//   sessionStorage に保持する。タブを閉じれば消える。
const STORAGE_KEY = "legalbridge.matterMergeCart.v1"

function loadStored(): { items: MatterCartItem[]; targetId: number | null } {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return { items: [], targetId: null }
    const d = JSON.parse(raw)
    const items = (Array.isArray(d?.items) ? d.items : [])
      .filter((x: any) => x && Number.isFinite(Number(x.id)))
      .map((x: any) => ({
        id: Number(x.id),
        matter_code: x.matter_code ? String(x.matter_code) : null,
        title: x.title ? String(x.title) : null,
        counterparty: x.counterparty ? String(x.counterparty) : null,
      }))
    const targetId =
      Number.isFinite(Number(d?.targetId)) &&
      items.some((i: MatterCartItem) => i.id === Number(d.targetId))
        ? Number(d.targetId)
        : null
    return { items, targetId }
  } catch {
    return { items: [], targetId: null }
  }
}

export function MatterMergeCartProvider({ children }: { children: React.ReactNode }) {
  const [{ items, targetId }, setState] = React.useState(loadStored)
  const [open, setOpen] = React.useState(false)

  React.useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ items, targetId }))
    } catch {
      /* noop */
    }
  }, [items, targetId])

  const add = React.useCallback((item: MatterCartItem, opts?: { openPanel?: boolean }) => {
    setState((prev) => {
      if (prev.items.some((i) => i.id === item.id)) return prev
      const next = [...prev.items, item]
      return {
        items: next,
        // 最初の1件を統合先の既定にする(あとからラジオで変更できる)。
        targetId: prev.targetId ?? next[0].id,
      }
    })
    if (opts?.openPanel) setOpen(true)
  }, [])

  const remove = React.useCallback((id: number) => {
    setState((prev) => {
      const items = prev.items.filter((i) => i.id !== id)
      return {
        items,
        // 統合先を外したら先頭へフォールバック(空なら未選択に戻す)。
        targetId: prev.targetId === id ? items[0]?.id ?? null : prev.targetId,
      }
    })
  }, [])

  const clear = React.useCallback(() => setState({ items: [], targetId: null }), [])

  const setTarget = React.useCallback((id: number | null) => {
    setState((prev) => ({
      ...prev,
      targetId: id != null && prev.items.some((i) => i.id === id) ? id : null,
    }))
  }, [])

  const has = React.useCallback((id: number) => items.some((i) => i.id === id), [items])

  const value: MatterMergeCartValue = {
    items,
    targetId,
    open,
    setOpen,
    add,
    remove,
    clear,
    setTarget,
    has,
  }
  return (
    <MatterMergeCartContext.Provider value={value}>
      {children}
    </MatterMergeCartContext.Provider>
  )
}

export function useMatterMergeCart() {
  const ctx = React.useContext(MatterMergeCartContext)
  if (!ctx) throw new Error("useMatterMergeCart must be used within a MatterMergeCartProvider")
  return ctx
}
