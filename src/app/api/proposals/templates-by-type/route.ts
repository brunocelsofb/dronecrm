import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveTenantId } from '@/lib/tenant/context'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const serviceType = searchParams.get('service_type') ?? 'clinica'
  const admin = (await createScopedAdmin())

  const { data: templates } = await admin
    .from('proposal_templates')
    .select('id, name, sort_order, is_miolo_after, service_type')
    .eq('service_type', serviceType)
    .order('sort_order', { ascending: true })

  // Busca posição especial do miolo (start/end) de organization_settings
  const { data: org } = await admin
    .from('organization_settings')
    .select('miolo_positions')
    .eq('tenant_id', await resolveTenantId())
    .maybeSingle()

  const mioloPositions = (org?.miolo_positions as Record<string, string>) ?? {}
  const mioloAfterId = mioloPositions[serviceType] ?? null

  return NextResponse.json({ templates: templates ?? [], miolo_after_id: mioloAfterId })
}
