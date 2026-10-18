/**
 * SDR de IA — acompanhamento das conversas que a assistente virtual atendeu
 * no WhatsApp: quem passou ao comercial, descartados, encaminhados.
 * Configuração em Configurações → SDR de IA (Admin).
 */

import Link from 'next/link'
import { resolveTenantId } from '@/lib/tenant/context'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { getUserAccess } from '@/lib/auth/access'
import { readSdrSettings } from '@/lib/sdr/settings'
import { SdrConversations, type SdrRow } from '@/components/sdr/sdr-conversations'
import { fmtRatio } from '@/lib/format'

export const dynamic = 'force-dynamic'

// Agora em horário de Brasília (UTC-3)
const brasiliaNow = () => new Date(Date.now() - 3 * 3600_000)

export default async function SdrPage({ searchParams }: { searchParams: Promise<{ ano?: string; mes?: string }> }) {
  const sp = await searchParams
  const now = brasiliaNow()
  const y = Number(sp.ano), m = Number(sp.mes)
  const year = Number.isInteger(y) && y >= 2000 && y <= 2100 ? y : now.getUTCFullYear()
  const month = Number.isInteger(m) && m >= 1 && m <= 12 ? m : now.getUTCMonth() + 1
  // Mês em horário de Brasília (UTC-3)
  const from = new Date(Date.UTC(year, month - 1, 1, 3)).toISOString()
  const to = new Date(Date.UTC(year, month, 1, 3)).toISOString()

  const tenantId = await resolveTenantId()
  const db = await createScopedAdmin(tenantId)
  const [access, { data: org }, { data: rows }, { data: people }] = await Promise.all([
    getUserAccess(),
    db.from('organization_settings').select('sdr_settings').eq('tenant_id', tenantId).maybeSingle(),
    db.from('sdr_conversations')
      .select('id, phone, instance_name, status, contact_name, lead_id, assigned_to, answers, summary, end_reason, ai_replies, input_tokens, output_tokens, last_error, started_at, ended_at')
      .gte('started_at', from).lt('started_at', to).order('started_at', { ascending: false }).limit(500),
    db.from('profiles').select('id, full_name').eq('tenant_id', tenantId),
  ])
  const settings = readSdrSettings(org?.sdr_settings)
  const list = (rows ?? []) as SdrRow[]
  const count = (st: string) => list.filter(r => r.status === st).length
  const finished = list.filter(r => r.status !== 'active').length
  const handed = count('handed_off')
  const tokens = list.reduce((t, r) => t + (r.input_tokens ?? 0) + (r.output_tokens ?? 0), 0)
  const names = Object.fromEntries((people ?? []).map(p => [p.id as string, (p.full_name as string | null) ?? '—']))

  const prev = month === 1 ? { y: year - 1, m: 12 } : { y: year, m: month - 1 }
  const next = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 }
  const label = new Date(Date.UTC(year, month - 1, 15)).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' })

  const kpis = [
    { label: 'Conversas', value: String(list.length) },
    { label: 'Passadas ao comercial', value: String(handed), sub: `${fmtRatio(handed, finished)} das encerradas` },
    { label: 'Em conversa agora', value: String(count('active')) },
    { label: 'Encaminhadas ao time', value: String(count('routed') + count('human') + count('error')) },
    { label: 'Descartadas', value: String(count('disqualified')) },
    { label: 'Consumo de IA', value: `${tokens.toLocaleString('pt-BR')} tokens` },
  ]

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">SDR de IA</h1>
          <p className="text-sm text-gray-500">Conversas atendidas pela assistente virtual no WhatsApp e o que virou lead.</p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Link href={`/sdr?ano=${prev.y}&mes=${prev.m}`} className="rounded-md border border-gray-300 bg-white px-2 py-1 text-gray-700 hover:bg-gray-50">←</Link>
          <span className="min-w-[140px] text-center capitalize text-gray-800">{label}</span>
          <Link href={`/sdr?ano=${next.y}&mes=${next.m}`} className="rounded-md border border-gray-300 bg-white px-2 py-1 text-gray-700 hover:bg-gray-50">→</Link>
        </div>
      </div>

      {!settings.enabled && (
        <div className="rounded-lg border border-warn-600/40 bg-warn-100 px-4 py-3 text-sm text-warn-700">
          O SDR de IA está desligado.{' '}
          {access?.isAdmin
            ? <Link href="/settings/sdr" className="font-medium underline">Configurar e ligar</Link>
            : 'Peça ao Admin para configurar em Configurações → SDR de IA.'}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {kpis.map(k => (
          <div key={k.label} className="rounded-xl border border-gray-200 bg-white p-3">
            <p className="text-xs text-gray-500">{k.label}</p>
            <p className="mt-1 text-lg font-semibold text-gray-900">{k.value}</p>
            {k.sub && <p className="text-[11px] text-gray-500">{k.sub}</p>}
          </div>
        ))}
      </div>

      <SdrConversations rows={list} names={names} canSeeLeads={!!access?.features.includes('leads')} />
    </div>
  )
}
