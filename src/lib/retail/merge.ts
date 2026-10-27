// ─── Varejo: juntar cadastros da mesma peça (regras puras, sem imports) ───────
// Muitas lojas cadastram cada cor com um código (ex.: PROV002, PROV002-AZ, PROV002-PT).
// Juntar deixa uma peça só com várias cores: 1 linha no Drone e 1 cartão com as cores na vitrine.

export type MergeMember = { id: string; code: string; name: string; colors: (string | null)[]; price: number | null; promo_price: number | null; status: string; photos: number; stock: number }

// Nome comparável: sem acento, minúsculo, espaços simples
export const nameKey = (name: string) => String(name ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
export const colorKey = (c: string | null) => nameKey(c ?? '')

// Sugestões: cadastros com o mesmo nome (2 ou mais), maiores grupos primeiro
export function suggestGroups<T extends { name: string; status: string }>(list: T[]): T[][] {
  const by = new Map<string, T[]>()
  for (const p of list) {
    if (p.status === 'arquivado') continue
    const k = nameKey(p.name)
    if (!k) continue
    by.set(k, [...(by.get(k) ?? []), p])
  }
  return [...by.values()].filter(g => g.length > 1).sort((a, b) => b.length - a.length || nameKey(a[0].name).localeCompare(nameKey(b[0].name)))
}

// Principal sugerida: a com mais cores; depois a publicada; depois a com preço; depois a com mais fotos
export function pickMain(g: MergeMember[]): MergeMember {
  return [...g].sort((a, b) =>
    b.colors.length - a.colors.length
    || Number(b.status === 'publicado') - Number(a.status === 'publicado')
    || Number(b.price !== null) - Number(a.price !== null)
    || b.photos - a.photos)[0]
}

// Preços diferentes no grupo? (aí a pessoa escolhe qual fica)
export const samePrice = (g: MergeMember[]) => new Set(g.map(m => `${m.price ?? ''}|${m.promo_price ?? ''}`)).size === 1

// Cadastro precisa de nome de cor antes de juntar: está sem cor ou a cor já existe em outro cadastro
// do grupo (só dá para renomear cadastro com uma cor). Retorna o motivo ou null.
export function colorIssue(m: MergeMember, group: MergeMember[], renamed: Record<string, string>): string | null {
  const mine = [...new Set(m.colors.map(colorKey))]
  if (mine.length !== 1) return null
  const now = renamed[m.id]?.trim() ? colorKey(renamed[m.id]) : mine[0]
  if (!now) return 'sem cor'
  const others = group.filter(x => x.id !== m.id).flatMap(x => {
    const xs = [...new Set(x.colors.map(colorKey))]
    return xs.length === 1 && renamed[x.id]?.trim() ? [colorKey(renamed[x.id])] : xs
  })
  return others.includes(now) ? 'cor repetida' : null
}

export function photosAfter(g: MergeMember[]) { return g.reduce((t, m) => t + m.photos, 0) }
