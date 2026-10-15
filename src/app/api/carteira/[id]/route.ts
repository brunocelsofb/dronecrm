import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const ALLOWED_FIELDS = [
  'contract_number', 'sankhya_code', 'cnpj_billing', 'contract_type',
  'monthly_value', 'validity_months', 'valid_until', 'valid_from',
  'engineer_name', 'coordinator_name',
  'abc_curve', 'sphere', 'nature', 'region', 'uf', 'segment', 'economic_group',
  'score_billing', 'score_visit', 'score_loyalty', 'score_weight',
  'has_measurement', 'has_audit', 'has_parts', 'team_type',
  'municipality', 'state', 'internal_notes',
]

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const body = await request.json()
  const update: Record<string, any> = {}
  for (const key of ALLOWED_FIELDS) {
    if (key in body) update[key] = body[key]
  }
  // Tipo do contrato define o selo de receita (Recorrente x Medição)
  if (update.contract_type === 'medicao') update.billing_type = 'metered'
  else if (update.contract_type === 'fixo') update.billing_type = 'fixed'
  update.updated_at = new Date().toISOString()

  const { error } = await supabase.from('contracts').update(update).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  return NextResponse.json({ ok: true })
}
