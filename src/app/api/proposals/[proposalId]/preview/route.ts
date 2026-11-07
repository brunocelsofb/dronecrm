import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { buildMergedProposalBytes } from '@/lib/actions/proposal-pdf-merge'

// Só pra usuários logados (equipe interna) — gera o PDF na hora, sem
// salvar em lugar nenhum nem mudar o status da proposta. É assim que dá
// pra conferir o documento antes de mandar pra aprovação.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ proposalId: string }> }
) {
  const { proposalId } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  const { canSeeValues } = await import('@/lib/auth/access')
  if (!(await canSeeValues())) return NextResponse.json({ error: 'Sem acesso aos valores.' }, { status: 403 })

  const { bytes, error } = await buildMergedProposalBytes(proposalId)

  if (error || !bytes) {
    return NextResponse.json({ error: error ?? 'Falha ao gerar pré-visualização.' }, { status: 400 })
  }

  return new NextResponse(Buffer.from(bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="pre-visualizacao.pdf"',
    },
  })
}
