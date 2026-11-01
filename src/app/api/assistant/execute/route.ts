import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { loadTheoContext } from '@/lib/ai/theo-server'
import { runTheoAction } from '@/lib/ai/theo-tools'

// Théo: executa a ação que a pessoa CONFIRMOU na tela. Só ações liberadas para a
// empresa (plano) e para a pessoa (perfil); fica registrada em assistant_action_log.
export async function POST(request: Request) {
  const ctx = await loadTheoContext()
  if (!ctx) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  if (ctx.support) return NextResponse.json({ error: 'O Théo não funciona no acesso de suporte.' }, { status: 403 })
  if (!ctx.canUse) return NextResponse.json({ error: 'O Théo não está liberado para você.' }, { status: 403 })

  const body = await request.json().catch(() => ({}))
  const name = String(body?.name ?? '')
  const input = (body?.input && typeof body.input === 'object' ? body.input : {}) as Record<string, unknown>
  const tool = ctx.tools.find(t => t.name === name && t.kind === 'acao')
  if (!tool) return NextResponse.json({ error: 'Esta ação não está liberada para você.' }, { status: 403 })

  const result = await runTheoAction(name, input)

  const supabase = await createClient()
  await supabase.from('assistant_action_log').insert({
    user_id: ctx.userId, tool_name: name, tool_input: input,
    result_summary: result.error ? `ERRO: ${result.error}` : result.summary,
    contract_id: result.contractId ?? null,
  })
  return NextResponse.json(result.error ? { ok: false, text: `Não deu certo: ${result.error}` } : { ok: true, text: `✓ ${result.summary}` })
}
