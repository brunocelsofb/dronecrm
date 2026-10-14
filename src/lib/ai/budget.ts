import { createClient } from '@/lib/supabase/server'
import { resolveTenantId } from '@/lib/tenant/context'

// Preço aproximado do Claude Sonnet 5 (por milhão de tokens) — usado só
// pra estimar o gasto e comparar com o orçamento configurado. Se a
// Anthropic mudar o preço, esse número precisa ser atualizado à mão
// (não busca o preço real automaticamente).
const PRICE_PER_MILLION_INPUT = 2
const PRICE_PER_MILLION_OUTPUT = 10

export async function checkBudgetAvailable(): Promise<{ ok: boolean; message?: string }> {
  const supabase = await createClient()

  const { data: settings } = await supabase
    .from('organization_settings')
    .select('assistant_monthly_budget_usd')
    .eq('tenant_id', await resolveTenantId())
    .maybeSingle()

  const budget = settings?.assistant_monthly_budget_usd ?? 10

  const startOfMonth = new Date()
  startOfMonth.setDate(1)
  startOfMonth.setHours(0, 0, 0, 0)

  const { data: usage } = await supabase
    .from('assistant_usage_log')
    .select('input_tokens, output_tokens')
    .gte('created_at', startOfMonth.toISOString())

  const totalCost = (usage ?? []).reduce(
    (sum, u) => sum + (u.input_tokens / 1_000_000) * PRICE_PER_MILLION_INPUT + (u.output_tokens / 1_000_000) * PRICE_PER_MILLION_OUTPUT,
    0
  )

  if (totalCost >= budget) {
    return {
      ok: false,
      message: `Orçamento mensal do Théo (US$ ${budget}) atingido — já foram gastos aproximadamente US$ ${totalCost.toFixed(2)} este mês. Aumente o orçamento em Configurações se precisar continuar usando.`,
    }
  }

  return { ok: true }
}

export async function logAssistantUsage(userId: string, inputTokens: number, outputTokens: number) {
  const supabase = await createClient()
  await supabase.from('assistant_usage_log').insert({ user_id: userId, input_tokens: inputTokens, output_tokens: outputTokens })
}
