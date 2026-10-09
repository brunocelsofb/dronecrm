/**
 * Copiloto Estratégico — Lógica de negócio partilhada
 *
 * Exporta as funções de dados e o buildPrompt para que possam ser chamadas
 * directamente pelo Server Component da página /briefing SEM fazer fetch HTTP
 * (fetch com URL relativa falha no SSR da Vercel).
 *
 * O route.ts /api/agent/briefing importa daqui também,
 * mantendo uma única fonte de verdade.
 */

import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import { subDays, format, differenceInDays } from 'date-fns'
import { ptBR } from 'date-fns/locale'

// ─── Tipos públicos ────────────────────────────────────────────────────────────
export type DormantRun = {
  contract_id:      string
  client_name:      string | null
  value:            number | null
  stage_name:       string | null
  days_idle:        number
  stage_entered_at: string | null
}

export type RenewalCandidate = {
  id:                string
  client_name:       string
  contract_type:     string | null
  valid_until:       string | null
  monthly_value:     number | null
  days_until_expiry: number | null
  abc_curve:         string | null
}

export type StaleLead = {
  id:                 string
  name:               string
  status:             string
  score:              number
  source:             string | null
  days_since_created: number
}

export type BriefingStats = {
  dormantOpportunities: number
  renewalCandidates:    number
  staleLeads:           number
  tokensInput:          number
  tokensOutput:         number
}

export type WhatsAppResult =
  | { sent: true;  statusCode: number }
  | { sent: false; error: string }

export type BriefingResult = {
  ok:          true
  generatedAt: string
  stats:       BriefingStats
  briefing:    string
  whatsapp:    WhatsAppResult
}

export type BriefingError = {
  ok:    false
  error: string
}

// ─── Cliente Supabase admin ────────────────────────────────────────────────────
function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

// ─── Query 1: Oportunidades dormentes ─────────────────────────────────────────
export async function fetchDormantOpportunities(
  supabase: ReturnType<typeof getAdminClient>
): Promise<DormantRun[]> {
  const { data: salesPipelines } = await supabase
    .from('pipelines')
    .select('id')
    .eq('type', 'vendas')

  const salesPipelineIds = (salesPipelines ?? []).map((p: { id: string }) => p.id)
  if (salesPipelineIds.length === 0) {
    console.warn('[agent] nenhum pipeline de vendas encontrado — verifica o campo type')
    return []
  }

  const { data: runs, error: runsErr } = await supabase
    .from('pipeline_runs')
    .select('contract_id, value, stage_id, stage_entered_at')
    .in('pipeline_id', salesPipelineIds)
    .eq('status', 'open')

  if (runsErr) { console.error('[agent] erro pipeline_runs:', runsErr.message); return [] }
  if (!runs || runs.length === 0) return []

  const contractIds = runs.map((r: { contract_id: string }) => r.contract_id)
  const stageIds    = [...new Set(runs.map((r: { stage_id: string }) => r.stage_id).filter(Boolean))]

  const { data: lastActivities } = await supabase
    .from('activities')
    .select('contract_id, created_at')
    .in('contract_id', contractIds)
    .order('created_at', { ascending: false })

  const lastActivityByContract = new Map<string, string>()
  for (const a of lastActivities ?? []) {
    if (!lastActivityByContract.has(a.contract_id))
      lastActivityByContract.set(a.contract_id, a.created_at)
  }

  const { data: contracts } = await supabase
    .from('contracts')
    .select('id, client_name')
    .in('id', contractIds)

  const { data: stages } = stageIds.length
    ? await supabase.from('stages').select('id, name').in('id', stageIds)
    : { data: [] as { id: string; name: string }[] }

  const contractNameById = new Map(
    (contracts ?? []).map((c: { id: string; client_name: string }) => [c.id, c.client_name])
  )
  const stageNameById = new Map(
    (stages ?? []).map((s: { id: string; name: string }) => [s.id, s.name])
  )

  const dormant: DormantRun[] = []
  for (const run of runs) {
    const lastActivity  = lastActivityByContract.get(run.contract_id)
    const referenceDate = lastActivity ?? run.stage_entered_at ?? new Date(0).toISOString()
    const daysIdle      = differenceInDays(new Date(), new Date(referenceDate))
    if (daysIdle >= 14) {
      dormant.push({
        contract_id:      run.contract_id,
        client_name:      contractNameById.get(run.contract_id) ?? null,
        value:            run.value,
        stage_name:       run.stage_id ? (stageNameById.get(run.stage_id) ?? null) : null,
        days_idle:        daysIdle,
        stage_entered_at: run.stage_entered_at,
      })
    }
  }

  return dormant.sort((a, b) => (b.value ?? 0) - (a.value ?? 0)).slice(0, 15)
}

