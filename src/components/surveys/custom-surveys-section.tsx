'use client'

import { useState, useTransition } from 'react'
import { sendCustomSurvey, deletePendingSurveyResponse } from '@/lib/actions/custom-surveys'
import { SurveyShareButtons } from './survey-share-buttons'
import { CopyLinkButton } from '@/components/nps/copy-link-button'
import { ExpandableRow } from '@/components/surveys/expandable-row'
import { calculateResponseScore } from '@/lib/utils/survey-score'
import type { Question } from '@/lib/actions/custom-surveys'

type Template = { id: string; name: string; tag_id: string | null; questions: Question[] }
type SentSurvey = {
  id: string
  token: string
  status: string
  sent_at: string
  answered_at: string | null
  expires_at?: string | null
  respondent_name: string | null
  respondent_email?: string | null
  respondent_phone?: string | null
  template_id: string
  responses: Record<string, string | string[]> | null
}

function formatAnswer(value: string | string[] | undefined) {
  if (!value) return '—'
  if (Array.isArray(value)) return value.length ? value.join(', ') : '—'
  return value
}

// PERFORMANCE: também virou apresentacional — mesma lógica do NpsSection.
function SendSurveyButton({ contractId, template }: { contractId: string; template: Template }) {
  const [open, setOpen] = useState(false)
  const [hasExpiry, setHasExpiry] = useState(false)
  const [expiresAt, setExpiresAt] = useState('')
  const [sending, setSending] = useState(false)

  async function handleSend() {
    setSending(true)
    await sendCustomSurvey(contractId, template.id, hasExpiry && expiresAt ? expiresAt : null)
    setSending(false)
    setOpen(false)
    setHasExpiry(false)
    setExpiresAt('')
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="rounded-md border border-brand-700 px-3 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-100">
        + Enviar &quot;{template.name}&quot;
      </button>
    )
  }

  return (
    <div className="rounded-lg border border-brand-700/30 bg-brand-50/30 p-3 space-y-2 w-full">
      <p className="text-xs font-semibold text-brand-800">{template.name}</p>
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={hasExpiry} onChange={e => setHasExpiry(e.target.checked)}
          className="rounded border-gray-300 text-brand-700" />
        <span className="text-xs text-gray-600">Estipular prazo limite para resposta?</span>
      </label>
      {hasExpiry && (
        <div>
          <label className="block text-xs text-gray-500 mb-1">Data de encerramento</label>
          <input type="datetime-local" value={expiresAt} onChange={e => setExpiresAt(e.target.value)}
            className="rounded-md border border-gray-300 px-2 py-1 text-xs focus:border-brand-700 focus:outline-none" />
        </div>
      )}
      <div className="flex gap-2">
        <button onClick={handleSend} disabled={sending || (hasExpiry && !expiresAt)}
          className="rounded-md bg-brand-700 px-3 py-1 text-xs font-medium text-white hover:bg-brand-800 disabled:opacity-50">
          {sending ? 'Enviando...' : 'Confirmar envio'}
        </button>
        <button onClick={() => setOpen(false)}
          className="rounded-md border border-gray-300 px-3 py-1 text-xs text-gray-600 hover:bg-gray-50">
          Cancelar
        </button>
      </div>
    </div>
  )
}

