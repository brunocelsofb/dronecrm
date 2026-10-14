import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const { searchParams } = new URL(req.url)
  const contractId = searchParams.get('contract_id')
  if (!contractId) return NextResponse.json({ logs: [] })

  const admin = (await createScopedAdmin())

  // Busca APENAS logs com metadata.proposal_id = id (isolamento absoluto)
  const { data: logs, error } = await admin
    .from('activities')
    .select('id, type, content, created_at, metadata')
    .eq('contract_id', contractId)
    .in('type', ['proposal', 'system', 'client_decision'])
    .filter('metadata->>proposal_id', 'eq', id)
    .order('created_at', { ascending: true })

  if (error) console.error('[history]', error)

  const filtered = logs ?? []

  const enriched = filtered.map(log => ({
    ...log,
    actor_name: extractActor(log.content),
  }))

  return NextResponse.json({ logs: enriched })
}

function extractActor(content: string | null): string {
  if (!content) return '—'
  const match = content.match(/(?:por|aprovado por|reaberta por|enviada por)[:\s]+([^.·\n(]+)/i)
  return match?.[1]?.trim() ?? '—'
}
