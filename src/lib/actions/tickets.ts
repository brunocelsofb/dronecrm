'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { PRIORITY_SLA_DAYS, type PriorityTier } from '@/lib/utils/gut-matrix'
import { departmentLabel } from '@/lib/constants/departments'
import { resolvePublicTenantId } from '@/lib/tenant/context'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'

export type ActionState = { error?: string }

async function generateTicketNumber(tenantId: string): Promise<string> {
  const supabase = (await createScopedAdmin())
  const year = new Date().getFullYear()

  // O incremento em si é atômico (UPDATE...RETURNING trava a linha do
  // ano) — diferente da versão original que contava registros, aqui
  // não tem brecha de dois tickets saírem com o mesmo número.
  const { data: seqValue } = await supabase.rpc('next_ticket_number_for_year', { p_year: year })

  const { data: settings } = await supabase.from('organization_settings').select('ticket_number_prefix').eq('tenant_id', tenantId).maybeSingle()
  const prefix = settings?.ticket_number_prefix || 'TICKET'

  return `${prefix}-${year}-${String(seqValue).padStart(4, '0')}`
}

// Criação de ticket — usada tanto pelo formulário público de suporte
// quanto pelo cadastro manual da equipe. Sem exigir login.
export async function createTicket(formData: FormData): Promise<ActionState & { ticketId?: string; publicToken?: string }> {
  // Usa o adminClient para o insert funcionar sem autenticação
  // (formulário público acessado por terceiros sem login)
  const supabase = (await createScopedAdmin())

  // Empresa: contrato informado > ?empresa=<slug> do formulário > usuário logado > padrão
  const tenantIdFromContract = (formData.get('contract_id') as string) || null
  const { tenantIdForContract } = await import('@/lib/tenant/context')
  const tenantId = (await tenantIdForContract(tenantIdFromContract)) ?? await resolvePublicTenantId((formData.get('empresa') as string) || null)

  const subject = (formData.get('subject') as string)?.trim()
  const description = (formData.get('description') as string)?.trim()
  const priority = ((formData.get('priority') as string) || 'pouco_critica') as PriorityTier
  const category = (formData.get('category') as string) || null
  const requester_name = (formData.get('requester_name') as string)?.trim()
  const requester_email = (formData.get('requester_email') as string)?.trim()
  const requester_phone = (formData.get('requester_phone') as string)?.trim()
  const requester_cnpj = ((formData.get('requester_cnpj') as string) || '').replace(/\D/g, '')
  const source = (formData.get('source') as string) || 'manual'
  let contract_id = (formData.get('contract_id') as string) || null

  // Todos esses campos são obrigatórios — checados aqui de novo mesmo
  // que o front já valide, porque só o front nunca é confiável sozinho.
  if (!requester_name || requester_name.trim().split(/\s+/).length < 2) {
    return { error: 'Informe nome e sobrenome do solicitante.' }
  }
  if (!requester_email) return { error: 'E-mail é obrigatório.' }
  if (!requester_phone) return { error: 'Telefone é obrigatório.' }
  if (!subject) return { error: 'Assunto é obrigatório.' }
  if (!description) return { error: 'Descreva o problema.' }
  if (!requester_cnpj || requester_cnpj.length !== 14) return { error: 'Informe um CNPJ válido (o vinculado ao contrato).' }

  // Suporte é só pra CLIENTE — contrato de gestão ou serviço avulso.
  // Se não veio um contrato já escolhido (caso do formulário público),
  // tenta achar pelo CNPJ automaticamente.
  if (!contract_id) {
    const adminClient = (await createScopedAdmin())
    const { data: company } = await adminClient.from('companies').select('id').eq('cnpj', requester_cnpj).maybeSingle()

    if (company) {
      const { data: matchingContracts } = await adminClient.from('contracts').select('id').eq('company_id', company.id)
      if (matchingContracts && matchingContracts.length === 1) {
        contract_id = matchingContracts[0].id
      }
      // Se achou 0 ou mais de 1 contrato pra esse CNPJ, deixa sem
      // vincular — a equipe resolve na triagem (tela do ticket mostra
      // o aviso e o CNPJ informado pra facilitar).
    }
  }

  const slaDays = PRIORITY_SLA_DAYS[priority] ?? PRIORITY_SLA_DAYS.pouco_critica
  const slaDueAt = new Date(Date.now() + slaDays * 86_400_000).toISOString()

  // Tenta algumas vezes se o número colidir (ex: sequência ficou "pra
  // trás" por causa de tickets de teste excluídos) — em vez de travar,
  // pega o próximo número disponível sozinho.
  let data: { id: string; public_token: string; ticket_number: string } | null = null
  let lastError: { code?: string; message: string } | null = null

  for (let attempt = 0; attempt < 5; attempt++) {
    const ticketNumber = await generateTicketNumber(tenantId)
    const result = await supabase
      .from('tickets')
      .insert({
        ticket_number: ticketNumber,
        subject,
        description,
        priority,
        category,
        requester_name,
        requester_email,
        requester_phone,
        requester_cnpj,
        source,
        contract_id,
        sla_due_at: slaDueAt,
        tenant_id: tenantId,
      })
      .select('id, public_token, ticket_number')
      .single()

    if (!result.error) {
      data = result.data
      break
    }
    lastError = result.error
    if (result.error.code !== '23505') break // erro diferente de "já existe" — não adianta tentar de novo
  }

  if (!data) return { error: lastError?.message ?? 'Falha ao criar o ticket depois de várias tentativas.' }

  if (description) {
    await supabase.from('ticket_messages').insert({
      ticket_id: data.id,
      author_type: 'cliente',
      author_name: requester_name,
      message: description,
    })
  }

  // Avisa o time COMERCIAL — é onde o atendimento fica, segundo a
  // estrutura de vocês.
  const adminClient = (await createScopedAdmin())
  const { data: supportProfiles } = await adminClient.from('profiles').select('id').eq('department', 'comercial')
  if (supportProfiles && supportProfiles.length > 0) {
    await adminClient.from('notifications').insert(
      supportProfiles.map((p) => ({ user_id: p.id, message: `Novo ticket ${data.ticket_number}: ${subject} (prioridade ${priority}).` }))
    )
  }

  // Lastro: se o ticket já nasce vinculado a um contrato (escolhido na
  // criação, ou achado sozinho pelo CNPJ), fica registrado na conta
  // desde o início — não só quando é vinculado depois.
  if (contract_id) {
    await supabase.from('activities').insert({
      contract_id,
      type: 'system',
      content: `Ticket de atendimento aberto: ${data.ticket_number} — "${subject}".`,
    })

    const { checkAndTriggerTicketLinkedAutomations } = await import('./automations')
    await checkAndTriggerTicketLinkedAutomations(data.id)
  }

  revalidatePath('/tickets')
  if (contract_id) revalidatePath(`/contracts/${contract_id}`)
  return { ticketId: data.id, publicToken: data.public_token }
}

