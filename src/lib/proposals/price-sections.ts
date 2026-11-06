// ─── Proposta espelhando a "Apresentação ao Cliente" do Price ──────────────────
// O Price manda a apresentação já calculada (seções com texto e tabelas, e os itens).
// Aqui cada seção vira um bloco da montagem (source='price'), na mesma ordem, antes dos
// blocos adicionados à mão. Na montagem dá para editar ou excluir cada bloco; uma seção
// excluída fica em proposals.price_sections_hidden e não volta ao reenviar do Price
// (só pelo botão "Trazer de volta").
// Seções que entram por padrão: organization_settings.price_sections (nulo = todas).

export type PriceSecao = { chave: string; titulo: string; texto?: string; tabela?: string[][] }
export type PriceItem = { titulo: string; descricao?: string; valorMensal: number; tipo?: string }
export type PriceApresentacao = {
  versao: number
  estrategia?: string
  duracaoMeses?: number
  valorMensal?: number
  valorTotal?: number
  secoes: PriceSecao[]
  itens?: PriceItem[]
}

// Seções conhecidas (rótulos da configuração). Seções novas do Price entram mesmo sem estar aqui.
export const PRICE_SECTIONS: { key: string; label: string }[] = [
  { key: 'objeto', label: 'Objeto do contrato' },
  { key: 'escopo', label: 'Escopo do contrato (parque e serviços)' },
  { key: 'equipe', label: 'Estrutura humana' },
  { key: 'sla', label: 'Acordo de nível de serviço (SLA)' },
  { key: 'intervencoes', label: 'Natureza das intervenções' },
  { key: 'diretrizes', label: 'Diretrizes de atendimento' },
  { key: 'investimento', label: 'Investimento comercial (formato escolhido no Price)' },
  { key: 'resumo', label: 'Resumo do investimento global' },
]

export function readApresentacao(snapshot: unknown): PriceApresentacao | null {
  const a = (snapshot as { apresentacao?: PriceApresentacao } | null)?.apresentacao
  if (!a || !Array.isArray(a.secoes)) return null
  return {
    ...a,
    secoes: a.secoes
      .filter(s => s && typeof s.chave === 'string' && typeof s.titulo === 'string')
      .map(s => ({
        chave: String(s.chave).slice(0, 60),
        titulo: String(s.titulo).slice(0, 200),
        texto: typeof s.texto === 'string' ? s.texto.slice(0, 20000) : undefined,
        tabela: Array.isArray(s.tabela)
          ? s.tabela.slice(0, 200).map(r => (Array.isArray(r) ? r.slice(0, 12).map(c => String(c ?? '').slice(0, 500)) : []))
          : undefined,
      })),
    itens: Array.isArray(a.itens)
      ? a.itens.filter(i => i && typeof i.titulo === 'string' && Number.isFinite(Number(i.valorMensal))).slice(0, 20)
      : undefined,
  }
}

// Seções que entram nesta proposta: as habilitadas da empresa, menos as excluídas na proposta.
export function sectionsToApply(a: PriceApresentacao, enabled: string[] | null | undefined, hidden: string[] | null | undefined) {
  const on = Array.isArray(enabled) ? new Set(enabled) : null
  const off = new Set(hidden ?? [])
  return a.secoes.filter(s => (on ? on.has(s.chave) || !PRICE_SECTIONS.some(p => p.key === s.chave) : true) && !off.has(s.chave))
}

type Db = {
  from: (t: string) => any // eslint-disable-line @typescript-eslint/no-explicit-any
}

// Grava as seções como blocos. mode 'replace': refaz todos os blocos do Price (reenvio);
// mode 'missing': só cria os que faltam (botão "Trazer de volta").
export async function writePriceBlocks(
  db: Db,
  args: { proposalId: string; tenantId: string; secoes: PriceSecao[]; headerColor?: string | null; mode: 'replace' | 'missing' },
): Promise<{ error: string | null; created: number }> {
  const { proposalId, tenantId, secoes, mode } = args
  const color = args.headerColor || '#1B556B'
  const { data: existing } = await db.from('proposal_content_blocks')
    .select('id, source, section_key, position').eq('proposal_id', proposalId).eq('tenant_id', tenantId).order('position')
  const all = (existing ?? []) as { id: string; source: string | null; section_key: string | null; position: number }[]
  const priceBlocks = all.filter(b => b.source === 'price')
  let toInsert = secoes
  if (mode === 'replace') {
    if (priceBlocks.length) {
      const { error } = await db.from('proposal_content_blocks').delete().in('id', priceBlocks.map(b => b.id)).eq('tenant_id', tenantId)
      if (error) return { error: error.message, created: 0 }
    }
  } else {
    const have = new Set(priceBlocks.map(b => b.section_key))
    toInsert = secoes.filter(s => !have.has(s.chave))
  }
  if (!toInsert.length) return { error: null, created: 0 }

  // Ordem: seções do Price na ordem da apresentação, depois os blocos manuais.
  const order = new Map(secoes.map((s, i) => [s.chave, i]))
  const manual = all.filter(b => b.source !== 'price')
  const rows = toInsert.map(s => ({
    proposal_id: proposalId,
    tenant_id: tenantId,
    source: 'price',
    section_key: s.chave,
    title: s.titulo,
    block_type: s.tabela && s.tabela.length > 1 ? 'table' : 'text',
    introduction: s.texto ?? null,
    table_data: s.tabela && s.tabela.length > 1 ? { rows: s.tabela } : null,
    header_color: color,
    text_align: 'left',
    show_totals: false,
    position: order.get(s.chave) ?? 0,
  }))
  const { error } = await db.from('proposal_content_blocks').insert(rows)
  if (error) return { error: error.message, created: 0 }

  // Reordena: Price (ordem da apresentação) e depois os manuais (ordem atual)
  const { data: fresh } = await db.from('proposal_content_blocks')
    .select('id, source, section_key, position').eq('proposal_id', proposalId).eq('tenant_id', tenantId).order('position')
  const f = (fresh ?? []) as typeof all
  const price = f.filter(b => b.source === 'price').sort((a, b) => (order.get(a.section_key ?? '') ?? 99) - (order.get(b.section_key ?? '') ?? 99))
  const manualIds = new Set(manual.map(b => b.id))
  const rest = f.filter(b => b.source !== 'price' && manualIds.has(b.id))
  const final = [...price, ...rest, ...f.filter(b => b.source !== 'price' && !manualIds.has(b.id))]
  await Promise.all(final.map((b, i) => (b.position === i ? null : db.from('proposal_content_blocks').update({ position: i }).eq('id', b.id).eq('tenant_id', tenantId))))
  return { error: null, created: rows.length }
}
