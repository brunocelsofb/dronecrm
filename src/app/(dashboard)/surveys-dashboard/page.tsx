import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { PeriodSelector } from '@/components/dashboard/period-selector'
import { ExpandableRow } from '@/components/surveys/expandable-row'
import { NpsCharts } from '@/components/dashboard/nps-charts'
import { ExportReportButton } from '@/components/surveys/export-report-button'
import { BulkSurveyDispatch } from '@/components/surveys/bulk-survey-dispatch'
import { calculateNps, categorizeScore } from '@/lib/utils/nps'
import { calculateResponseScore, calculateAverageScore, extractNpsScore, averageNpsScore } from '@/lib/utils/survey-score'
import type { Question } from '@/lib/actions/custom-surveys'
import { WhatsAppNpsTab } from '@/components/whatsapp/whatsapp-nps-tab'

const NPS_CATEGORY_LABELS = { promoter: 'Promotor', passive: 'Neutro', detractor: 'Detrator' } as const
const NPS_CATEGORY_STYLE = {
  promoter: { bg: '#eaf5ee', color: '#1a7c3e' },
  passive:  { bg: '#fff8e6', color: '#92400e' },
  detractor:{ bg: '#fdecea', color: '#b91c1c' },
} as const

function currentQuarterRange() {
  const now = new Date()
  const quarter = Math.floor(now.getMonth() / 3)
  const from = new Date(now.getFullYear(), quarter * 3, 1)
  const to = new Date(now.getFullYear(), quarter * 3 + 3, 0)
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) }
}

export default async function SurveysDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; template?: string; from?: string; to?: string; tag?: string }>
}) {
  const params = await searchParams
  const tab = params.tab === 'surveys' ? 'surveys' : params.tab === 'whatsapp_nps' ? 'whatsapp_nps' : 'nps'
  const defaultRange = currentQuarterRange()
  const from = params.from ?? defaultRange.from
  const to = params.to ?? defaultRange.to
  const supabase = await createClient()

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Pesquisas & NPS</h1>
          <p className="text-sm text-gray-500">Satisfação dos clientes consolidada por período. <span className="print:inline hidden font-medium text-[#1B556B]">Período: {from} a {to}</span></p>
        </div>
        <ExportReportButton from={from} to={to} tab={tab} />
      </div>

      {/* Cabeçalho visível apenas na impressão */}
      <div className="hidden print:block border-b-4 border-[#E98C5F] pb-4 mb-4">
        <h1 className="text-2xl font-bold text-[#1B556B]">Relatório de Satisfação — ORBIS Engenharia</h1>
        <p className="text-sm text-gray-500">Período: {from} a {to} · Gerado em {new Date().toLocaleDateString('pt-BR')}</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-0.5 border-b border-gray-200">
        {[
          { label: 'NPS', value: 'nps' },
          { label: 'Pesquisas Customizadas', value: 'surveys' },
          { label: '📱 NPS Atendimento WhatsApp', value: 'whatsapp_nps' },
        ].map(t => (
          <Link key={t.value} href={`/surveys-dashboard?tab=${t.value}&from=${from}&to=${to}`}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors no-underline ${
              tab === t.value ? 'border-[#1B556B] text-[#1B556B]' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            {t.label}
          </Link>
        ))}
      </div>

      {tab === 'nps' ? (
        <NpsTab supabase={supabase} from={from} to={to} selectedTagId={params.tag ?? 'all'} />
      ) : tab === 'whatsapp_nps' ? (
        <WhatsAppNpsTab />
      ) : (
        <SurveysTab supabase={supabase} from={from} to={to} selectedTemplateId={params.template} />
      )}
    </div>
  )
}