// ─── Query 2: Contratos a renovar ─────────────────────────────────────────────
export async function fetchRenewalCandidates(
  supabase: ReturnType<typeof getAdminClient>
): Promise<RenewalCandidate[]> {
  const today    = new Date()
  const in90Days = new Date(today)
  in90Days.setDate(in90Days.getDate() + 90)

  const { data, error } = await supabase
    .from('contracts')
    .select('id, client_name, contract_type, valid_until, monthly_value, abc_curve')
    .lte('valid_until', in90Days.toISOString().slice(0, 10))
    .not('valid_until', 'is', null)
    .order('valid_until', { ascending: true })
    .limit(20)

  if (error) { console.error('[agent] erro renovações:', error.message); return [] }

  return (data ?? []).map((c: {
    id: string; client_name: string; contract_type: string | null
    valid_until: string | null; monthly_value: number | null; abc_curve: string | null
  }) => ({
    id:                c.id,
    client_name:       c.client_name,
    contract_type:     c.contract_type,
    valid_until:       c.valid_until,
    monthly_value:     c.monthly_value,
    days_until_expiry: c.valid_until ? differenceInDays(new Date(c.valid_until), today) : null,
    abc_curve:         c.abc_curve,
  }))
}

// ─── Query 3: Leads estagnados ─────────────────────────────────────────────────
export async function fetchStaleLeds(
  supabase: ReturnType<typeof getAdminClient>
): Promise<StaleLead[]> {
  const cutoff = subDays(new Date(), 30).toISOString()

  const { data, error } = await supabase
    .from('leads')
    .select('id, name, status, score, source, created_at')
    .in('status', ['novo', 'em_qualificacao'])
    .lt('created_at', cutoff)
    .order('score', { ascending: false })
    .limit(15)

  if (error) { console.error('[agent] erro leads:', error.message); return [] }

  return (data ?? []).map((l: {
    id: string; name: string; status: string
    score: number; source: string | null; created_at: string
  }) => ({
    id:                 l.id,
    name:               l.name,
    status:             l.status,
    score:              l.score,
    source:             l.source,
    days_since_created: differenceInDays(new Date(), new Date(l.created_at)),
  }))
}

// ─── Prompt builder ───────────────────────────────────────────────────────────
export function buildPrompt(data: {
  dormant: DormantRun[]
  renewal: RenewalCandidate[]
  stale:   StaleLead[]
  today:   string
}): string {
  const fmt = (rows: unknown[]) =>
    rows.length > 0 ? JSON.stringify(rows, null, 2) : '(sem registos para esta categoria hoje)'

  return `
## Dados do CRM — ${data.today}

Você recebe dados reais do CRM de uma empresa de Engenharia Clínica e Hospitalar.
O ciclo médio de vendas é longo (60-120 dias). Os contratos são B2B complexos com
hospitais e clínicas. O campo abc_curve indica a importância do cliente (A=maior).

---

### 1. Oportunidades no funil de vendas sem actividade há ≥14 dias (${data.dormant.length})
Cada item inclui: cliente, valor estimado, etapa actual e dias sem toque.
${fmt(data.dormant)}

### 2. Contratos a vencer nos próximos 90 dias (${data.renewal.length})
Days_until_expiry negativo = já vencido. Prioriza curva A e B.
${fmt(data.renewal)}

### 3. Leads sem evolução há ≥30 dias (${data.stale.length})
Leads em status inicial (novo/em_qualificação) sem progressão.
${fmt(data.stale)}

---

## Tarefa

Gera um briefing executivo para o Gestor Comercial com estas 4 secções:

🚨 *TOP 3 ACÇÕES URGENTES*
As 3 acções mais críticas desta semana. Para cada uma: nome do cliente/lead, contexto
em 1 frase, e a acção concreta recomendada.

💰 *MAIOR OPORTUNIDADE DA SEMANA*
O negócio ou renovação com maior impacto financeiro imediato. Explica o porquê
e sugere o próximo passo específico.

⚠️ *SINAL DE ALERTA*
Se existir um padrão preocupante nos dados (ex: concentração de deals numa etapa,
contrato de curva A prestes a vencer sem renovação em andamento), aponta-o em 2-3
linhas. Se não houver nada relevante, escreve "Nenhum sinal crítico esta semana."

📊 *SAÚDE DO PIPELINE*
Uma linha de resumo: número de oportunidades activas, valor total estimado em jogo,
e quantas estão em risco (dormentes + renovações urgentes).

---

*Regras de formatação:*
- Pronto para WhatsApp: sem asteriscos duplos, sem markdown pesado
- Usa os emojis das secções acima, mais nenhum
- Máximo 300 palavras no total
- Escreve em português do Brasil
- Nunca inventes dados que não estejam acima
- Se uma secção não tiver dados suficientes, diz isso em uma frase curta
`.trim()
}

