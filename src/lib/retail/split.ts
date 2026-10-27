// ─── Varejo: separar cores e tamanhos que vieram juntos numa linha (regras puras) ───
// Ex.: cor "Dark Blue / Mocha Mousse", tamanho "G / G", estoque 2 → Dark Blue G = 1 e Mocha Mousse G = 1.
// O Drone só PROPÕE; a pessoa confere e confirma.

export type SplitRow = { color: string; size: string; qty: number }
export type SplitProposal = { rows: SplitRow[]; sure: boolean; note: string | null }

const parts = (s: string | null) => String(s ?? '').split('/').map(x => x.replace(/\s+/g, ' ').trim()).filter(Boolean)

// A célula tem lista? (barra "/")
export const needsSplit = (color: string | null, size: string | null) => parts(color).length > 1 || parts(size).length > 1

// Tamanho que parece de conjunto ("Blusa M", "Calça 40") ou com quantidade ("2M", "P e M"): não dá para adivinhar
const odd = (s: string) => /\s/.test(s) || /^\d+\s*[a-z]/i.test(s) || /\be\b/i.test(s)

export function proposeSplit(color: string | null, size: string | null, stock: number): SplitProposal {
  const cs = parts(color), ss = parts(size)
  const c1 = cs.length ? cs : [''], s1 = ss.length ? ss : ['']
  let pairs: [string, string][]
  let sure = true
  let note: string | null = null
  if (c1.length > 1 && s1.length === c1.length) pairs = c1.map((c, i) => [c, s1[i]])
  else if (c1.length === 1 && s1.length > 1) pairs = s1.map(s => [c1[0], s])
  else if (c1.length > 1 && s1.length === 1) pairs = c1.map(c => [c, s1[0]])
  else if (c1.length === 1 && s1.length === 1) pairs = [[c1[0], s1[0]]]
  else {
    // quantidades diferentes de cores e tamanhos: monta as linhas e pede conferência
    const n = Math.max(c1.length, s1.length)
    pairs = Array.from({ length: n }, (_, i) => [c1[i] ?? c1[c1.length - 1], s1[i] ?? s1[s1.length - 1]])
    sure = false; note = `São ${c1.length} cores e ${s1.length} tamanhos: confira qual vai com qual.`
  }
  if (ss.some(odd)) { sure = false; note = note ?? 'O tamanho parece de conjunto ou tem quantidade escrita: confira antes de separar.' }
  // estoque: 1 por linha quando bate; senão divide e pede conferência
  const n = pairs.length
  const base = Math.floor(stock / n), extra = stock - base * n
  if (stock !== n) { sure = false; note = note ?? `O estoque (${stock}) não bate com ${n} linha(s): confira as quantidades.` }
  const rows: SplitRow[] = []
  pairs.forEach(([c, s], i) => {
    const qty = stock === n ? 1 : base + (i < extra ? 1 : 0)
    const hit = rows.find(r => r.color.toLowerCase() === c.toLowerCase() && r.size.toLowerCase() === s.toLowerCase())
    if (hit) hit.qty += qty; else rows.push({ color: c, size: s, qty })
  })
  return { rows, sure, note }
}
