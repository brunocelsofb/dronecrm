import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { loadTheoContext, monthUsage } from '@/lib/ai/theo-server'
import { runTheo, type TheoTurn } from '@/lib/ai/theo-engine'
import { runTheoRead, describeAction } from '@/lib/ai/theo-tools'
import { estimateCostUsd, theoSystemPrompt, toolByName } from '@/lib/ai/theo-catalog'

// Théo: uma rodada de conversa com a IA que a empresa escolheu (Configurações → Théo).
// A chave é da empresa (cada licença paga o próprio uso). Consultas rodam na hora;
// ações voltam para a pessoa confirmar (/api/assistant/execute).
export const maxDuration = 60

export async function POST(request: Request) {
  const ctx = await loadTheoContext()
  if (!ctx) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  if (ctx.support) return NextResponse.json({ error: 'O Théo não funciona no acesso de suporte.' }, { status: 403 })
  if (!ctx.canUse) return NextResponse.json({ error: 'O Théo não está liberado para você. Fale com o administrador da empresa.' }, { status: 403 })
  if (!ctx.provider || !ctx.key || !ctx.model) {
    return NextResponse.json({ error: ctx.isAdmin
      ? 'O Théo ainda não está ligado: escolha a IA e cadastre a chave da empresa em Configurações → Théo.'
      : 'O Théo ainda não está ligado na empresa. Fale com o administrador.' }, { status: 400 })
  }
  const usage = await monthUsage(ctx.tenantId)
  if (usage.total >= (ctx.settings.budget_usd ?? 10)) {
    return NextResponse.json({ error: `Orçamento do mês do Théo atingido (US$ ${(ctx.settings.budget_usd ?? 10).toFixed(2)}, estimado). O administrador pode aumentar em Configurações → Théo.` }, { status: 402 })
  }

  const body = await request.json().catch(() => ({}))
  const history = (Array.isArray(body?.history) ? body.history : []) as TheoTurn[]

  const r = await runTheo({
    provider: ctx.provider, model: ctx.model, key: ctx.key,
    system: theoSystemPrompt(ctx.companyName), history, tools: ctx.tools,
    read: (name, input) => runTheoRead(name, input),
  })

  if (r.tokensIn || r.tokensOut) {
    const supabase = await createClient()
    await supabase.from('assistant_usage_log').insert({
      user_id: ctx.userId, input_tokens: r.tokensIn, output_tokens: r.tokensOut,
      provider: ctx.provider, model: ctx.model, cost_usd: estimateCostUsd(ctx.provider, ctx.model, r.tokensIn, r.tokensOut),
    })
  }
  if (r.error) return NextResponse.json({ error: r.error }, { status: 502 })

  const pending = r.pending ? {
    name: r.pending.name, input: r.pending.input,
    label: toolByName(r.pending.name)?.label ?? r.pending.name,
    lines: describeAction(r.pending.name, r.pending.input),
  } : null
  return NextResponse.json({ text: r.text, pending })
}