// Vincula (ou corrige) o contrato de um ticket já existente — usado
// principalmente pra tickets que chegaram pelo formulário público, onde
// a pessoa não escolhe o contrato na hora (só descreve a empresa) e
// alguém da equipe vincula depois de triar.
export async function linkTicketToContract(ticketId: string, contractId: string): Promise<ActionState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { data: ticket } = await supabase.from('tickets').select('ticket_number, subject').eq('id', ticketId).maybeSingle()

  const { error } = await supabase.from('tickets').update({ contract_id: contractId, updated_at: new Date().toISOString() }).eq('id', ticketId)
  if (error) return { error: error.message }

  // Lastro: fica registrado no histórico da CONTA que esse atendimento
  // foi vinculado a ela.
  await supabase.from('activities').insert({
    contract_id: contractId,
    user_id: user?.id ?? null,
    type: 'system',
    content: `Ticket de atendimento vinculado: ${ticket?.ticket_number ?? ''} — "${ticket?.subject ?? ''}".`,
  })

  const { checkAndTriggerTicketLinkedAutomations } = await import('./automations')
  await checkAndTriggerTicketLinkedAutomations(ticketId)

  revalidatePath(`/tickets/${ticketId}`)
  revalidatePath(`/contracts/${contractId}`)
  return {}
}

export async function updateTicketStatus(ticketId: string, status: string): Promise<ActionState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const update: Record<string, unknown> = { status, updated_at: new Date().toISOString() }
  if (status === 'resolvido' || status === 'fechado') update.resolved_at = new Date().toISOString()

  const { data: ticket } = await supabase
    .from('tickets')
    .select('ticket_number, subject, contract_id')
    .eq('id', ticketId)
    .maybeSingle()

  const { error } = await supabase.from('tickets').update(update).eq('id', ticketId)
  if (error) return { error: error.message }

  // Lastro: quando o atendimento é finalizado (resolvido/fechado),
  // também fica registrado na conta — não só no ticket.
  if ((status === 'resolvido' || status === 'fechado') && ticket?.contract_id) {
    await supabase.from('activities').insert({
      contract_id: ticket.contract_id,
      user_id: user?.id ?? null,
      type: 'system',
      content: `Ticket de atendimento ${status === 'resolvido' ? 'resolvido' : 'fechado'}: ${ticket.ticket_number} — "${ticket.subject}".`,
    })
  }

  revalidatePath('/tickets')
  revalidatePath(`/tickets/${ticketId}`)
  if (ticket?.contract_id) revalidatePath(`/contracts/${ticket.contract_id}`)
  return {}
}