export function CustomSurveysSection({
  contractId,
  templates,
  allTemplates,
  sentSurveys,
  linkBase,
  isAdmin = false,
}: {
  contractId: string
  templates: Template[]
  allTemplates: Template[]
  sentSurveys: SentSurvey[]
  linkBase: string
  isAdmin?: boolean
}) {
  // IMPORTANTE: o mapa usado para EXIBIR respostas já enviadas usa a
  // lista COMPLETA de formulários (allTemplates), não a lista filtrada
  // por tag (templates) — senão, se a tag do contrato mudar depois que
  // uma pesquisa foi respondida, o formulário "some" da exibição mesmo
  // a resposta já existindo. O filtro por tag só vale pra decidir quais
  // botões de "+ Enviar" aparecem, nunca pra esconder histórico.
  const templateById = new Map(allTemplates.map((t) => [t.id, t]))
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleDelete(id: string) {
    if (!confirm('Deseja realmente excluir esta pesquisa pendente? O link gerado será invalidado.')) return
    setDeletingId(id)
    setDeleteError(null)
    startTransition(async () => {
      const res = await deletePendingSurveyResponse(id)
      setDeletingId(null)
      if (res.error) setDeleteError(res.error)
      // se success, revalidatePath no server já vai remover da lista
    })
  }

  if (templates.length === 0 && sentSurveys.length === 0) {
    return (
      <div className="space-y-2">
        <h2 className="text-sm font-medium text-gray-900">Formulários de Pesquisa</h2>
        <p className="text-sm text-gray-400">
          Nenhum formulário disponível para este contrato — crie um em Configurações → Formulários (ou confira se a tag do contrato bate com a do formulário).
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-medium text-gray-900">Formulários de Pesquisa</h2>

      <div className="flex flex-wrap gap-2">
        {templates.map((t) => (
          <SendSurveyButton key={t.id} contractId={contractId} template={t} />
        ))}
      </div>

      <div className="space-y-2">
        {deleteError && (
          <p className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">{deleteError}</p>
        )}
        {sentSurveys.map((s) => {
          const link = `${linkBase}/survey/${s.token}`
          const template = templateById.get(s.template_id)
          const templateName = template?.name ?? 'Formulário'
          const questions = template?.questions ?? []
          const score = s.status === 'answered' ? calculateResponseScore(questions, s.responses) : null

          if (s.status === 'pending') {
            const isExpired = s.expires_at ? new Date(s.expires_at) < new Date() : false
            return (
              <div key={s.id} className={`rounded-lg border bg-white p-3 text-sm ${isExpired ? 'border-gray-200 opacity-70' : 'border-gray-200'}`}>
                <div className="flex items-center justify-between">
                  <span className="font-medium text-gray-900">{templateName}</span>
                  <div className="flex items-center gap-1.5">
                    {isExpired
                      ? <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500">Expirada</span>
                      : <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-[11px] font-medium text-yellow-800">Pendente</span>
                    }
                    {s.expires_at && (
                      <span className="text-[10px] text-gray-400">
                        {isExpired ? 'Encerrada em' : 'Expira em'} {new Date(s.expires_at).toLocaleDateString('pt-BR')}
                      </span>
                    )}
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <input readOnly value={link} className="flex-1 truncate rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-500" />
                  {!isExpired && <CopyLinkButton link={link} />}
                  {!isExpired && (
                    <SurveyShareButtons
                      link={link}
                      expiresAt={s.expires_at}
                      surveyName={templateName}
                    />
                  )}
                  {isAdmin && (
                    <button type="button" disabled={deletingId === s.id || isPending}
                      onClick={() => handleDelete(s.id)}
                      className="rounded-md border border-red-200 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-40">
                      {deletingId === s.id ? 'Excluindo...' : '🗑 Excluir'}
                    </button>
                  )}
                </div>
              </div>
            )
          }

          return (
            <ExpandableRow
              key={s.id}
              summary={
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-gray-900">{templateName}</span>
                    {score !== null && (
                      <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[11px] font-medium text-brand-700">
                        {score.scale === 'likert' ? 'Satisfação' : 'Nota'} {score.value}/{score.max}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-gray-500">
                    Respondido por <span className="font-medium text-gray-700">{s.respondent_name}</span> em{' '}
                    {s.answered_at ? new Date(s.answered_at).toLocaleDateString('pt-BR') : '—'}
                  </p>
                </div>
              }
            >
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <p className="text-gray-400">Respondente</p>
                  <p className="text-gray-700">{s.respondent_name ?? '—'}</p>
                </div>
                <div>
                  <p className="text-gray-400">E-mail / Telefone</p>
                  <p className="text-gray-700">{[s.respondent_email, s.respondent_phone].filter(Boolean).join(' · ') || '—'}</p>
                </div>
                <div>
                  <p className="text-gray-400">Enviada em</p>
                  <p className="text-gray-700">{new Date(s.sent_at).toLocaleDateString('pt-BR')}</p>
                </div>
                <div>
                  <p className="text-gray-400">Respondida em</p>
                  <p className="text-gray-700">{s.answered_at ? new Date(s.answered_at).toLocaleDateString('pt-BR') : '—'}</p>
                </div>
              </div>

              <div className="space-y-2 border-t border-gray-100 pt-2">
                {questions.map((q) => (
                  <div key={q.id}>
                    <p className="text-xs font-medium text-gray-500">{q.label}</p>
                    <p className="text-sm text-gray-700">{formatAnswer(s.responses?.[q.id])}</p>
                  </div>
                ))}
              </div>
            </ExpandableRow>
          )
        })}
      </div>
    </div>
  )
}
