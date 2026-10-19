// ─── Plano de ação (tratativas PDCA) ──────────────────────────────────────────
// Cada tratativa segue o PDCA: Planejar (problema, prioridade GUT, causa raiz
// por 5 Porquês ou Ishikawa, ações em 5W2H) → Executar → Checar (eficácia) →
// Agir (padronizar). Cada empresa liga as ferramentas que usa em
// Configurações → Plano de ação (organization_settings.action_plan_settings).
// Sem 'use server': usado no servidor e na tela.

export type CauseMethod = 'cinco_porques' | 'ishikawa' | 'livre'
export type GutScale = { g: string[]; u: string[]; t: string[] }   // 5 descrições cada (nota 1 a 5)
export type GutBands = { high: number; medium: number }            // G×U×T a partir de: alta / média

export type ActionPlanSettings = {
  tools: { w5h2: boolean; cinco_porques: boolean; ishikawa: boolean; gut: boolean }
  require_efficacy: boolean
  ishikawa_categories: { key: string; label: string }[]
  default_method: CauseMethod
  gut_scale: GutScale
  gut_bands: GutBands
}

export const DEFAULT_ISHIKAWA: { key: string; label: string }[] = [
  { key: 'metodo', label: 'Método' },
  { key: 'pessoas', label: 'Pessoas' },
  { key: 'material', label: 'Material / peças' },
  { key: 'equipamento', label: 'Equipamento' },
  { key: 'medicao', label: 'Medição' },
  { key: 'ambiente', label: 'Ambiente' },
]

export const DEFAULT_GUT_SCALE: GutScale = {
  g: ['Sem gravidade', 'Pouco grave', 'Grave', 'Muito grave', 'Extremamente grave'],
  u: ['Pode esperar', 'Pouco urgente', 'Urgente, merece atenção curta', 'Muito urgente', 'Ação imediata'],
  t: ['Não vai piorar', 'Piora a longo prazo', 'Piora a médio prazo', 'Piora a curto prazo', 'Piora rápido'],
}
export const DEFAULT_GUT_BANDS: GutBands = { high: 64, medium: 27 }

export const DEFAULT_ACTION_PLAN_SETTINGS: ActionPlanSettings = {
  tools: { w5h2: true, cinco_porques: true, ishikawa: true, gut: true },
  require_efficacy: false,
  ishikawa_categories: DEFAULT_ISHIKAWA,
  default_method: 'cinco_porques',
  gut_scale: DEFAULT_GUT_SCALE,
  gut_bands: DEFAULT_GUT_BANDS,
}

// Métodos de análise de causa que a empresa deixou disponíveis (sempre inclui a causa raiz direta)
export function availableMethods(s: Pick<ActionPlanSettings, 'tools'>): CauseMethod[] {
  return [s.tools.cinco_porques && 'cinco_porques', s.tools.ishikawa && 'ishikawa', 'livre'].filter(Boolean) as CauseMethod[]
}