export async function updateTicketPriority(ticketId: string, priority: string): Promise<ActionState> {
  const supabase = await createClient()
  const slaDays = PRIORITY_SLA_DAYS[priority as PriorityTier] ?? PRIORITY_SLA_DAYS.pouco_critica
  const slaDueAt = new Date(Date.now() + slaDays * 86_400_000).toISOString()

  const { error } = await supabase
    .from('tickets')
    .update({ priority, sla_due_at: slaDueAt, updated_at: new Date().toISOString() })
    .eq('id', ticketId)
  if (error) return { error: error.message }
  revalidatePath(`/tickets/${ticketId}`)
  return {}
}

export async function updateTicketTrend(ticketId: string, trend: number): Promise<ActionState> {
  const supabase = await createClient()
  const { error } = await supabase.from('tickets').update({ trend, updated_at: new Date().toISOString() }).eq('id', ticketId)
  if (error) return { error: error.message }
  revalidatePath(`/tickets/${ticketId}`)
  return {}
}

export async function assignTicket(ticketId: string, userId: string): Promise<ActionState> {
  const supabase = await createClient()
  const { error } = await supabase.from('tickets').update({ assigned_to: userId, updated_at: new Date().toISOString() }).eq('id', ticketId)
  if (error) return { error: error.message }
  revalidatePath(`/tickets/${ticketId}`)
  return {}
}

// Resposta INTERNA (equipe) — pode ser visível pro cliente ou só uma
// nota interna, dependendo do isInternalNote.
export async function addTicketMessage(ticketId: string, message: string, isInternalNote: boolean): Promise<ActionState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Usuário não autenticado.' }
  if (!message.trim()) return { error: 'Escreva algo antes de enviar.' }

  const { data: profile } = await supabase.from('profiles').select('full_name, department').eq('id', user.id).maybeSingle()

  const { error } = await supabase.from('ticket_messages').insert({
    ticket_id: ticketId,
    author_type: 'interno',
    author_id: user.id,
    author_name: profile?.full_name ?? 'Equipe',
    author_department: profile?.department ? departmentLabel(profile.department) : null,
    message,
    is_internal_note: isInternalNote,
  })
  if (error) return { error: error.message }

  await supabase.from('tickets').update({ updated_at: new Date().toISOString() }).eq('id', ticketId)

  revalidatePath(`/tickets/${ticketId}`)
  return {}
}

// Resposta do CLIENTE via link público (token, sem login).
export async function addPublicTicketReply(token: string, authorName: string, message: string): Promise<ActionState> {
  const supabase = (await createScopedAdmin())
  if (!message.trim()) return { error: 'Escreva algo antes de enviar.' }

  const { data: ticket } = await supabase.from('tickets').select('id, ticket_number, contract_id, status').eq('public_token', token).maybeSingle()
  if (!ticket) return { error: 'Link inválido.' }

  const { error } = await supabase.from('ticket_messages').insert({
    ticket_id: ticket.id,
    author_type: 'cliente',
    author_name: authorName || 'Cliente',
    message,
  })
  if (error) return { error: error.message }

  const wasFinalized = ticket.status === 'resolvido' || ticket.status === 'fechado'
  await supabase.from('tickets').update({ status: 'aberto', updated_at: new Date().toISOString() }).eq('id', ticket.id)

  // Lastro: se o cliente reabriu um atendimento que já tinha sido
  // dado como resolvido/fechado, isso também fica registrado na conta.
  if (wasFinalized && ticket.contract_id) {
    await supabase.from('activities').insert({
      contract_id: ticket.contract_id,
      type: 'system',
      content: `Ticket de atendimento ${ticket.ticket_number} reaberto pelo cliente.`,
    })
  }

  return {}
}

export async function deleteTicket(ticketId: string) {
  const supabase = (await createScopedAdmin())
  await supabase.from('tickets').delete().eq('id', ticketId)
  revalidatePath('/tickets')
}

// Resposta da pesquisa rápida de satisfação — pública (sem login),
// disparada quando o atendimento é finalizado.
export async function submitTicketSatisfaction(token: string, rating: number, comment: string): Promise<ActionState> {
  const supabase = (await createScopedAdmin())

  const { data: ticket } = await supabase.from('tickets').select('id, satisfaction_responded_at').eq('public_token', token).maybeSingle()
  if (!ticket) return { error: 'Link inválido.' }
  if (ticket.satisfaction_responded_at) return { error: 'Essa pesquisa já foi respondida.' }

  const { error } = await supabase
    .from('tickets')
    .update({ satisfaction_rating: rating, satisfaction_comment: comment || null, satisfaction_responded_at: new Date().toISOString() })
    .eq('id', ticket.id)

  if (error) return { error: error.message }
  return {}
}