async function NpsTab({ supabase, from, to, selectedTagId }: {
  supabase: Awaited<ReturnType<typeof createClient>>; from: string; to: string; selectedTagId: string
}) {
  const [{ data: surveysRaw }, { data: allTags }] = await Promise.all([
    supabase.from('nps_surveys').select('id, contract_id, score, comment, answered_at, respondent_name, respondent_email, respondent_phone').eq('status', 'answered').gte('answered_at', `${from}T00:00:00`).lte('answered_at', `${to}T23:59:59`).order('answered_at', { ascending: false }),
    supabase.from('tags').select('id, name, color').order('name'),
  ])

  const allContractIds = [...new Set((surveysRaw ?? []).map(s => s.contract_id))]
  const [{ data: contracts }, { data: contractTagRows }] = await Promise.all([
    allContractIds.length ? supabase.from('contracts').select('id, client_name, company_id, contact_id').in('id', allContractIds) : Promise.resolve({ data: [] as any[] }),
    allContractIds.length ? supabase.from('contract_tags').select('contract_id, tag_id').in('contract_id', allContractIds) : Promise.resolve({ data: [] as any[] }),
  ])

  const contractById = new Map((contracts ?? []).map((c: any) => [c.id, c]))
  const tagIdByContract = new Map((contractTagRows ?? []).map((r: any) => [r.contract_id, r.tag_id]))
  const tagById = new Map((allTags ?? []).map(t => [t.id, t]))

  const surveys = (surveysRaw ?? []).filter(s => {
    if (selectedTagId === 'all') return true
    const contractTagId = tagIdByContract.get(s.contract_id) ?? null
    if (selectedTagId === 'none') return !contractTagId
    return contractTagId === selectedTagId
  })

  const contractIds = [...new Set(surveys.map(s => s.contract_id))]
  const companyIds = [...new Set(contractIds.map(id => contractById.get(id)?.company_id).filter((v): v is string => !!v))]
  const contactIds = [...new Set(contractIds.map(id => contractById.get(id)?.contact_id).filter((v): v is string => !!v))]

  const [{ data: companies }, { data: contacts }] = await Promise.all([
    companyIds.length ? supabase.from('companies').select('id, name, trade_name, cnpj').in('id', companyIds) : Promise.resolve({ data: [] as any[] }),
    contactIds.length ? supabase.from('contacts').select('id, name').in('id', contactIds) : Promise.resolve({ data: [] as any[] }),
  ])

  const companyById = new Map((companies ?? []).map((c: any) => [c.id, c]))
  const contactById = new Map((contacts ?? []).map((c: any) => [c.id, c]))
  const scores = surveys.map(s => s.score).filter((s): s is number => s !== null)
  const { nps, promoters, passives, detractors, total } = calculateNps(scores)

  const history = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date()
    d.setMonth(d.getMonth() - i)
    const mFrom = new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10)
    const mTo = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10)
    const { data: mSurveys } = await supabase.from('nps_surveys').select('score').eq('status', 'answered').gte('answered_at', `${mFrom}T00:00:00`).lte('answered_at', `${mTo}T23:59:59`)
    const mScores = (mSurveys ?? []).map((s: any) => s.score).filter((s: any): s is number => s !== null)
    const { nps: mNps } = calculateNps(mScores)
    history.push({ month: d.toLocaleDateString('pt-BR', { month: 'short' }), nps: mNps, total: mScores.length })
  }

  function tagFilterHref(tagId: string) {
    return `/surveys-dashboard?tab=nps&from=${from}&to=${to}&tag=${tagId}`
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex gap-1.5 flex-wrap">
          {[{ id: 'all', name: 'Todas as tags', color: '#1a1f36' }, ...(allTags ?? []), { id: 'none', name: 'Sem tag', color: '#1a1f36' }].map((t: any) => (
            <a key={t.id} href={tagFilterHref(t.id)}
              className="no-underline rounded-full px-3 py-0.5 text-xs border transition-colors"
              style={{ borderColor: selectedTagId === t.id ? t.color : '#d1d8e8', background: selectedTagId === t.id ? t.color : '#fff', color: selectedTagId === t.id ? '#fff' : '#8892a4' }}>
              {t.name}
            </a>
          ))}
        </div>
        <PeriodSelector from={from} to={to} basePath="/surveys-dashboard" extraParams={{ tab: 'nps', tag: selectedTagId }} />
      </div>

      <NpsCharts nps={nps} promoters={promoters} passives={passives} detractors={detractors} total={total} history={history} />

      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100">
          <p className="text-sm font-medium text-gray-900">Respostas individuais</p>
          <p className="text-xs text-gray-400">{total} resposta{total !== 1 ? 's' : ''} no período</p>
        </div>
        <div className="px-4 pb-2">
          {surveys.map(s => {
            const contract = contractById.get(s.contract_id)
            const company = contract?.company_id ? companyById.get(contract.company_id) : null
            const contact = contract?.contact_id ? contactById.get(contract.contact_id) : null
            const category = s.score !== null ? categorizeScore(s.score) : null
            const tag = tagById.get(tagIdByContract.get(s.contract_id) ?? '')
            const catSt = category ? NPS_CATEGORY_STYLE[category] : null
            return (
              <ExpandableRow key={s.id} summary={
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-gray-900">{company?.name ?? contract?.client_name ?? '—'}</span>
                      {tag && <span className="rounded-full px-2 py-0.5 text-[10px] font-medium text-white" style={{ background: (tag as any).color }}>{(tag as any).name}</span>}
                      {category && catSt && <span className="rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ background: catSt.bg, color: catSt.color }}>{NPS_CATEGORY_LABELS[category]} — {s.score}</span>}
                    </div>
                    <p className="text-xs text-gray-400">{s.respondent_name ?? (contact as any)?.name ?? '—'} · {s.answered_at ? new Date(s.answered_at).toLocaleDateString('pt-BR') : '—'}</p>
                  </div>
                </div>
              }>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div><p className="text-gray-400">CNPJ</p><p className="font-mono text-gray-700">{(company as any)?.cnpj ?? '—'}</p></div>
                  <div><p className="text-gray-400">E-mail / Telefone</p><p className="text-gray-700">{[s.respondent_email, s.respondent_phone].filter(Boolean).join(' · ') || '—'}</p></div>
                </div>
                {s.comment && <div className="mt-2"><p className="text-[10px] text-gray-400 mb-1">Comentário</p><p className="text-sm text-gray-600 italic">&ldquo;{s.comment}&rdquo;</p></div>}
              </ExpandableRow>
            )
          })}
          {surveys.length === 0 && <p className="py-8 text-center text-sm text-gray-400">Nenhuma resposta de NPS neste período.</p>}
        </div>
      </div>
    </div>
  )
}

