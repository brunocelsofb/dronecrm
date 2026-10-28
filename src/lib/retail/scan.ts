// ─── Varejo: contar peças com leitor de código de barras (regras puras) ──────
// O leitor funciona como teclado: digita o código e aperta Enter. Cada leitura soma 1.

export type ScanVariant = { id: string; sku: string; barcode: string | null; stock: number; category: string | null }

export const normalizeBarcode = (s: string) => String(s ?? '').replace(/\s+/g, '').toUpperCase().slice(0, 64)

// Acha a variação pelo código de barras ou pelo SKU (etiqueta do Drone)
export function findByCode(list: ScanVariant[], code: string): ScanVariant | null {
  const c = normalizeBarcode(code)
  if (!c) return null
  return list.find(v => v.barcode && normalizeBarcode(v.barcode) === c) ?? list.find(v => normalizeBarcode(v.sku) === c) ?? null
}

export type ScanChange = { variant_id: string; before: number; after: number; mode: 'add' | 'set'; qty: number }

// Entrada: soma o que foi lido. Contagem: o que foi lido fica igual à contagem;
// com uma categoria escolhida, o que é dela e não foi lido vai a zero (se a pessoa marcar).
export function scanChanges(mode: 'entrada' | 'contagem', counts: Record<string, number>, list: ScanVariant[], opts: { category?: string | null; zeroMissing?: boolean } = {}): ScanChange[] {
  const byId = new Map(list.map(v => [v.id, v]))
  const out: ScanChange[] = []
  for (const [id, n] of Object.entries(counts)) {
    const v = byId.get(id)
    const qty = Math.max(0, Math.floor(Number(n) || 0))
    if (!v) continue
    if (mode === 'entrada') { if (qty > 0) out.push({ variant_id: id, before: v.stock, after: v.stock + qty, mode: 'add', qty }) }
    else if (qty !== v.stock) out.push({ variant_id: id, before: v.stock, after: qty, mode: 'set', qty })
  }
  if (mode === 'contagem' && opts.zeroMissing && opts.category !== undefined) {
    for (const v of list) {
      if (counts[v.id] !== undefined || v.stock === 0) continue
      if ((opts.category ?? null) !== null && v.category !== opts.category) continue
      out.push({ variant_id: v.id, before: v.stock, after: 0, mode: 'set', qty: 0 })
    }
  }
  return out
}
