/**
 * DeprecatedRedirect — 廃止(deprecated)ルートの互換リダイレクト + アクセス計測(CLEAN-06)。
 *
 * 旧 URL を踏んだユーザーを新 URL へ `replace` 遷移させつつ、到達を BFF へ
 * fire-and-forget で通知する(sendBeacon)。サーバ側(server.ts)は構造化ログを
 * 吐くだけで DB は持たない。Cloud Logging で「旧 URL がいつまで踏まれているか」を
 * 集計し、リダイレクト自体を撤去してよい時期(CLEAN-09)の判断材料にする。
 *
 * 計測が失敗しても遷移は必ず行う(計測は副次目的)。
 */
import * as React from "react";
import { Navigate } from "react-router-dom";

export function DeprecatedRedirect(props: { to: string; from?: string }) {
  const { to, from } = props;
  React.useEffect(() => {
    try {
      const src =
        from || (typeof window !== "undefined" ? window.location.pathname : "");
      const url = `/api/_client-telemetry/deprecated-route?from=${encodeURIComponent(
        src
      )}&to=${encodeURIComponent(to)}`;
      if (typeof navigator !== "undefined" && navigator.sendBeacon) {
        navigator.sendBeacon(url);
      } else if (typeof fetch !== "undefined") {
        // sendBeacon 非対応環境のフォールバック(遷移で unmount されても送り切る)。
        fetch(url, { method: "POST", keepalive: true }).catch(() => {});
      }
    } catch {
      /* 計測失敗は無視。遷移を止めない。 */
    }
  }, [to, from]);

  return <Navigate to={to} replace />;
}
