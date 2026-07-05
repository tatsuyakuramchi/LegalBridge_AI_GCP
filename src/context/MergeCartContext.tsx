import * as React from "react"

// 課題統合カート。重複/誤起票の課題を「籠」へ集めてから、残す1件(統合先)を
//   選んで一括統合する。課題キーの手入力を廃し、件名・ステータスを見ながら
//   直感的に統合先を選べるようにする(実行は MergeCartPanel)。
//   RequestsPage / IssueDetailPage の「カートに入れる」から投入する。

export interface MergeCartItem {
  issueKey: string
  summary?: string
  statusName?: string
}

interface MergeCartValue {
  items: MergeCartItem[]
  // 統合先(残す側)。items から1件選ぶ。未選択時は null。
  targetKey: string | null
  open: boolean
  setOpen: (v: boolean) => void
  add: (item: MergeCartItem, opts?: { openPanel?: boolean }) => void
  addMany: (items: MergeCartItem[], opts?: { openPanel?: boolean }) => void
  remove: (issueKey: string) => void
  clear: () => void
  setTarget: (issueKey: string | null) => void
  has: (issueKey: string) => boolean
}

const MergeCartContext = React.createContext<MergeCartValue | null>(null)

// ページ遷移(課題詳細で中身を確認しながら集める)を跨いでも消えないよう
//   sessionStorage に保持する。タブを閉じれば消える。
const STORAGE_KEY = "legalbridge.mergeCart.v1"

function loadStored(): { items: MergeCartItem[]; targetKey: string | null } {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return { items: [], targetKey: null }
    const d = JSON.parse(raw)
    const items = (Array.isArray(d?.items) ? d.items : [])
      .filter((x: any) => x && typeof x.issueKey === "string" && x.issueKey)
      .map((x: any) => ({
        issueKey: String(x.issueKey),
        summary: x.summary ? String(x.summary) : undefined,
        statusName: x.statusName ? String(x.statusName) : undefined,
      }))
    const targetKey =
      typeof d?.targetKey === "string" && items.some((i: MergeCartItem) => i.issueKey === d.targetKey)
        ? d.targetKey
        : null
    return { items, targetKey }
  } catch {
    return { items: [], targetKey: null }
  }
}

export function MergeCartProvider({ children }: { children: React.ReactNode }) {
  const [{ items, targetKey }, setState] = React.useState(loadStored)
  const [open, setOpen] = React.useState(false)

  React.useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ items, targetKey }))
    } catch {
      /* noop */
    }
  }, [items, targetKey])

  const add = React.useCallback((item: MergeCartItem, opts?: { openPanel?: boolean }) => {
    setState((prev) => {
      if (prev.items.some((i) => i.issueKey === item.issueKey)) return prev
      const next = [...prev.items, item]
      return {
        items: next,
        // 最初の1件を統合先の既定にする(あとからラジオで変更できる)。
        targetKey: prev.targetKey ?? next[0].issueKey,
      }
    })
    if (opts?.openPanel) setOpen(true)
  }, [])

  const addMany = React.useCallback((newItems: MergeCartItem[], opts?: { openPanel?: boolean }) => {
    setState((prev) => {
      const seen = new Set(prev.items.map((i) => i.issueKey))
      const merged = [...prev.items]
      for (const item of newItems) {
        if (!item?.issueKey || seen.has(item.issueKey)) continue
        seen.add(item.issueKey)
        merged.push(item)
      }
      if (merged.length === prev.items.length) return prev
      return { items: merged, targetKey: prev.targetKey ?? merged[0]?.issueKey ?? null }
    })
    if (opts?.openPanel) setOpen(true)
  }, [])

  const remove = React.useCallback((issueKey: string) => {
    setState((prev) => {
      const items = prev.items.filter((i) => i.issueKey !== issueKey)
      return {
        items,
        // 統合先を外したら先頭へフォールバック(空なら未選択に戻す)。
        targetKey: prev.targetKey === issueKey ? items[0]?.issueKey ?? null : prev.targetKey,
      }
    })
  }, [])

  const clear = React.useCallback(() => setState({ items: [], targetKey: null }), [])

  const setTarget = React.useCallback((issueKey: string | null) => {
    setState((prev) => ({
      ...prev,
      targetKey: issueKey && prev.items.some((i) => i.issueKey === issueKey) ? issueKey : null,
    }))
  }, [])

  const has = React.useCallback(
    (issueKey: string) => items.some((i) => i.issueKey === issueKey),
    [items]
  )

  const value: MergeCartValue = { items, targetKey, open, setOpen, add, addMany, remove, clear, setTarget, has }
  return <MergeCartContext.Provider value={value}>{children}</MergeCartContext.Provider>
}

export function useMergeCart() {
  const ctx = React.useContext(MergeCartContext)
  if (!ctx) throw new Error("useMergeCart must be used within a MergeCartProvider")
  return ctx
}