// ------------------------------------------------------------
// Transferir/devolver entre áreas — mesma lógica já usada nos
// contratos: apuração e resposta interna acontecem transferindo o
// ticket pra área responsável, com nota obrigatória. O histórico fica
// gravado tanto no ticket quanto na conta (lastro nos dois lugares).
// ------------------------------------------------------------
export async function transferTicket(ticketId: string, toDepartment: string, note: string): Promise<ActionState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Usuário não autenticado.' }
  if (!note.trim()) return { error: 'Descreva o que precisa ser apurado antes de transferir.' }

  const { data: profile } = await supabase.from('profiles').select('full_name, department').eq('id', user.id).maybeSingle()
  const { data: ticketRow } = await supabase.from('tickets').select('ticket_number, contract_id, current_department').eq('id', ticketId).maybeSingle()

  const { error } = await supabase
    .from('tickets')
    .update({ current_department: toDepartment, previous_department: ticketRow?.current_department ?? null, updated_at: new Date().toISOString() })
    .eq('id', ticketId)
  if (error) return { error: error.message }

  await supabase.from('ticket_messages').insert({
    ticket_id: ticketId,
    author_type: 'interno',
    author_id: user.id,
    author_name: profile?.full_name ?? 'Equipe',
    author_department: profile?.department ? departmentLabel(profile.department) : null,
    message: `Transferido pra apuração da área "${departmentLabel(toDepartment)}". ${note}`,
    is_internal_note: true,
  })

  if (ticketRow?.contract_id) {
    await supabase.from('activities').insert({
      contract_id: ticketRow.contract_id,
      user_id: user.id,
      type: 'system',
      content: `Ticket ${ticketRow.ticket_number} transferido pra área "${departmentLabel(toDepartment)}" pra apuração${profile?.department ? ` (por ${profile.full_name}, ${departmentLabel(profile.department)})` : ''}.`,
    })
  }

  revalidatePath(`/tickets/${ticketId}`)
  return {}
}

export async function returnTicket(ticketId: string, note: string): Promise<ActionState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Usuário não autenticado.' }
  if (!note.trim()) return { error: 'Descreva o que foi apurado antes de devolver.' }

  const { data: profile } = await supabase.from('profiles').select('full_name, department').eq('id', user.id).maybeSingle()
  const { data: ticketRow } = await supabase.from('tickets').select('ticket_number, contract_id, previous_department').eq('id', ticketId).maybeSingle()

  const { error } = await supabase
    .from('tickets')
    .update({ current_department: ticketRow?.previous_department ?? null, previous_department: null, updated_at: new Date().toISOString() })
    .eq('id', ticketId)
  if (error) return { error: error.message }

  await supabase.from('ticket_messages').insert({
    ticket_id: ticketId,
    author_type: 'interno',
    author_id: user.id,
    author_name: profile?.full_name ?? 'Equipe',
    author_department: profile?.department ? departmentLabel(profile.department) : null,
    message: `Apuração concluída, devolvido. ${note}`,
    is_internal_note: true,
  })

  if (ticketRow?.contract_id) {
    await supabase.from('activities').insert({
      contract_id: ticketRow.contract_id,
      user_id: user.id,
      type: 'system',
      content: `Ticket ${ticketRow.ticket_number} devolvido após apuração${profile?.department ? ` (por ${profile.full_name}, ${departmentLabel(profile.department)})` : ''}.`,
    })
  }

  revalidatePath(`/tickets/${ticketId}`)
  return {}
}

export async function searchContractsForTicket(query: string): Promise<{ id: string; client_name: string; process_number: string }[]> {
  if (!query || query.length < 2) return []
  const supabase = await createClient()

  const cleanedForCnpj = query.replace(/\D/g, '')
  if (cleanedForCnpj.length >= 8) {
    // Parece um CNPJ (ou pedaço dele) — busca pela empresa primeiro.
    const { data: companies } = await supabase.from('companies').select('id').ilike('cnpj', `%${cleanedForCnpj}%`)
    if (companies && companies.length > 0) {
      const { data: byCompany } = await supabase
        .from('contracts')
        .select('id, client_name, process_number')
        .in('company_id', companies.map((c) => c.id))
        .limit(8)
      if (byCompany && byCompany.length > 0) return byCompany
    }
  }

  const { data } = await supabase
    .from('contracts')
    .select('id, client_name, process_number')
    .or(`client_name.ilike.%${query}%,process_number.ilike.%${query}%`)
    .limit(8)
  return data ?? []
}