export function resolveActionPlanSettings(raw: unknown): ActionPlanSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const t = (r.tools && typeof r.tools === 'object' ? r.tools : {}) as Record<string, unknown>
  const on = (v: unknown) => v !== false
  const cats = Array.isArray(r.ishikawa_categories)
    ? (r.ishikawa_categories as unknown[]).map(c => {
        const o = (c && typeof c === 'object' ? c : {}) as Record<string, unknown>
        const label = typeof o.label === 'string' ? o.label.trim().slice(0, 40) : ''
        const key = typeof o.key === 'string' && o.key ? o.key.slice(0, 30) : ''
        return { key, label }
      }).filter(c => c.key && c.label).slice(0, 8)
    : DEFAULT_ISHIKAWA
  const tools = { w5h2: on(t.w5h2), cinco_porques: on(t.cinco_porques), ishikawa: on(t.ishikawa), gut: on(t.gut) }
  const sc = (r.gut_scale && typeof r.gut_scale === 'object' ? r.gut_scale : {}) as Record<string, unknown>
  const levels = (v: unknown, def: string[]) => def.map((d, i) => {
    const x = Array.isArray(v) && typeof v[i] === 'string' ? (v[i] as string).trim().slice(0, 60) : ''
    return x || d
  })
  const bd = (r.gut_bands && typeof r.gut_bands === 'object' ? r.gut_bands : {}) as Record<string, unknown>
  const num = (v: unknown, def: number) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= 1 && n <= 125 ? n : def }
  let high = num(bd.high, DEFAULT_GUT_BANDS.high), medium = num(bd.medium, DEFAULT_GUT_BANDS.medium)
  if (medium >= high) { high = DEFAULT_GUT_BANDS.high; medium = DEFAULT_GUT_BANDS.medium }
  const methods = availableMethods({ tools })
  const dm = r.default_method as CauseMethod
  return {
    tools,
    require_efficacy: r.require_efficacy === true,
    ishikawa_categories: cats.length ? cats : DEFAULT_ISHIKAWA,
    default_method: methods.includes(dm) ? dm : methods[0],
    gut_scale: { g: levels(sc.g, DEFAULT_GUT_SCALE.g), u: levels(sc.u, DEFAULT_GUT_SCALE.u), t: levels(sc.t, DEFAULT_GUT_SCALE.t) },
    gut_bands: { high, medium },
  }
}

export type PlanPhase = 'plan' | 'do' | 'check' | 'act' | 'closed' | 'cancelled'
export type PlanOrigin = 'nps' | 'sla' | 'reclamacao' | 'auditoria' | 'renovacao' | 'interno' | 'outro'

export const ORIGIN_LABEL: Record<PlanOrigin, string> = {
  nps: 'Pesquisa / NPS', sla: 'SLA descumprido', reclamacao: 'Reclamação do cliente', auditoria: 'Auditoria / visita',
  renovacao: 'Risco na renovação', interno: 'Identificado pelo time', outro: 'Outro',
}

export const PHASE_LABEL: Record<PlanPhase, string> = {
  plan: 'Planejar', do: 'Executar', check: 'Checar', act: 'Agir', closed: 'Encerrada', cancelled: 'Cancelada',
}

// G × U × T (1 a 125); null se faltar nota
export function gutScore(g: number | null | undefined, u: number | null | undefined, t: number | null | undefined): number | null {
  if (!g || !u || !t) return null
  return g * u * t
}

export function gutBand(score: number | null, bands: GutBands = DEFAULT_GUT_BANDS): { label: string; tone: 'neg' | 'warn' | 'ok' | 'none' } {
  if (score === null) return { label: 'Sem prioridade', tone: 'none' }
  if (score >= bands.high) return { label: 'Prioridade alta', tone: 'neg' }
  if (score >= bands.medium) return { label: 'Prioridade média', tone: 'warn' }
  return { label: 'Prioridade baixa', tone: 'ok' }
}

