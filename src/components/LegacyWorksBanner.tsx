/**
 * LegacyWorksBanner — 作品統合 増分⑨
 *
 * 旧 原作/作品 管理画面(LedgersPanel / WorkModelPanel)に表示する移行バナー。
 * 「作品管理」(/works) への導線を促す。データ移行(§8 #4)完了までは旧画面も
 * 機能維持するため、画面自体は残しつつ本バナーで新導線へ誘導する。
 */
import * as React from "react"
import { Link } from "react-router-dom"
import { Network } from "lucide-react"

export function LegacyWorksBanner({ what }: { what: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] font-mono text-amber-800">
      <span>
        ⚠ この画面は<strong>「作品管理」</strong>に統合されました。{what}の編集は
        作品管理（原作・自社作品・派生を3カードで一元管理）をご利用ください。
      </span>
      <Link
        to="/works"
        className="shrink-0 inline-flex items-center gap-1 rounded border border-amber-400 px-2 py-1 font-bold hover:bg-amber-100"
      >
        <Network className="h-3.5 w-3.5" />
        作品管理を開く
      </Link>
    </div>
  )
}
