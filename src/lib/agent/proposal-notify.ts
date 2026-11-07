// ─── Agente avisa os aprovadores a cada etapa da proposta ─────────────────────
// Central de regras → "A cada etapa da aprovação da proposta" (só com Agentes de IA no plano).
// Quem recebe é quem precisa agir agora: aprovador técnico, aprovador comercial ou o
// responsável pela oportunidade. Canais: sino, WhatsApp (telefone do cadastro) e e-mail
// (pelo remetente automático da empresa). O aviso ao técnico nunca leva valor.
import { createAdminClient } from '@/lib/supabase/admin'
import { notifyPerson } from './handoff'

const appUrl = () => (process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.comercialdrone.com.br').replace(/\/$/, '')

export type ProposalStep =
  | 'em_aprovacao_tecnica' | 'aprovado_tecnico' | 'reprovado_tecnico'
  | 'em_aprovacao_comercial' | 'aprovado_comercial' | 'cliente_aprovado' | 'cliente_recusado'

export async function notifyProposalStep(args: {
  tenantId: string; contractId: string; proposalId: string; step: ProposalStep
  actorName?: string | null; comment?: string | null
}): Promise<void> {
  const { tenantId, contractId, proposalId, step } = args
  try {
    const [{ eventOn }, { getTenantFeatures }] = await Promise.all([
      import('@/lib/rules/events-server'), import('@/lib/config/tenant-features'),
    ])
    const { features } = await getTenantFeatures(tenantId)
    if (!features.includes('copiloto')) return            // sem agente de IA no plano
    if (!(await eventOn(tenantId, 'proposal_step_notify'))) return

    const db = createAdminClient()
    const [{ data: c }, { data: p }] = await Promise.all([
      db.from('contracts').select('client_name, owner_id, current_assignee_id').eq('id', contractId).eq('tenant_id', tenantId).maybeSingle(),
      db.from('proposals').select('control_code, version, proposal_value').eq('id', proposalId).eq('tenant_id', tenantId).maybeSingle(),
    ])
    if (!c || !p) return
    const code = `${p.control_code}${p.version && p.version > 1 ? ` (versão ${p.version})` : ''}`
    const cliente = c.client_name ?? 'cliente'
    const by = args.actorName ? ` por ${args.actorName}` : ''
    const obs = args.comment ? `\nComentário: "${String(args.comment).slice(0, 400)}"` : ''
    const owner = (c.owner_id ?? c.current_assignee_id ?? null) as string | null
    const linkProposta = `${appUrl()}/contracts/${contractId}?tab=proposta&proposta=${proposalId}`
    const linkTecnico = `${appUrl()}/contracts/${contractId}/proposals/${proposalId}/tecnico`

    const byRole = async (role: string) => {
      const { data } = await db.from('profiles').select('id').eq('tenant_id', tenantId).eq('role', role)
      const ids = ((data ?? []) as { id: string }[]).map(r => r.id)
      if (ids.length || role !== 'aprovador_comercial') return ids
      // sem aprovador comercial cadastrado: os administradores aprovam
      const { data: admins } = await db.from('profiles').select('id').eq('tenant_id', tenantId).eq('role', 'admin')
      return ((admins ?? []) as { id: string }[]).map(r => r.id)
    }

    let to: string[] = []
    let subject = ''
    let text = ''
    switch (step) {
      case 'em_aprovacao_tecnica':
        to = await byRole('aprovador_tecnico')
        subject = `Proposta ${code} aguardando sua análise técnica — ${cliente}`
        text = `A proposta ${code} de ${cliente} foi enviada para análise técnica${by}.${obs}\nVeja o dimensionamento: ${linkTecnico}\nRegistre o parecer na proposta: ${linkProposta}`
        break
      case 'em_aprovacao_comercial':
        to = await byRole('aprovador_comercial')
        subject = `Proposta ${code} aguardando aprovação comercial — ${cliente}`
        text = `A proposta ${code} de ${cliente} foi enviada para aprovação comercial${by}.${obs}\nAbra a proposta: ${linkProposta}`
        break
      case 'aprovado_tecnico':
        to = owner ? [owner] : []
        subject = `Proposta ${code} aprovada tecnicamente — ${cliente}`
        text = `A proposta ${code} de ${cliente} foi aprovada tecnicamente${by}.${obs}\nPróximo passo: enviar para a aprovação comercial. ${linkProposta}`
        break
      case 'reprovado_tecnico':
        to = owner ? [owner] : []
        subject = `Proposta ${code} reprovada — ${cliente}`
        text = `A proposta ${code} de ${cliente} foi reprovada${by}.${obs}\nRevise e volte ao rascunho para ajustar: ${linkProposta}`
        break
      case 'aprovado_comercial':
        to = owner ? [owner] : []
        subject = `Proposta ${code} aprovada comercialmente — ${cliente}`
        text = `A proposta ${code} de ${cliente} foi aprovada comercialmente${by}.${obs}\nPróximo passo: gerar o PDF e enviar ao cliente. ${linkProposta}`
        break
      case 'cliente_aprovado':
        to = owner ? [owner] : []
        subject = `Cliente aprovou a proposta ${code} — ${cliente}`
        text = `${cliente} aprovou a proposta ${code}${by}.${obs}\nPróximo passo: dar o ganho na oportunidade. ${linkProposta}`
        break
      case 'cliente_recusado':
        to = owner ? [owner] : []
        subject = `Cliente recusou a proposta ${code} — ${cliente}`
        text = `${cliente} recusou a proposta ${code}${by}.${obs}\n${linkProposta}`
        break
    }
    for (const userId of [...new Set(to)]) {
      await notifyPerson(tenantId, userId, { text: `[Agente] ${text}`, subject, contractId })
    }
  } catch (e) {
    console.error('[proposal-notify]', step, e)
  }
}
