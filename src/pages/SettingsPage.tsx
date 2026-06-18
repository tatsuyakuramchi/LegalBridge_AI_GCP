import * as React from "react"
import {
  ShieldCheck,
  GitBranch,
  Users as UsersIcon,
  Database,
  Save,
  CheckCircle2,
} from "lucide-react"

import { useAppData } from "@/src/context/AppDataContext"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"

export function SettingsPage() {
  const { appSettings, setAppSettings, companyProfile, showNotification } =
    useAppData()
  const [tab, setTab] = React.useState("company")

  const persist = async (label: string) => {
    await fetch("/api/master/app-settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings: appSettings }),
    })
    showNotification(`${label} を保存しました`, "success")
  }

  const setField = (key: string, value: any) =>
    setAppSettings({ ...appSettings, [key]: value })

  const setNested = (group: string, value: string) =>
    setAppSettings({
      ...appSettings,
      [group]: { ...(appSettings[group] || {}), template: value },
    })

  return (
    <div className="px-6 py-6 max-w-[1100px] mx-auto space-y-6">
      <header className="border-b border-border pb-5">
        <p className="retro-tag mb-1.5">SYS · CONFIG</p>
        <h2 className="text-2xl font-mono font-bold tracking-tight">
          System Settings
        </h2>
        <p className="text-xs font-mono text-muted-foreground mt-1.5">
          Environment variables, integrations, and notification templates.
        </p>
      </header>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="company">Company</TabsTrigger>
          <TabsTrigger value="integrations">Integrations</TabsTrigger>
          <TabsTrigger value="slack">Slack templates</TabsTrigger>
          <TabsTrigger value="email">メール送信</TabsTrigger>
          <TabsTrigger value="database">Database</TabsTrigger>
        </TabsList>

        {/* Company */}
        <TabsContent value="company" className="space-y-4">
          <Card>
            <CardContent className="px-5 space-y-4">
              <div className="flex items-center gap-2 border-b border-border pb-2.5">
                <ShieldCheck className="h-4 w-4 text-emerald-600" />
                <p className="retro-tag">Company Identity</p>
              </div>
              <div className="space-y-3">
                <Field label="Legal name">
                  <Input
                    value={appSettings.COMPANY_NAME || companyProfile?.name || ""}
                    onChange={(e) => setField("COMPANY_NAME", e.target.value)}
                  />
                </Field>
                <Field label="Address">
                  <Textarea
                    rows={2}
                    value={appSettings.COMPANY_ADDRESS || companyProfile?.address || ""}
                    onChange={(e) => setField("COMPANY_ADDRESS", e.target.value)}
                  />
                </Field>
                <Field label="Representative">
                  <Input
                    value={
                      appSettings.COMPANY_REPRESENTATIVE ||
                      companyProfile?.representative ||
                      ""
                    }
                    onChange={(e) =>
                      setField("COMPANY_REPRESENTATIVE", e.target.value)
                    }
                  />
                </Field>
                <Button onClick={() => persist("Company Identity")}>
                  <Save />
                  Save identity
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Integrations */}
        <TabsContent value="integrations" className="space-y-4">
          <Card>
            <CardContent className="px-5 space-y-4">
              <div className="flex items-center gap-2 border-b border-border pb-2.5">
                <GitBranch className="h-4 w-4 text-cyan-700 dark:text-cyan-300" />
                <p className="retro-tag">Backlog</p>
                <div className="flex-1" />
                <StatusPill ok={!!appSettings.BACKLOG_API_KEY} />
              </div>
              <div className="space-y-3">
                <Field label="API Key">
                  <Input
                    type="password"
                    value={appSettings.BACKLOG_API_KEY || ""}
                    onChange={(e) => setField("BACKLOG_API_KEY", e.target.value)}
                  />
                </Field>
                <Field label="Space host">
                  <Input
                    value={appSettings.BACKLOG_HOST || ""}
                    placeholder="example.backlog.com"
                    onChange={(e) => setField("BACKLOG_HOST", e.target.value)}
                  />
                </Field>
                <Field label="Project key">
                  <Input
                    value={appSettings.BACKLOG_PROJECT_KEY || ""}
                    placeholder="LEGAL"
                    onChange={(e) =>
                      setField("BACKLOG_PROJECT_KEY", e.target.value)
                    }
                  />
                </Field>
                <Button onClick={() => persist("Backlog Integration")}>
                  <Save />
                  Apply
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="px-5 space-y-4">
              <div className="flex items-center gap-2 border-b border-border pb-2.5">
                <UsersIcon className="h-4 w-4 text-cyan-700 dark:text-cyan-300" />
                <p className="retro-tag">Slack Bot</p>
                <div className="flex-1" />
                <StatusPill ok={!!appSettings.SLACK_BOT_TOKEN} />
              </div>
              <div className="space-y-3">
                <Field label="Bot token">
                  <Input
                    type="password"
                    value={appSettings.SLACK_BOT_TOKEN || ""}
                    onChange={(e) => setField("SLACK_BOT_TOKEN", e.target.value)}
                    placeholder="xoxb-…"
                  />
                </Field>
                <Field label="Signing secret">
                  <Input
                    type="password"
                    value={appSettings.SLACK_SIGNING_SECRET || ""}
                    onChange={(e) =>
                      setField("SLACK_SIGNING_SECRET", e.target.value)
                    }
                  />
                </Field>
                <Button onClick={() => persist("Slack Bot")}>
                  <Save />
                  Apply
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* クラウドサイン(電子契約) */}
          <Card>
            <CardContent className="px-5 space-y-4">
              <div className="flex items-center gap-2 border-b border-border pb-2.5">
                <ShieldCheck className="h-4 w-4 text-cyan-700 dark:text-cyan-300" />
                <p className="retro-tag">クラウドサイン</p>
                <div className="flex-1" />
                <StatusPill
                  ok={!!appSettings.CLOUDSIGN_CLIENT_ID && String(appSettings.CLOUDSIGN_ENABLED) === "true"}
                />
              </div>
              <div className="space-y-3">
                <Field label="Client ID">
                  <Input
                    type="password"
                    value={appSettings.CLOUDSIGN_CLIENT_ID || ""}
                    onChange={(e) => setField("CLOUDSIGN_CLIENT_ID", e.target.value)}
                    placeholder="CloudSign 管理画面で発行した client_id"
                  />
                </Field>
                <Field label="連携の有効化">
                  <select
                    value={String(appSettings.CLOUDSIGN_ENABLED) === "true" ? "true" : "false"}
                    onChange={(e) => setField("CLOUDSIGN_ENABLED", e.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm font-mono"
                  >
                    <option value="false">無効（送信しない）</option>
                    <option value="true">有効（送信を許可）</option>
                  </select>
                </Field>
                <Field label="テスト送信の許可宛先（カンマ区切り）">
                  <Input
                    value={appSettings.CLOUDSIGN_ALLOWED_RECIPIENTS || ""}
                    onChange={(e) => setField("CLOUDSIGN_ALLOWED_RECIPIENTS", e.target.value)}
                    placeholder="社内宛のみ: a@example.co.jp, b@example.co.jp"
                  />
                </Field>
                <p className="text-[11px] font-mono text-muted-foreground -mt-1">
                  ※ 許可宛先を設定している間は、その宛先以外への送信は拒否されます（社内宛で締結まで検証する用）。空にすると本番宛先へ送信できます。
                </p>
                <Field label="API ベースURL（任意）">
                  <Input
                    value={appSettings.CLOUDSIGN_BASE_URL || ""}
                    onChange={(e) => setField("CLOUDSIGN_BASE_URL", e.target.value)}
                    placeholder="https://api.cloudsign.jp"
                  />
                </Field>
                <Button onClick={() => persist("CloudSign")}>
                  <Save />
                  Apply
                </Button>
                <div className="pt-1">
                  <CloudSignHealthButton />
                </div>
                <p className="text-[11px] font-mono text-muted-foreground -mt-1">
                  ※ 接続テストは保存済みの設定で実行します。Client ID を変えたら先に Apply してください（書類は送信されません）。
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Slack templates */}
        <TabsContent value="slack" className="space-y-4">
          <Card>
            <CardContent className="px-5 space-y-4">
              <p className="retro-tag">Reply / Notification Templates</p>
              <SlackField
                title="User reception (DM)"
                value={appSettings.slack_answer_back_user?.template || ""}
                onChange={(v) => setNested("slack_answer_back_user", v)}
              />
              <SlackField
                title="Overdue alert"
                value={appSettings.slack_overdue_alert?.template || ""}
                onChange={(v) => setNested("slack_overdue_alert", v)}
                hint="Available: {{mention}}, {{issueKey}}, {{summary}}, {{counterparty}}, {{deadline}}"
              />
              <SlackField
                title="Document generated"
                value={appSettings.slack_document_generated?.template || ""}
                onChange={(v) => setNested("slack_document_generated", v)}
                hint="Available: {{issueKey}}, {{summary}}, {{type}}, {{link}}"
              />
              <SlackField
                title="Bulk import done"
                value={appSettings.slack_bulk_import_done?.template || ""}
                onChange={(v) => setNested("slack_bulk_import_done", v)}
                hint="Available: {{processedCount}}"
              />
              <SlackField
                title="Channel notification"
                value={appSettings.slack_answer_back_channel?.template || ""}
                onChange={(v) => setNested("slack_answer_back_channel", v)}
              />
              <Button variant="outline" onClick={() => persist("Slack templates")}>
                <Save />
                Persist templates
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* メール送信(Gmail API) — 検収書 / 利用許諾料計算書 */}
        <TabsContent value="email" className="space-y-4">
          <Card>
            <CardContent className="px-5 space-y-4">
              <div className="flex items-center gap-2 border-b border-border pb-2.5">
                <ShieldCheck className="h-4 w-4 text-emerald-700 dark:text-emerald-300" />
                <p className="retro-tag">メール送信（Gmail API）</p>
                <div className="flex-1" />
                <StatusPill
                  ok={!!appSettings.EMAIL_SENDER && String(appSettings.EMAIL_ENABLED) === "true"}
                />
              </div>
              <div className="space-y-3">
                <Field label="送信元アドレス（EMAIL_SENDER）">
                  <Input
                    value={appSettings.EMAIL_SENDER || ""}
                    onChange={(e) => setField("EMAIL_SENDER", e.target.value)}
                    placeholder="差出人にする Workspace ユーザー: legal@example.co.jp"
                  />
                </Field>
                <Field label="連携の有効化">
                  <select
                    value={String(appSettings.EMAIL_ENABLED) === "true" ? "true" : "false"}
                    onChange={(e) => setField("EMAIL_ENABLED", e.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm font-mono"
                  >
                    <option value="false">無効（送信しない）</option>
                    <option value="true">有効（送信を許可）</option>
                  </select>
                </Field>
                <Field label="テスト送信の許可宛先（カンマ区切り）">
                  <Input
                    value={appSettings.EMAIL_ALLOWED_RECIPIENTS || ""}
                    onChange={(e) => setField("EMAIL_ALLOWED_RECIPIENTS", e.target.value)}
                    placeholder="社内宛のみ: a@example.co.jp, b@example.co.jp"
                  />
                </Field>
                <p className="text-[11px] font-mono text-muted-foreground -mt-1">
                  ※ 許可宛先を設定している間は、その宛先以外への送信は拒否されます（社内宛で検証する用）。空にすると本番宛先へ送信できます。
                </p>
                <Field label="CC 送信先（複数可・カンマ区切り）">
                  <Input
                    value={appSettings.EMAIL_CC || ""}
                    onChange={(e) => setField("EMAIL_CC", e.target.value)}
                    placeholder="cc1@example.co.jp, cc2@example.co.jp"
                  />
                </Field>
                <p className="text-[11px] font-mono text-muted-foreground -mt-1">
                  ※ メール送信時に常にこの宛先を CC します（複数可）。許可宛先を設定中は CC も許可宛先内である必要があります。
                </p>
              </div>

              <div className="border-t border-border pt-3 space-y-3">
                <p className="retro-tag">本文テンプレート（検収書）</p>
                <Field label="件名（検収書）">
                  <Input
                    value={appSettings.email_subject_inspection ?? ""}
                    onChange={(e) => setField("email_subject_inspection", e.target.value)}
                    placeholder="【検収書送付】{{documentNumber}}（{{vendorName}} 御中）"
                  />
                </Field>
                <Field label="本文（検収書）">
                  <Textarea
                    rows={6}
                    value={appSettings.email_body_inspection ?? ""}
                    onChange={(e) => setField("email_body_inspection", e.target.value)}
                    placeholder="{{vendorName}} 御中…"
                  />
                </Field>
                <p className="retro-tag">本文テンプレート（利用許諾料計算書）</p>
                <Field label="件名（計算書）">
                  <Input
                    value={appSettings.email_subject_royalty ?? ""}
                    onChange={(e) => setField("email_subject_royalty", e.target.value)}
                    placeholder="【利用許諾料計算書送付】{{documentNumber}}（{{vendorName}} 御中）"
                  />
                </Field>
                <Field label="本文（計算書）">
                  <Textarea
                    rows={6}
                    value={appSettings.email_body_royalty ?? ""}
                    onChange={(e) => setField("email_body_royalty", e.target.value)}
                    placeholder="{{vendorName}} 御中…"
                  />
                </Field>
                <p className="retro-tag">本文テンプレート（その他文書・発注書等）</p>
                <Field label="件名（その他文書）">
                  <Input
                    value={appSettings.email_subject_general ?? ""}
                    onChange={(e) => setField("email_subject_general", e.target.value)}
                    placeholder="【書類送付】{{documentNumber}}（{{vendorName}} 御中）"
                  />
                </Field>
                <Field label="本文（その他文書）">
                  <Textarea
                    rows={6}
                    value={appSettings.email_body_general ?? ""}
                    onChange={(e) => setField("email_body_general", e.target.value)}
                    placeholder="{{vendorName}} 御中…"
                  />
                </Field>
                <p className="text-[11px] font-mono text-muted-foreground -mt-1">
                  使用可能トークン: {"{{vendorName}}"} {"{{documentNumber}}"} {"{{amount}}"} {"{{date}}"} {"{{link}}"}（空欄なら既定テンプレを使用）
                </p>
              </div>

              <Button onClick={() => persist("メール設定")}>
                <Save />
                Apply
              </Button>
              <div className="pt-1">
                <EmailHealthButton />
              </div>
              <p className="text-[11px] font-mono text-muted-foreground -mt-1">
                ※ 接続テストは保存済みの設定で実行します（メールは送信されません）。送信には gws サービスアカウントへの gmail.send ドメイン全体委任が必要です。
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Database */}
        <TabsContent value="database" className="space-y-4">
          <Card>
            <CardContent className="px-5 space-y-3">
              <div className="flex items-center gap-2 border-b border-border pb-2.5">
                <Database className="h-4 w-4 text-amber-700" />
                <p className="retro-tag">Database hygiene</p>
              </div>
              <p className="text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground italic">
                Warning · manual overrides can break relational invariants.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <Button variant="destructive">Clear session cache</Button>
                <Button variant="outline">Resync assets</Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function StatusPill({ ok }: { ok: boolean }) {
  return ok ? (
    <Badge variant="success">
      <CheckCircle2 className="h-2.5 w-2.5" /> Configured
    </Badge>
  ) : (
    <Badge variant="outline">Env only</Badge>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      {children}
    </div>
  )
}

function SlackField({
  title,
  value,
  onChange,
  hint,
}: {
  title: string
  value: string
  onChange: (v: string) => void
  hint?: string
}) {
  return (
    <div className="space-y-1">
      <Label>{title}</Label>
      <Textarea
        rows={3}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="text-[11px]"
      />
      {hint && (
        <p className="text-[11px] font-mono text-muted-foreground italic">
          {hint}
        </p>
      )}
    </div>
  )
}

// CloudSign 接続テスト: 保存済み設定の client_id で /token を取得できるか確認する
//   (書類は送信しない)。結果(base / client_id / 有効化 / token取得可否)を表示。
function EmailHealthButton() {
  const [loading, setLoading] = React.useState(false)
  const [result, setResult] = React.useState<any>(null)
  const run = async () => {
    setLoading(true)
    setResult(null)
    try {
      const r = await fetch("/api/email/health", { credentials: "same-origin" })
      setResult(await r.json())
    } catch (e: any) {
      setResult({ ok: false, error: String(e?.message || e) })
    } finally {
      setLoading(false)
    }
  }
  return (
    <>
      <Button variant="outline" onClick={run} disabled={loading}>
        {loading ? "確認中…" : "接続テスト"}
      </Button>
      {result && (
        <div className="mt-2 w-full text-[11px] font-mono rounded-md border border-border p-2.5 space-y-0.5">
          <div>有効化: {String(result.enabled)}</div>
          <div className={result.ok ? "text-emerald-600" : "text-red-600"}>
            認証: {result.ok ? `OK ✓ (送信元: ${result.sender || "—"})` : `NG — ${result.error || "失敗"}`}
          </div>
        </div>
      )}
    </>
  )
}

function CloudSignHealthButton() {
  const [loading, setLoading] = React.useState(false)
  const [result, setResult] = React.useState<any>(null)
  const run = async () => {
    setLoading(true)
    setResult(null)
    try {
      const r = await fetch("/api/cloudsign/health", { credentials: "same-origin" })
      setResult(await r.json())
    } catch (e: any) {
      setResult({ ok: false, error: String(e?.message || e) })
    } finally {
      setLoading(false)
    }
  }
  const tokenOk = result?.token?.ok
  return (
    <>
      <Button variant="outline" onClick={run} disabled={loading}>
        {loading ? "確認中…" : "接続テスト"}
      </Button>
      {result && (
        <div className="mt-2 w-full text-[11px] font-mono rounded-md border border-border p-2.5 space-y-0.5">
          <div>base: {result.base || "—"}</div>
          <div>client_id: {result.client_id_masked || "未設定"}</div>
          <div>有効化: {String(result.enabled)} / 許可宛先: {result.allow_count ?? 0} 件</div>
          <div className={tokenOk ? "text-emerald-600" : "text-red-600"}>
            token取得: {tokenOk ? "OK ✓" : `NG — ${result?.token?.error || result?.error || "失敗"}`}
            {result?.token?.status ? ` (HTTP ${result.token.status})` : ""}
          </div>
        </div>
      )}
    </>
  )
}
