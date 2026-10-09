/**
 * Copiloto Estratégico — Agente de IA Analítico
 *
 * Rota: GET /api/agent/briefing
 * Cron:  Segunda e Quinta às 07h (configurado em vercel.json)
 *
 * Fase 1 (MVP): lê Supabase → chama LLM → devolve briefing em JSON + console.log
 * Fase 2: adicionar envio via Evolution API (WhatsApp)
 *
 * Variáveis de ambiente necessárias:
 *   CRON_SECRET              — segredo partilhado para autenticar chamadas do cron
 *   ANTHROPIC_API_KEY        — chave da Anthropic (Vercel AI SDK lê automaticamente)
 *   NEXT_PUBLIC_SUPABASE_URL — já existe no projeto
 *   SUPABASE_SERVICE_ROLE_KEY — chave de admin do Supabase (nunca exposta ao cliente)
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { generateText } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { subDays, subMonths, format, differenceInDays } from 'date-fns'
import { ptBR } from 'date-fns/locale'

// ─── Segurança ─────────────────────────────────────────────────────────────────
// O Vercel Cron não suporta headers customizados, por isso também aceita
// o secret via query param (?cron_secret=...).
function isAuthorized(req: NextRequest): boolean {
  const headerSecret = req.headers.get('x-cron-secret')
  const querySecret  = new URL(req.url).searchParams.get('cron_secret')
  const expected     = process.env.CRON_SECRET
  if (!expected) {
    console.warn('[agent] CRON_SECRET não configurado — rota desprotegida!')
    return true // permite em dev sem secret configurado
  }
  return headerSecret === expected || querySecret === expected
}

// ─── Cliente Supabase com privilégios de admin ─────────────────────────────────
// Usa a Service Role Key para contornar RLS e ler todos os tenants.
// Este cliente NUNCA deve ser exposto ao browser.
function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

// ─── Tipos ─────────────────────────────────────────────────────────────────────
type DormantRun = {
  contract_id: string
  client_name: string | null
  value: number | null
  stage_name: string | null
  days_idle: number
  stage_entered_at: string | null
}

type RenewalCandidate = {
  id: string
  client_name: string
  contract_type: string | null
  valid_until: string | null
  monthly_value: number | null
  days_until_expiry: number | null
  abc_curve: string | null
}

type StaleLead = {
  id: string
  name: string
  status: string
  score: number
  source: string | null
  days_since_created: number
}

// ─── Query 1: Oportunidades abertas sem actividade no funil de vendas ──────────
// Usa pipeline_runs (status='open') cruzado com a tabela activities.
// "Dormente" = nenhuma actividade nos últimos 14 dias para aquele contract_id.
async function fetchDormantOpportunities(
  supabase: ReturnType<typeof getAdminClient>
): Promise<DormantRun[]> {
  const cutoffActivity = subDays(new Date(), 14).toISOString()

  // 1a. Busca todos os pipeline_runs abertos nos funis de VENDAS
  //     (pipelines de tipo 'vendas' — ajusta o filtro se o teu campo for diferente)
  const { data: salesPipelines } = await supabase
    .from('pipelines')
    .select('id')
    .eq('type', 'vendas') // 🔧 ajusta se o teu type for diferente (ex: 'comercial', 'sales')

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

  if (runsErr) {
    console.error('[agent] erro ao buscar pipeline_runs:', runsErr.message)
    return []
  }
  if (!runs || runs.length === 0) return []

  const contractIds = runs.map((r: { contract_id: string }) => r.contract_id)
  const stageIds    = [...new Set(runs.map((r: { stage_id: string }) => r.stage_id).filter(Boolean))]

  // 1b. Busca a última actividade de cada contrato
  const { data: lastActivities } = await supabase
    .from('activities')
    .select('contract_id, created_at')
    .in('contract_id', contractIds)
    .order('created_at', { ascending: false })

  // Mapeia contract_id → data da actividade mais recente
  const lastActivityByContract = new Map<string, string>()
  for (const a of lastActivities ?? []) {
    if (!lastActivityByContract.has(a.contract_id)) {
      lastActivityByContract.set(a.contract_id, a.created_at)
    }
  }

  // 1c. Busca nomes dos contratos e das stages
  const { data: contracts } = await supabase
    .from('contracts')
    .select('id, client_name')
    .in('id', contractIds)

  const { data: stages } = stageIds.length
    ? await supabase.from('stages').select('id, name').in('id', stageIds)
    : { data: [] as { id: string; name: string }[] }

  const contractNameById = new Map((contracts ?? []).map((c: { id: string; client_name: string }) => [c.id, c.client_name]))
  const stageNameById    = new Map((stages ?? []).map((s: { id: string; name: string }) => [s.id, s.name]))

  // 1d. Filtra os que não têm actividade há mais de 14 dias
  const dormant: DormantRun[] = []
  for (const run of runs) {
    const lastActivity = lastActivityByContract.get(run.contract_id)
    const referenceDate = lastActivity ?? run.stage_entered_at ?? new Date(0).toISOString()
    const daysIdle = differenceInDays(new Date(), new Date(referenceDate))

    if (daysIdle >= 14) {
      dormant.push({
        contract_id:     run.contract_id,
        client_name:     contractNameById.get(run.contract_id) ?? null,
        value:           run.value,
        stage_name:      run.stage_id ? (stageNameById.get(run.stage_id) ?? null) : null,
        days_idle:       daysIdle,
        stage_entered_at: run.stage_entered_at,
      })
    }
  }

  // Ordena por valor decrescente e limita a 15
  return dormant
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
    .slice(0, 15)
}

// ─── Query 2: Contratos próximos do vencimento (candidatos a renovação) ─────────
// Usa a tabela contracts com o campo valid_until.
// Identifica contratos que vencem nos próximos 90 dias — atenção especial para os
// da curva ABC A e B. Também captura contratos já vencidos (renovação atrasada).
async function fetchRenewalCandidates(
  supabase: ReturnType<typeof getAdminClient>
): Promise<RenewalCandidate[]> {
  const today      = new Date()
  const in90Days   = new Date(today)
  in90Days.setDate(in90Days.getDate() + 90)

  // Busca contratos com valid_until nos próximos 90 dias (ou já vencidos)
  // 🔧 Se tiveres contratos de "medição" que não têm valid_until, ajusta o filtro
  const { data, error } = await supabase
    .from('contracts')
    .select('id, client_name, contract_type, valid_until, monthly_value, abc_curve')
    .lte('valid_until', in90Days.toISOString().slice(0, 10)) // vence em até 90 dias
    .not('valid_until', 'is', null)
    .order('valid_until', { ascending: true })
    .limit(20)

  if (error) {
    console.error('[agent] erro ao buscar renovações:', error.message)
    return []
  }

  return (data ?? []).map((c: {
    id: string
    client_name: string
    contract_type: string | null
    valid_until: string | null
    monthly_value: number | null
    abc_curve: string | null
  }) => ({
    id:               c.id,
    client_name:      c.client_name,
    contract_type:    c.contract_type,
    valid_until:      c.valid_until,
    monthly_value:    c.monthly_value,
    days_until_expiry: c.valid_until
      ? differenceInDays(new Date(c.valid_until), today)
      : null,
    abc_curve:        c.abc_curve,
  }))
}

// ─── Query 3: Leads antigos sem conversão ──────────────────────────────────────
// Leads criados há mais de 30 dias ainda nos status iniciais (novo, em_qualificacao).
// Estes são candidatos a recuperação ou descarte definitivo.
async function fetchStaleLeds(
  supabase: ReturnType<typeof getAdminClient>
): Promise<StaleLead[]> {
  const cutoff = subDays(new Date(), 30).toISOString()

  const { data, error } = await supabase
    .from('leads')
    .select('id, name, status, score, source, created_at')
    .in('status', ['novo', 'em_qualificacao']) // 🔧 ajusta se os teus status forem diferentes
    .lt('created_at', cutoff)
    .order('score', { ascending: false })
    .limit(15)

  if (error) {
    console.error('[agent] erro ao buscar leads estagnados:', error.message)
    return []
  }

  return (data ?? []).map((l: {
    id: string
    name: string
    status: string
    score: number
    source: string | null
    created_at: string
  }) => ({
    id:                  l.id,
    name:                l.name,
    status:              l.status,
    score:               l.score,
    source:              l.source,
    days_since_created:  differenceInDays(new Date(), new Date(l.created_at)),
  }))
}

// ─── Construção do prompt ───────────────────────────────────────────────────────
function buildPrompt(data: {
  dormant:  DormantRun[]
  renewal:  RenewalCandidate[]
  stale:    StaleLead[]
  today:    string
}): string {
  const fmt = (rows: unknown[]) =>
    rows.length > 0
      ? JSON.stringify(rows, null, 2)
      : '(sem registos para esta categoria hoje)'

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

// ─── Handler principal ──────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  // 1. Autorização
  if (!isAuthorized(req)) {
    console.warn('[agent] tentativa de acesso não autorizada')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const today    = format(new Date(), "EEEE, dd 'de' MMMM 'de' yyyy", { locale: ptBR })
  const supabase = getAdminClient()

  try {
    // 2. Queries paralelas ao Supabase
    console.log('[agent] iniciando análise do CRM...')
    const [dormant, renewal, stale] = await Promise.all([
      fetchDormantOpportunities(supabase),
      fetchRenewalCandidates(supabase),
      fetchStaleLeds(supabase),
    ])

    console.log(
      `[agent] dados carregados — ` +
      `${dormant.length} oportunidades dormentes, ` +
      `${renewal.length} contratos para renovar, ` +
      `${stale.length} leads estagnados`
    )

    // 3. Chamada ao LLM via Vercel AI SDK
    console.log('[agent] gerando briefing com Claude Haiku...')
    const { text: briefing, usage } = await generateText({
      model: anthropic('claude-3-5-haiku-20241022'),
      system: `Você é o Copiloto Estratégico de uma empresa brasileira de Engenharia Clínica e Hospitalar.
Analisa dados de CRM de vendas B2B complexas e consultivas (hospitais, clínicas, equipamentos médicos).
Gera briefings executivos concisos, precisos e acionáveis em português do Brasil.
Nunca inventa informações. Baseia-se exclusivamente nos dados fornecidos.
Tom: profissional e directo, como um analista sénior reportando ao gestor.`,
      prompt: buildPrompt({ dormant, renewal, stale, today }),
      maxTokens: 900,
      temperature: 0.2, // análise factual: temperatura baixa para máxima precisão
    })

    // 4. Log do resultado (Fase 1 — sem Evolution API ainda)
    console.log('\n========================================')
    console.log('COPILOTO ESTRATÉGICO — BRIEFING GERADO')
    console.log('========================================')
    console.log(briefing)
    console.log('========================================')
    console.log(
      `[agent] tokens — input: ${usage.promptTokens} | output: ${usage.completionTokens} | ` +
      `custo estimado: ~$${((usage.promptTokens * 0.0008 + usage.completionTokens * 0.004) / 1000).toFixed(4)}`
    )

    // 5. Resposta JSON (útil para debug via curl ou Vercel Logs)
    return NextResponse.json({
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
      // FASE 2: descomentar e implementar envio via Evolution API
      // whatsappSent: false,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido'
    console.error('[agent] erro crítico:', message)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
