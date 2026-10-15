import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

export async function POST(req: Request) {
  const body = await req.json()
  const { contract_id, status, proposal_value, actor_name, actor_email, proposal_id, price_url, comment, actor_role } = body

  if (!contract_id || !status) {
    return NextResponse.json({ error: 'contract_id e status são obrigatórios' }, { status: 400, headers: CORS })
  }

  const supabase = (await createScopedAdmin())
  const now = new Date().toISOString()

  // Tenta pegar usuário logado
  let loggedName = actor_name ?? null
  try {
    const userClient = await createClient()
    const { data: { user } } = await userClient.auth.getUser()
    if (user) {
      const { data: profile } = await supabase.from('profiles').select('full_name').eq('id', user.id).maybeSingle()
      if (profile?.full_name) loggedName = profile.full_name
    }
  } catch { /* externo */ }

  // Monta patch com campos de auditoria por etapa
  const patch: Record<string, unknown> = {
    status,
    actor_name: loggedName,
    actor_email: actor_email ?? null,
    updated_at: now,
  }
  if (proposal_value)  patch.proposal_value = proposal_value
  if (proposal_id)     patch.proposal_id = proposal_id
  if (price_url)       patch.price_url = price_url

  // Registra timestamp e nome por etapa
  if (status === 'em_aprovacao_tecnica') {
    patch.submitted_at = now
    patch.submitted_by_name = loggedName
    // Gera token para link de leitura no Price
    const { randomBytes } = await import('crypto')
    patch.review_token = randomBytes(24).toString('hex')
  }
  if (status === 'aprovado_tecnico') {
    patch.technical_approved_at = now
    patch.technical_approved_by_name = loggedName
    if (comment) patch.technical_comment = comment
    if (actor_role) patch.technical_approved_by_role = actor_role
  }
  if (status === 'reprovado_tecnico') {
    patch.technical_approved_at = now
    patch.technical_approved_by_name = loggedName
    if (comment) patch.technical_comment = comment
    if (actor_role) patch.technical_approved_by_role = actor_role
  }
  if (status === 'aprovado_comercial') {
    patch.commercial_approved_at = now
    patch.commercial_approved_by_name = loggedName
    if (comment) patch.commercial_comment = comment
    if (actor_role) patch.commercial_approved_by_role = actor_role
  }
  if (status === 'rascunho') {
    // NÃO limpa campos de auditoria — preserva audit trail
    // A reabertura é registrada via log, não apagando o passado
  }

  // Salva no proposals (novo modelo 1:N) se vier proposal_id
  if (proposal_id) {
    const proposalPatch: Record<string, unknown> = { workflow_status: status, updated_at: now }
    // Copia campos relevantes do patch para proposals
    const fieldsToCopy = ['proposal_value','submitted_at','submitted_by_name','technical_approved_at','technical_approved_by_name','technical_approved_by_role','technical_comment','technical_restrictions','commercial_approved_at','commercial_approved_by_name','commercial_approved_by_role','commercial_comment','client_status','client_approved_at','client_approved_by_name','client_approved_by_cpf','review_token']
    for (const f of fieldsToCopy) {
      if (patch[f] !== undefined) proposalPatch[f] = patch[f]
    }
    await supabase.from('proposals').update(proposalPatch).eq('id', proposal_id)
  } else {
    // Fallback: mantém proposal_status para propostas antigas
    await supabase.from('proposal_status').upsert(
      { contract_id, ...patch },
      { onConflict: 'contract_id' }
    )
  }

  if (proposal_value) {
    await supabase.from('pipeline_runs')
      .update({ value: proposal_value })
      .eq('contract_id', contract_id)
      .eq('status', 'open')
  }

  const ROLE_LABELS_MAP: Record<string, string> = {
    admin: 'Administrador',
    member: 'Comercial',
    aprovador_tecnico: 'Aprovador Técnico',
    aprovador_comercial: 'Aprovador Comercial',
  }

  const statusLabel: Record<string, string> = {
    aprovado_comercial:     '✅ Aprovação Comercial realizada',
    aprovado_tecnico:       '✅ Aprovação Técnica realizada',
    reprovado_tecnico:      '❌ Reprovado na Análise Técnica — retornou para revisão',
    em_aprovacao_tecnica:   '📤 Enviada para Análise Técnica',
    em_aprovacao_comercial: '💼 Enviada para Aprovação Comercial',
    rascunho:               '🔄 Retornada para Rascunho',
  }

  const activityContent = [
    statusLabel[status] ?? status,
    loggedName ? `por ${loggedName}` : null,
    actor_role ? `(${ROLE_LABELS_MAP[actor_role] ?? actor_role})` : null,
    comment ? `Comentário: "${comment}"` : null,
    proposal_value ? `Valor: R$ ${Number(proposal_value).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : null,
  ].filter(Boolean).join(' · ') + `.`

  const { error: actError } = await supabase.from('activities').insert({
    contract_id,
    type: 'proposal',
    content: activityContent,
    metadata: {
      proposal_id: proposal_id ?? null,
      new_status: status,
      actor: loggedName,
      comment: comment ?? null,
    },
  })

  if (actError) {
    console.error('[proposal/status] activities INSERT error:', actError)
    // Não falha a requisição por erro no log, mas reporta
  }

  // Busca dados do contrato para notificação
  const { data: contract } = await supabase
    .from('contracts')
    .select('client_name, title, process_number')
    .eq('id', contract_id)
    .maybeSingle()

  const contractLabel = contract?.client_name ?? contract_id
  const appUrl = 'https://crm-gestaocontratos-pi.vercel.app'
  const contractUrl = `${appUrl}/contracts/${contract_id}?tab=proposta`

  // Notificações e e-mails por etapa
  if (status === 'em_aprovacao_tecnica' || status === 'em_aprovacao_comercial') {
    const targetRole = status === 'em_aprovacao_tecnica' ? 'aprovador_tecnico' : 'aprovador_comercial'
    const roleLabel = status === 'em_aprovacao_tecnica' ? 'Aprovação Técnica' : 'Aprovação Comercial'

    // Busca todos os usuários com o role alvo
    const { data: approvers } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .eq('role', targetRole)

    if (approvers && approvers.length > 0) {
      // Notificação no CRM para cada aprovador
      await supabase.from('notifications').insert(
        approvers.map(a => ({
          user_id: a.id,
          contract_id,
          message: `📋 ${roleLabel} pendente: proposta de ${contractLabel} aguarda seu parecer.`,
        }))
      )

      // E-mail para cada aprovador usando a conta do remetente logado
      const senderUserId = loggedName ? await (async () => {
        const userClient = await createClient()
        const { data: { user } } = await userClient.auth.getUser()
        return user?.id ?? null
      })() : null

      for (const approver of approvers) {
        if (!approver.email) continue
        try {
          const { sendEmailForUser } = await import('@/lib/email/send')
          const html = `
            <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
              <div style="background:linear-gradient(135deg,#1b556b,#32af9d);padding:24px;border-radius:8px 8px 0 0">
                <h2 style="color:#fff;margin:0;font-size:18px">📋 ${roleLabel} Necessária</h2>
              </div>
              <div style="background:#fff;padding:24px;border:1px solid #e8edf5;border-top:none;border-radius:0 0 8px 8px">
                <p style="color:#1a1f36;font-size:15px">Olá, <strong>${approver.full_name}</strong>!</p>
                <p style="color:#52514e">A proposta abaixo foi enviada para sua análise e aguarda o seu parecer:</p>
                <div style="background:#f8f9fb;border-left:3px solid #1b556b;padding:16px;border-radius:4px;margin:16px 0">
                  <p style="margin:0;font-weight:600;color:#1a1f36">${contractLabel}</p>
                  ${contract?.process_number ? `<p style="margin:4px 0 0;font-size:13px;color:#8892a4">${contract.process_number}</p>` : ''}
                  ${loggedName ? `<p style="margin:8px 0 0;font-size:13px;color:#8892a4">Enviado por: ${loggedName}</p>` : ''}
                </div>
                <a href="${contractUrl}" style="display:inline-block;background:#1b556b;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:8px">
                  Acessar e Aprovar no CRM →
                </a>
                <p style="color:#b0b8c8;font-size:12px;margin-top:24px">CRM · Notificação automática</p>
              </div>
            </div>
          `
          if (senderUserId) {
            await sendEmailForUser(
              senderUserId,
              approver.email,
              `[CRM ORBIS] ${roleLabel} pendente — ${contractLabel}`,
              html
            )
          }
        } catch (e) {
          console.error(`Erro ao enviar e-mail para ${approver.email}:`, e)
        }
      }
    }
  }

  return NextResponse.json({ ok: true }, { headers: CORS })
}