// ─── Envio WhatsApp ───────────────────────────────────────────────────────────
export async function sendWhatsApp(text: string): Promise<WhatsAppResult> {
  const baseUrl  = process.env.EVOLUTION_API_URL
  const apiKey   = process.env.EVOLUTION_API_KEY
  const instance = process.env.EVOLUTION_INSTANCE_NAME
  const number   = process.env.WHATSAPP_NUMBER

  if (!baseUrl || !apiKey || !instance || !number) {
    const missing = [
      !baseUrl  && 'EVOLUTION_API_URL',
      !apiKey   && 'EVOLUTION_API_KEY',
      !instance && 'EVOLUTION_INSTANCE_NAME',
      !number   && 'WHATSAPP_NUMBER',
    ].filter(Boolean).join(', ')
    console.error(`[whatsapp] configuração incompleta — variáveis em falta: ${missing}`)
    return { sent: false, error: `Variáveis de ambiente em falta: ${missing}` }
  }

  const cleanNumber = number.replace(/\D/g, '')
  const url         = `${baseUrl.replace(/\/$/, '')}/message/sendText/${instance}`

  console.log(`[whatsapp] target → ${cleanNumber.slice(0, 4)}**** | instância: ${instance}`)
  console.log(`[whatsapp] endpoint → POST ${url}`)

  try {
    const startMs = Date.now()
    const res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': apiKey },
      body: JSON.stringify({
        number:  cleanNumber,
        text,
        options: { delay: 1200, presence: 'composing' },
      }),
    })
    const elapsedMs = Date.now() - startMs
    const body      = await res.json().catch(() => ({}))

    console.log(`[whatsapp] resposta HTTP ${res.status} em ${elapsedMs}ms`)

    if (!res.ok) {
      const detail = body?.message ?? body?.error ?? body?.response?.message ?? res.statusText
      console.error(`[whatsapp] erro Evolution API → ${res.status}: ${detail}`)
      console.error(`[whatsapp] body: ${JSON.stringify(body)}`)
      return { sent: false, error: `Evolution API ${res.status}: ${detail}` }
    }

    console.log(`[whatsapp] entregue → messageId: ${body?.key?.id ?? body?.id ?? '(sem id)'}`)
    return { sent: true, statusCode: res.status }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[whatsapp] erro de rede → ${msg}`)
    return { sent: false, error: `Erro de rede ao contactar Evolution API: ${msg}` }
  }
}

// ─── Serializa qualquer erro para string legível ──────────────────────────────
// A SDK da Anthropic pode lançar objectos com .status, .error.message, etc.
function serializeError(err: unknown): string {
  if (err instanceof Error) {
    // Tenta extrair campos específicos da Anthropic SDK / AI SDK
    const e = err as Error & {
      status?: number
      statusCode?: number
      error?: { message?: string; type?: string }
      cause?: unknown
    }

    const parts: string[] = [`${e.constructor?.name ?? 'Error'}: ${e.message}`]

    if (e.status || e.statusCode) {
      parts.push(`HTTP ${e.status ?? e.statusCode}`)
    }
    if (e.error?.type)    parts.push(`type: ${e.error.type}`)
    if (e.error?.message) parts.push(`api_error: ${e.error.message}`)
    if (e.cause)          parts.push(`cause: ${serializeError(e.cause)}`)

    return parts.join(' | ')
  }

  // Fallback: serializa como JSON para capturar objectos não-Error
  try {
    return JSON.stringify(err)
  } catch {
    return String(err)
  }
}

// ─── Função principal — gera o briefing completo ──────────────────────────────
// Chamada directamente pelo Server Component E pelo route.ts (sem fetch HTTP).
export async function generateBriefing(opts: {
  sendViaWhatsApp: boolean
}): Promise<BriefingResult | BriefingError> {

  // ── 1. Verifica variáveis obrigatórias ANTES de qualquer I/O ────────────────
  console.log('[agent] verificando variáveis de ambiente...')

  const missingVars: string[] = []
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL)  missingVars.push('NEXT_PUBLIC_SUPABASE_URL')
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) missingVars.push('SUPABASE_SERVICE_ROLE_KEY')
  if (!process.env.ANTHROPIC_API_KEY)         missingVars.push('ANTHROPIC_API_KEY')

  if (missingVars.length > 0) {
    const msg = `Variáveis de ambiente em falta no Vercel: ${missingVars.join(', ')}`
    console.error(`[agent] ${msg}`)
    return { ok: false, error: msg }
  }

  // Log parcial da key para confirmar que foi lida (nunca loga a key completa)
  const keyPreview = process.env.ANTHROPIC_API_KEY!
  console.log(`[agent] ANTHROPIC_API_KEY presente — prefixo: ${keyPreview.slice(0, 7)}... (${keyPreview.length} chars)`)

  // ── 2. Queries ao Supabase ───────────────────────────────────────────────────
  const today    = format(new Date(), "EEEE, dd 'de' MMMM 'de' yyyy", { locale: ptBR })
  const supabase = getAdminClient()

  console.log('[agent] iniciando queries ao Supabase...')
  let dormant: DormantRun[], renewal: RenewalCandidate[], stale: StaleLead[]
  try {
    ;[dormant, renewal, stale] = await Promise.all([
      fetchDormantOpportunities(supabase),
      fetchRenewalCandidates(supabase),
      fetchStaleLeds(supabase),
    ])
  } catch (err) {
    const msg = `Erro nas queries ao Supabase: ${serializeError(err)}`
    console.error(`[agent] ${msg}`)
    return { ok: false, error: msg }
  }

  console.log(
    `[agent] dados carregados — ${dormant.length} dormentes, ` +
    `${renewal.length} renovações, ${stale.length} leads estagnados`
  )

  // ── 3. Chamada ao LLM via @anthropic-ai/sdk (SDK oficial, sem camada intermédia)
  console.log('[agent] chamando Anthropic API — modelo: claude-3-5-haiku-20241022')
  let briefing: string
  let usage: { promptTokens: number; completionTokens: number }

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

    // claude-haiku-4-5 é o Haiku mais recente disponível na API Anthropic.
    // Se a tua conta ainda não tiver acesso, tenta 'claude-3-haiku-20240307'.
    const response = await client.messages.create({
      model:      'claude-haiku-4-5',
      max_tokens: 900,
      system: `Você é o Copiloto Estratégico de uma empresa brasileira de Engenharia Clínica e Hospitalar.
