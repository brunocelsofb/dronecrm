import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'

export async function GET(
  req: Request,
  { params }: { params: Promise<{ proposalId: string }> }
) {
  const { proposalId: id } = await params
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

  // Aprovador técnico não vê valores: o servidor tira os números antes de responder
  const { getCurrentProfile } = await import('@/lib/auth/role')
  const me = await getCurrentProfile()
  const hideValues = String(me?.role) === 'aprovador_tecnico'
  const redact = (t: string | null) => !t ? t : t
    .replace(/\s*[·.]?\s*(Valor|Margem)[^·.]*R?\$?[^·]*?(?=·|$)/gi, '')
    .replace(/R\$\s?[\d.]+(,\d{2})?(\/m[eê]s)?/g, '—')
    .replace(/\(antes —\)/g, '')

  const enriched = filtered.map(log => ({
    ...log,
    ...(hideValues ? {
      content: (log.metadata as { actor?: string } | null)?.actor === 'Price' ? 'Precificação enviada pelo Price.' : redact(log.content),
      metadata: { ...(log.metadata as Record<string, unknown> | null), proposal_value: null },
    } : {}),
    actor_name: (log.metadata as { actor?: string } | null)?.actor ?? extractActor(log.content),
  }))

  return NextResponse.json({ logs: enriched })
}

function extractActor(content: string | null): string {
  if (!content) return '—'
  const match = content.match(/(?:por|aprovado por|reaberta por|enviada por)[:\s]+([^.·\n(]+)/i)
  return match?.[1]?.trim() ?? '—'
}
