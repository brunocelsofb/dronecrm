import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { resolveTenantId } from '@/lib/tenant/context'

export async function POST(req: Request) {
  const userClient = await createClient()
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { contract_id } = await req.json()
  const admin = createAdminClient()

  // Nova proposta sempre nasce como v1 — versão só incrementa via "Criar versão"
  const version = 1

  // Prefixo da organização
  const { data: orgSettings } = await admin.from('organization_settings')
    .select('proposal_number_prefix').eq('tenant_id', await resolveTenantId({ contractId: contract_id })).maybeSingle()
  const pfx = orgSettings?.proposal_number_prefix ?? 'PROP'
  const year = new Date().getFullYear()

  // Total GLOBAL incluindo excluídas — garante numeração contínua (nunca reutiliza)
  const { count: totalCount } = await admin.from('proposals')
    .select('id', { count: 'exact', head: true })
  const code = `${pfx}-${year}-${String((totalCount ?? 0) + 1).padStart(4, '0')}`

  // INSERT real — nova proposta em branco
  const { data: proposal, error } = await admin.from('proposals').insert({
    contract_id,
    control_code: code,
    version,
    workflow_status: 'rascunho',
    status: 'draft',
    currency: 'BRL',
    valid_until: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
    installments: 12,
    is_recurring: true,
    discount_value: 0,
    created_by: user.id,
  }).select('id, control_code, version').single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Página padrão
  await admin.from('proposal_pages').insert({
    proposal_id: proposal.id,
    position: 0,
    is_standard_proposal: true,
  })

  return NextResponse.json({ id: proposal.id, control_code: proposal.control_code, version: proposal.version })
}