Analisa dados de CRM de vendas B2B complexas e consultivas (hospitais, clínicas, equipamentos médicos).
Gera briefings executivos concisos, precisos e acionáveis em português do Brasil.
Nunca inventa informações. Baseia-se exclusivamente nos dados fornecidos.
Tom: profissional e directo, como um analista sénior reportando ao gestor.`,
      messages: [
        { role: 'user', content: buildPrompt({ dormant, renewal, stale, today }) }
      ],
    })

    // Extrai o texto da resposta
    const block = response.content.find(b => b.type === 'text')
    briefing = block && block.type === 'text' ? block.text : ''
    usage = {
      promptTokens:     response.usage.input_tokens,
      completionTokens: response.usage.output_tokens,
    }
  } catch (err) {
    const detail = serializeError(err)
    console.error('[agent] ERRO na chamada Anthropic API:')
    console.error(err)   // log do objecto completo nos Vercel Logs
    const msg = `Falha na chamada ao modelo Anthropic: ${detail}`
    return { ok: false, error: msg }
  }

  console.log('\n========================================')
  console.log('COPILOTO ESTRATÉGICO — BRIEFING')
  console.log('========================================')
  console.log(briefing)
  console.log('========================================')
  console.log(
    `[agent] tokens — input: ${usage.promptTokens} | output: ${usage.completionTokens} | ` +
    `custo: ~$${((usage.promptTokens * 0.0008 + usage.completionTokens * 0.004) / 1000).toFixed(4)}`
  )

  // ── 4. Envio WhatsApp (não-bloqueante) ──────────────────────────────────────
  let whatsapp: WhatsAppResult = { sent: false, error: 'Envio WhatsApp desactivado nesta chamada' }
  if (opts.sendViaWhatsApp) {
    console.log('[agent] enviando via WhatsApp...')
    whatsapp = await sendWhatsApp(briefing)
    if (whatsapp.sent) {
      console.log(`[agent] ✓ WhatsApp entregue (HTTP ${whatsapp.statusCode})`)
    } else {
      console.error(`[agent] ✗ falha WhatsApp — ${whatsapp.error}`)
    }
  }

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    stats: {
      dormantOpportunities: dormant.length,
      renewalCandidates:    renewal.length,
      staleLeads:           stale.length,
      tokensInput:          usage.promptTokens,
      tokensOutput:         usage.completionTokens,
    },
    briefing,
    whatsapp,
  }
}