// Métodos de análise de causa: quando usar e um exemplo preenchido (texto neutro, vale para qualquer empresa)
export const CAUSE_METHODS: Record<CauseMethod, {
  label: string; when: string
  example: { problem: string; whys?: string[]; ishikawa?: { category: string; causes: string[] }[]; root: string }
}> = {
  cinco_porques: {
    label: '5 Porquês',
    when: 'Problema pontual, com uma causa em cadeia. Rápido: pergunte "por quê?" sobre a resposta anterior até chegar a algo que dá para corrigir.',
    example: {
      problem: 'Cliente avaliou o atendimento com nota 3.',
      whys: [
        'Por quê? O chamado dele demorou 3 dias para ser resolvido.',
        'Por quê? A peça de reposição não estava em estoque.',
        'Por quê? O pedido da peça só foi feito depois do diagnóstico.',
        'Por quê? Não existe estoque mínimo para as peças que mais quebram.',
        'Por quê? Ninguém acompanha quais peças são mais usadas.',
      ],
      root: 'Falta controle de estoque mínimo das peças de maior giro.',
    },
  },
  ishikawa: {
    label: 'Ishikawa (espinha de peixe)',
    when: 'Problema que se repete ou tem várias causas possíveis. Liste as causas por categoria e depois escolha a principal.',
    example: {
      problem: 'Prazos de atendimento (SLA) estourados em vários meses.',
      ishikawa: [
        { category: 'Método', causes: ['Chamados atendidos por ordem de chegada, sem prioridade'] },
        { category: 'Pessoas', causes: ['Equipe reduzida no turno da tarde', 'Falta de treinamento em um tipo de equipamento'] },
        { category: 'Material / peças', causes: ['Peças críticas sem estoque'] },
        { category: 'Medição', causes: ['SLA só é conferido no fim do mês'] },
      ],
      root: 'Sem priorização por criticidade e sem acompanhamento diário do SLA.',
    },
  },
  livre: {
    label: 'Só a causa raiz',
    when: 'A causa já é conhecida ou o problema é simples. Escreva direto a causa e siga para as ações.',
    example: { problem: 'Relatório mensal enviado ao cliente com atraso.', root: 'O responsável pelo envio estava de férias e não havia substituto definido.' },
  },
}

export type ActionLite = { status: string }

// Próximas fases possíveis a partir do estado atual (o servidor confere de novo)
export function nextPhaseCheck(phase: PlanPhase, actions: ActionLite[], requireEfficacy: boolean):
  { to: PlanPhase; label: string; blocked: string | null }[] {
  const open = actions.filter(a => a.status !== 'done').length
  switch (phase) {
    case 'plan':
      return [{ to: 'do', label: 'Iniciar execução', blocked: actions.length ? null : 'Cadastre ao menos uma ação.' }]
    case 'do': {
      const blocked = open ? `Faltam ${open} ação(ões) concluídas.` : null
      return requireEfficacy
        ? [{ to: 'check', label: 'Verificar eficácia', blocked }]
        : [{ to: 'check', label: 'Verificar eficácia', blocked }, { to: 'closed', label: 'Encerrar sem verificar', blocked }]
    }
    case 'act':
      return [{ to: 'closed', label: 'Encerrar tratativa', blocked: null }]
    default:
      return []
  }
}

// Ordem da lista: abertas primeiro, maior GUT primeiro, mais recentes primeiro
export function sortPlans<T extends { phase: string; gut_g: number | null; gut_u: number | null; gut_t: number | null; created_at: string }>(plans: T[]): T[] {
  const openRank = (p: string) => (p === 'closed' || p === 'cancelled' ? 1 : 0)
  return [...plans].sort((a, b) =>
    openRank(a.phase) - openRank(b.phase)
    || (gutScore(b.gut_g, b.gut_u, b.gut_t) ?? 0) - (gutScore(a.gut_g, a.gut_u, a.gut_t) ?? 0)
    || b.created_at.localeCompare(a.created_at))
}

// Limpa os 5 Porquês (até 5 respostas, sem vazios no fim)
export function cleanWhys(v: unknown): string[] {
  const arr = Array.isArray(v) ? v.map(x => (typeof x === 'string' ? x.trim().slice(0, 300) : '')) : []
  while (arr.length && !arr[arr.length - 1]) arr.pop()
  return arr.slice(0, 5)
}

// Limpa o Ishikawa: só categorias conhecidas, até 6 causas de 200 caracteres cada
export function cleanIshikawa(v: unknown, categories: { key: string }[]): Record<string, string[]> {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  const out: Record<string, string[]> = {}
  for (const c of categories) {
    const list = Array.isArray(o[c.key]) ? (o[c.key] as unknown[]) : []
    const items = list.map(x => (typeof x === 'string' ? x.trim().slice(0, 200) : '')).filter(Boolean).slice(0, 6)
    if (items.length) out[c.key] = items
  }
  return out
}
