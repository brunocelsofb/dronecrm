import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveTenantId } from '@/lib/tenant/context'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'

// GET ?pipelineId=xxx → retorna config daquele pipeline
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const pipelineId = searchParams.get('pipelineId')
  const admin = (await createScopedAdmin())
  const { data } = await admin.from('organization_settings').select('pipeline_tab_config').eq('tenant_id', await resolveTenantId()).maybeSingle()
  const config = (data as any)?.pipeline_tab_config ?? {}
  if (pipelineId) return NextResponse.json({ config: config[pipelineId] ?? null })
  return NextResponse.json({ config })
}

// POST { pipelineId, order, hidden } → salva config
export async function POST(req: Request) {
  const { pipelineId, order, hidden } = await req.json()
  if (!pipelineId) return NextResponse.json({ error: 'pipelineId obrigatório' }, { status: 400 })
  const admin = (await createScopedAdmin())
  const { data } = await admin.from('organization_settings').select('pipeline_tab_config').eq('tenant_id', await resolveTenantId()).maybeSingle()
  const existing = (data as any)?.pipeline_tab_config ?? {}
  existing[pipelineId] = { order, hidden: hidden ?? [] }
  await admin.from('organization_settings').update({ pipeline_tab_config: existing }).eq('tenant_id', await resolveTenantId())
  return NextResponse.json({ ok: true })
}