async function SurveysTab({ supabase, from, to, selectedTemplateId }: {
  supabase: Awaited<ReturnType<typeof createClient>>; from: string; to: string; selectedTemplateId?: string
}) {
  const admin = createAdminClient()

  const [{ data: templates }, { data: tags }] = await Promise.all([
    supabase.from('survey_templates').select('id, name, questions, target_type, target_tag_id').order('name'),
    supabase.from('tags').select('id, name').order('name'),
  ])

  const templateId = selectedTemplateId ?? templates?.[0]?.id
  const selectedTemplate = templates?.find(t => t.id === templateId)
  const questions = (selectedTemplate?.questions ?? []) as Question[]

  const { data: allDispatched } = templateId
    ? await admin.from('custom_surveys')
        .select('id, status, answered_at, expires_at, contract_id')
        .eq('template_id', templateId)
    : { data: [] as any[] }

  const now = new Date()
  const fromDate = new Date(`${from}T00:00:00`)
  const toDate = new Date(`${to}T23:59:59`)

  const totalSent = (allDispatched ?? []).length
  const answered = (allDispatched ?? []).filter((s: any) => s.status === 'answered')
  const answeredInPeriod = answered.filter((s: any) => {
    if (!s.answered_at) return false
    const d = new Date(s.answered_at)
    return d >= fromDate && d <= toDate
  })
  const answeredInTime = answeredInPeriod.filter((s: any) =>
    !s.expires_at || new Date(s.answered_at) <= new Date(s.expires_at)
  )
  const pending = (allDispatched ?? []).filter((s: any) => s.status === 'pending' && (!s.expires_at || new Date(s.expires_at) >= now))
  const expired = (allDispatched ?? []).filter((s: any) => s.status === 'pending' && s.expires_at && new Date(s.expires_at) < now)
  const responseRate = totalSent > 0 ? Math.round((answeredInPeriod.length / totalSent) * 100) : 0

  const { data: responses } = templateId
    ? await admin.from('custom_surveys').select('id, respondent_name, respondent_email, respondent_phone, contract_id, responses, answered_at, expires_at').eq('template_id', templateId).eq('status', 'answered').gte('answered_at', `${from}T00:00:00`).lte('answered_at', `${to}T23:59:59`).order('answered_at', { ascending: false })
    : { data: [] as any[] }

  const contractIds = [...new Set((responses ?? []).map((r: any) => r.contract_id))]
  const { data: contracts } = contractIds.length ? await supabase.from('contracts').select('id, client_name, process_number').in('id', contractIds) : { data: [] as any[] }
  const contractById = new Map((contracts ?? []).map((c: any) => [c.id, c]))

  const responsesWithScore = (responses ?? []).map((r: any) => {
    const score = calculateResponseScore(questions, r.responses)
    const npsScore = extractNpsScore(questions, r.responses ?? {})
    const isDetractor = score
      ? (String(score.scale).toLowerCase() === 'nps' && score.value <= 6) ||
        (String(score.scale).toLowerCase() === 'likert' && score.value <= 2)
      : npsScore !== null && npsScore <= 6
    return { ...r, score, npsScore, isDetractor }
  })
  const averageScore = calculateAverageScore(responsesWithScore.map((r: any) => r.score))
  const avgNps = averageNpsScore(responsesWithScore.map((r: any) => r.npsScore))

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex gap-1.5 flex-wrap">
          {templates?.map(t => (
            <a key={t.id} href={`/surveys-dashboard?tab=surveys&template=${t.id}&from=${from}&to=${to}`}
              className={`rounded-full px-3 py-0.5 text-xs border no-underline transition-colors ${
                t.id === templateId ? 'bg-[#1B556B] border-[#1B556B] text-white' : 'bg-white border-gray-200 text-gray-500 hover:border-gray-400'
              }`}>
              {t.name}
            </a>
          ))}
          {(!templates || templates.length === 0) && <p className="text-xs text-gray-400">Nenhum formulário criado ainda.</p>}
        </div>
        <BulkSurveyDispatch templates={templates ?? []} tags={tags ?? []} />
      </div>

      {templateId && (
        <>
          <PeriodSelector from={from} to={to} basePath="/surveys-dashboard" extraParams={{ tab: 'surveys', template: templateId }} />

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Enviadas', value: totalSent, sub: 'total de disparos', color: '#1B556B' },
              { label: 'Respondidas', value: answeredInPeriod.length, sub: `${answeredInTime.length} dentro do prazo`, color: '#32AF9D' },
              { label: 'Taxa de resposta', value: `${responseRate}%`, sub: 'respondidas / enviadas', color: responseRate >= 70 ? '#1a7c3e' : responseRate >= 40 ? '#92400e' : '#b91c1c' },
              { label: 'Pendentes / Expiradas', value: `${pending.length} / ${expired.length}`, sub: 'aguardando · vencidas', color: '#8892a4' },
            ].map(k => (
              <div key={k.label} className="rounded-xl border border-gray-200 bg-white p-4">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1">{k.label}</p>
                <p className="text-xl font-bold" style={{ color: k.color }}>{k.value}</p>
                <p className="text-[11px] text-gray-400 mt-0.5">{k.sub}</p>
              </div>
            ))}
          </div>

          {(averageScore || avgNps !== null) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {averageScore && (
                <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 flex items-center gap-3">
                  <div className="flex-1">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Pontuação média (Likert)</p>
                    <p className="text-lg font-bold text-[#1B556B]">{averageScore.value} / {averageScore.max}</p>
                  </div>
                  <div className="flex-1">
                    <p className="text-xs text-gray-400">{selectedTemplate?.name} · {questions.length} pergunta{questions.length !== 1 ? 's' : ''}</p>
                  </div>
                </div>
              )}
              {avgNps !== null && (
                <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 flex items-center gap-3">
                  <div className="flex-1">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Média NPS do formulário</p>
                    <p className={`text-lg font-bold ${avgNps <= 6 ? 'text-red-600' : avgNps <= 8 ? 'text-amber-500' : 'text-emerald-600'}`}>
                      {avgNps} / 10
                    </p>
                  </div>
                  <div className="flex-1">
                    <p className="text-xs text-gray-400">
                      {avgNps <= 6 ? '⚠️ Zona de risco' : avgNps <= 8 ? '😐 Zona neutra' : '✓ Zona de excelência'}
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="flex gap-1.5 flex-wrap">
            {[
              { value: 'all', label: 'Todas as respostas' },
              { value: 'detractor', label: '🚨 Detratores' },
              { value: 'promoter', label: '✓ Promotores' },
            ].map(f => (
              <a key={f.value}
                href={`/surveys-dashboard?tab=surveys&template=${templateId}&from=${from}&to=${to}&filter=${f.value}`}
                className="rounded-full px-3 py-0.5 text-xs border no-underline transition-colors bg-white border-gray-200 text-gray-600 hover:border-gray-400">
                {f.label}
              </a>
            ))}
          </div>

          <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100">
              <p className="text-sm font-medium text-gray-900">Respostas individuais</p>
              <p className="text-xs text-gray-400">{responsesWithScore.length} resposta{responsesWithScore.length !== 1 ? 's' : ''} no período</p>
            </div>
            <div className="px-4 pb-2">
              {responsesWithScore.map((r: any) => {
                const contract = contractById.get(r.contract_id)
                const inTime = !r.expires_at || new Date(r.answered_at) <= new Date(r.expires_at)
                const likertBadge = r.score
                  ? { label: r.isDetractor ? `🚨 Satisfação ${r.score.value}/${r.score.max} (Atenção)` : `Satisfação ${r.score.value}/${r.score.max}`, cls: r.isDetractor ? 'bg-red-600 text-white' : r.score.value >= 4 ? 'bg-green-100 text-green-800' : 'bg-blue-50 text-blue-700' }
                  : null
                const npsBadge = r.npsScore !== null
                  ? { label: `NPS: ${r.npsScore}/10 · ${r.npsScore <= 6 ? 'Detrator' : r.npsScore <= 8 ? 'Neutro' : 'Promotor'}`, cls: r.npsScore <= 6 ? 'bg-red-600 text-white' : r.npsScore <= 8 ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800' }
                  : null
                return (
                  <ExpandableRow key={r.id} summary={
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-gray-900">{r.respondent_name}</span>
                        {likertBadge && <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${likertBadge.cls}`}>{likertBadge.label}</span>}
                        {npsBadge && <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${npsBadge.cls}`}>{npsBadge.label}</span>}
                        {!inTime && <span className="rounded-full px-2 py-0.5 text-[10px] font-medium bg-amber-50 text-amber-700">Fora do prazo</span>}
                      </div>
                      <p className="text-xs text-gray-400">
                        {contract ? `${contract.client_name} · ${contract.process_number}` : '—'} · {r.answered_at ? new Date(r.answered_at).toLocaleDateString('pt-BR') : '—'}
                      </p>
                    </div>
                  }>
                    <div className="grid grid-cols-2 gap-2 text-xs mb-2">
                      <div><p className="text-gray-400">E-mail / Telefone</p><p className="text-gray-700">{[r.respondent_email, r.respondent_phone].filter(Boolean).join(' · ') || '—'}</p></div>
                      {r.expires_at && <div><p className="text-gray-400">Prazo da pesquisa</p><p className="text-gray-700">{new Date(r.expires_at).toLocaleDateString('pt-BR')}</p></div>}
                    </div>
                    <div className="border-t border-gray-100 pt-2 space-y-2">
                      {questions.map((q: Question) => {
                        const answer = (r.responses as any)?.[q.id]
                        const display = Array.isArray(answer) ? (answer.length ? answer.join(', ') : '—') : (answer || '—')
                        return <div key={q.id}><p className="text-[10px] text-gray-400">{q.label}</p><p className="text-sm text-gray-700">{display}</p></div>
                      })}
                    </div>
                  </ExpandableRow>
                )
              })}
              {responsesWithScore.length === 0 && <p className="py-8 text-center text-sm text-gray-400">Nenhuma resposta neste período.</p>}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
