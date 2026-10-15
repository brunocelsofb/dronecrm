'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { InternalEmailButton } from '@/components/activities/internal-email-button'
import { SentMessageDialog } from '@/components/activities/sent-message-dialog'
import { generateImplementationReportNow } from '@/lib/actions/internal-notices'

type Row = {
  id: string
  title: string | null
  content: string | null
  status: string | null
  activity_date: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}

export function ReportsList({ rows, isAdmin }: { rows: Row[]; isAdmin: boolean }) {
  const router = useRouter()
  const [generating, setGenerating] = useState(false)
  const [info, setInfo] = useState<string | null>(null)
  const [viewing, setViewing] = useState<Row | null>(null)

  async function generate() {
    setGenerating(true)
    setInfo(null)
    const r = await generateImplementationReportNow()
    setGenerating(false)
    setInfo(r.error ?? r.detail ?? 'Relatório gerado.')
    router.refresh()
  }

  return (
    <div className="space-y-3">
      {isAdmin && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={generate}
            disabled={generating}
            className="rounded-lg bg-[#1B556B] px-4 py-2 text-sm font-semibold text-white hover:bg-[#164659] disabled:opacity-50"
          >
            {generating ? 'Gerando…' : 'Gerar relatório agora'}
          </button>
          {info && <span className="text-sm text-gray-600">{info}</span>}
        </div>
      )}

      {rows.length === 0 ? (
        <p className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-500">
          Nenhum relatório ainda. O Farmer prepara um por mês, no dia configurado em Configurações → Agentes IA → Interno.
        </p>
      ) : (
        rows.map(r => {
          const md = (r.metadata ?? {}) as Record<string, unknown>
          const pending = md.approval === 'pending' && r.status !== 'done'
          const sent = md.approval === 'sent'
          return (
            <div key={r.id} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-gray-200 bg-white p-4">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900">{r.title}</p>
                <p className="mt-0.5 text-xs text-gray-500">{r.content}</p>
                {pending && typeof md.last_error === 'string' && md.last_error && (
                  <p role="alert" className="mt-1 text-xs text-red-700">⚠ Última tentativa falhou: {md.last_error}</p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {pending && (
                  <InternalEmailButton
                    activityId={r.id}
                    draft={String(md.draft_message ?? '')}
                    draftSubject={typeof md.draft_subject === 'string' ? md.draft_subject : null}
                    draftTo={Array.isArray(md.draft_to) ? (md.draft_to as string[]) : []}
                    draftCc={Array.isArray(md.draft_cc) ? (md.draft_cc as string[]) : []}
                  />
                )}
                {sent && (
                  <button onClick={() => setViewing(r)} className="rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700 underline">
                    Enviado — ver
                  </button>
                )}
                {!pending && !sent && <span className="text-xs text-gray-400">Encerrado</span>}
              </div>
            </div>
          )
        })
      )}

      {viewing && (
        <SentMessageDialog
          title={viewing.title ?? 'Relatório enviado'}
          metadata={(viewing.metadata ?? {}) as Record<string, unknown>}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  )
}
