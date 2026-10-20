import { redirect } from 'next/navigation'
import { getUserAccess } from '@/lib/auth/access'
import { resolveTenantId } from '@/lib/tenant/context'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { createRawAdminClient } from '@/lib/supabase/admin'
import { getSupportSession } from '@/lib/tenant/support'
import { dpaControllerOf, dpaStatus } from '@/lib/legal/dpa-data'
import { DPA_VERSION } from '@/lib/legal/dpa'
import { resolvePrivacySettings } from '@/lib/privacy/settings'
import { SettingsSubpage } from '@/components/settings/settings-subpage'
import { DpaDocument } from '@/components/legal/dpa-document'
import { DpaAcceptForm, SupportAccessPanel, RetentionForm } from '@/components/settings/privacy-forms'
import { fmtPct } from '@/lib/format'

export const dynamic = 'force-dynamic'

const fmt = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
const ACTION: Record<string, string> = { start: 'Entrou', view: 'Viu a tela', action: 'Ação (bloqueada se gravava)', write_blocked: 'Tentou gravar (bloqueado)', stop: 'Saiu', reset: 'Resetou o CRM' }

export default async function PrivacyPage() {
  const access = await getUserAccess()
  if (!access?.isAdmin) redirect('/settings')
  const tenantId = await resolveTenantId()
  const db = await createScopedAdmin(tenantId)
  const raw = createRawAdminClient()
  const support = await getSupportSession()
  const nowIso = new Date().toISOString()

  const [controller, dpa, { data: org }, { data: grants }, { data: log }, total, sealed] = await Promise.all([
    dpaControllerOf(tenantId),
    dpaStatus(tenantId),
    db.from('organization_settings').select('privacy_settings').eq('tenant_id', tenantId).maybeSingle(),
    db.from('support_access_grants').select('id, reason, starts_at, expires_at, revoked_at, granted_by, created_at').order('created_at', { ascending: false }).limit(20),
    db.from('support_access_log').select('id, actor_name, action, path, detail, created_at').order('created_at', { ascending: false }).limit(150),
    raw.from('contract_whatsapp_messages').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).not('message', 'is', null).neq('message', ''),
    raw.from('contract_whatsapp_messages').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).like('message', 'enc:v1%'),
  ])
  const privacy = resolvePrivacySettings((org as { privacy_settings?: unknown } | null)?.privacy_settings)
  const granterIds = [...new Set((grants ?? []).map(g => g.granted_by).filter(Boolean))] as string[]
  const { data: granters } = granterIds.length ? await db.from('profiles').select('id, full_name').in('id', granterIds) : { data: [] as { id: string; full_name: string | null }[] }
  const nameOf = new Map((granters ?? []).map(p => [p.id as string, (p.full_name as string | null) ?? '—']))
  const grantRows = (grants ?? []).map(g => ({
    id: g.id as string, reason: (g.reason as string | null) ?? '', expiresAt: g.expires_at as string, createdAt: g.created_at as string,
    by: g.granted_by ? nameOf.get(g.granted_by as string) ?? '—' : '—',
    state: g.revoked_at ? 'revogada' : (g.expires_at as string) > nowIso && (g.starts_at as string) <= nowIso ? 'ativa' : 'encerrada',
  }))
  const totalN = total.count ?? 0, sealedN = sealed.count ?? 0

  return (
    <SettingsSubpage title="Privacidade e dados" description="Contrato de tratamento de dados, acesso de suporte da plataforma, retenção e criptografia das mensagens.">
      {support && (
        <p className="mb-4 rounded-lg bg-warn-100 px-4 py-2 text-sm text-warn-700">Você está em acesso de suporte (só leitura): nada aqui pode ser alterado.</p>
      )}

      <section className="mb-6 rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-gray-900">1. Contrato de tratamento de dados (LGPD)</h2>
        <p className="mt-1 text-xs text-gray-500">Diz o que a plataforma acessa dos seus dados e para quê. Sua empresa é a controladora; a plataforma, a operadora.</p>
        {dpa.current ? (
          <p className="mt-3 rounded-lg bg-positive-100 px-3 py-2 text-sm text-positive-700">
            Versão {DPA_VERSION} aceita por {dpa.current.accepted_by_name ?? dpa.current.accepted_by_email ?? '—'} em {fmt(dpa.current.accepted_at)}.
          </p>
        ) : (
          <p className="mt-3 rounded-lg bg-warn-100 px-3 py-2 text-sm text-warn-700">
            {dpa.list.length ? `A versão ${DPA_VERSION} ainda não foi aceita (houve mudança no texto).` : 'Contrato ainda não aceito.'} Leia abaixo e aceite em nome da empresa.
          </p>
        )}
        <details className="mt-3" open={!dpa.current}>
          <summary className="cursor-pointer text-sm font-medium text-brand-700">Ler o contrato</summary>
          <div className="mt-3 max-h-[28rem] overflow-auto rounded-lg border border-gray-100 p-4"><DpaDocument controller={controller} /></div>
        </details>
        {!controller.cnpj && <p className="mt-2 text-xs text-warn-700">Razão social e CNPJ entram no contrato a partir de Configurações → Dados da empresa. O CNPJ ainda não está preenchido.</p>}
        {!dpa.current && !support && <DpaAcceptForm />}
        {dpa.list.length > 0 && (
          <p className="mt-3 text-[11px] text-gray-400">
            Histórico: {dpa.list.map(a => `v${a.version} — ${a.accepted_by_name ?? a.accepted_by_email ?? '—'} em ${fmt(a.accepted_at)}${a.ip ? ` (IP ${a.ip})` : ''}`).join(' · ')}
          </p>
        )}
      </section>

      <section className="mb-6 rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-gray-900">2. Acesso de suporte da plataforma</h2>
        <p className="mt-1 text-xs text-gray-500">
          A equipe da plataforma não vê o conteúdo da sua empresa, só números de uso. Para um atendimento, libere o acesso por um tempo:
          ele é só leitura e cada tela vista fica registrada abaixo. Dá para revogar a qualquer momento.
        </p>
        <SupportAccessPanel grants={grantRows} readOnly={!!support} />
        <h3 className="mt-5 text-xs font-semibold uppercase tracking-wide text-gray-500">Registro de acessos</h3>
        {(log ?? []).length === 0 ? <p className="mt-1 text-sm text-gray-400">Nenhum acesso da plataforma até agora.</p> : (
          <div className="mt-2 max-h-80 overflow-auto rounded-lg border border-gray-100">
            <table className="min-w-full divide-y divide-gray-100 text-xs">
              <thead className="bg-gray-50"><tr>
                <th className="px-3 py-2 text-left font-medium text-gray-500">Quando</th>
                <th className="px-3 py-2 text-left font-medium text-gray-500">Quem</th>
                <th className="px-3 py-2 text-left font-medium text-gray-500">O quê</th>
                <th className="px-3 py-2 text-left font-medium text-gray-500">Tela / detalhe</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-50">
                {(log ?? []).map(l => (
                  <tr key={l.id as string}>
                    <td className="whitespace-nowrap px-3 py-1.5 text-gray-600">{fmt(l.created_at as string)}</td>
                    <td className="px-3 py-1.5 text-gray-700">{(l.actor_name as string | null) ?? 'Suporte da plataforma'}</td>
                    <td className="px-3 py-1.5 text-gray-700">{ACTION[l.action as string] ?? (l.action as string)}</td>
                    <td className="px-3 py-1.5 font-mono text-[11px] text-gray-500">{(l.path as string | null) ?? (l.detail as string | null) ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mb-6 rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-gray-900">3. Retenção das mensagens de WhatsApp</h2>
        <p className="mt-1 text-xs text-gray-500">Mensagens mais antigas que o prazo são apagadas sozinhas todo dia (texto e o registro do áudio/arquivo no CRM). Notas já salvas nas oportunidades ficam.</p>
        <RetentionForm initial={privacy.whatsapp_retention_days} readOnly={!!support} />
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-gray-900">4. Criptografia</h2>
        <p className="mt-1 text-xs text-gray-500">Mensagens de WhatsApp e conversas da assistente virtual ficam guardadas criptografadas com uma chave só da sua empresa.</p>
        <p className="mt-3 text-sm text-gray-700">
          {totalN === 0 ? 'Nenhuma mensagem guardada.' : <>{sealedN} de {totalN} mensagens já criptografadas ({fmtPct(totalN ? (sealedN / totalN) * 100 : 0)}).{sealedN < totalN && ' As antigas são criptografadas aos poucos, todo dia.'}</>}
        </p>
      </section>
    </SettingsSubpage>
  )
}
