// ─── Varejo: "Pronta para vender" — o que falta em cada peça, na ordem (regras puras) ───
// Uma peça está pronta quando o cadastro está certo, tem preço, estoque, foto de cada cor
// e está Publicada. Foto com a modelo é recomendada (não impede a venda).

// (sem imports, para rodar nos testes) — mesma regra de split.ts: célula com "/" tem várias opções
const needsSplit = (c: string | null, s: string | null) => /\//.test(c ?? '') || /\//.test(s ?? '')

export type StepKey = 'cadastro' | 'preco' | 'estoque' | 'fotos' | 'modelo' | 'publicar'
export type Step = { key: StepKey; ok: boolean; required: boolean; label: string; detail: string | null }
export type ReadyInput = {
  status: string; price: number | null; duplicated: boolean
  photos: string[]; meta: Record<string, { color: string | null; model: boolean }>
  variants: { color: string | null; size: string | null; stock: number; active: boolean }[]
}

export const STEP_LABEL: Record<StepKey, string> = {
  cadastro: 'Cadastro', preco: 'Preço', estoque: 'Estoque', fotos: 'Foto de cada cor', modelo: 'Foto com modelo', publicar: 'Publicar',
}

export function readiness(p: ReadyInput): { steps: Step[]; next: Step | null; ready: boolean; blocking: number } {
  const vs = p.variants.filter(v => v.active)
  const colors = [...new Set(vs.map(v => v.color).filter((c): c is string => !!c))]
  const joined = vs.filter(v => needsSplit(v.color, v.size))
  const stock = vs.reduce((t, v) => t + Math.max(0, Number(v.stock) || 0), 0)
  const hasColor = (c: string, model: boolean) => p.photos.some(ph => p.meta[ph]?.color === c && (!model || p.meta[ph]?.model))
  const multi = colors.length > 1
  const missPhoto = multi ? colors.filter(c => !hasColor(c, false)) : p.photos.length ? [] : ['a peça']
  const missModel = multi ? colors.filter(c => !hasColor(c, true)) : p.photos.some(ph => p.meta[ph]?.model) ? [] : ['a peça']
  const steps: Step[] = [
    { key: 'cadastro', required: true, ok: !joined.length && !p.duplicated && vs.length > 0, label: STEP_LABEL.cadastro,
      detail: !vs.length ? 'sem cores e tamanhos' : joined.length ? 'cores ou tamanhos juntos na mesma linha' : p.duplicated ? 'a mesma peça está em mais de um cadastro' : null },
    { key: 'preco', required: true, ok: p.price !== null && p.price > 0, label: STEP_LABEL.preco, detail: p.price === null ? 'sem preço' : null },
    { key: 'estoque', required: true, ok: stock > 0, label: STEP_LABEL.estoque, detail: stock > 0 ? null : 'sem unidades' },
    { key: 'fotos', required: true, ok: !missPhoto.length, label: STEP_LABEL.fotos, detail: missPhoto.length ? (multi ? `falta: ${missPhoto.join(', ')}` : 'sem foto') : null },
    { key: 'modelo', required: false, ok: !missModel.length, label: STEP_LABEL.modelo, detail: missModel.length ? (multi ? `falta: ${missModel.join(', ')}` : 'ainda sem modelo') : null },
    { key: 'publicar', required: true, ok: p.status === 'publicado', label: STEP_LABEL.publicar, detail: p.status === 'publicado' ? null : p.status === 'arquivado' ? 'arquivada' : 'rascunho' },
  ]
  const blockers = steps.filter(s => s.required && !s.ok)
  // Próximo passo: o primeiro obrigatório; publicar só depois do resto; modelo só quando o resto está ok
  const beforePublish = blockers.filter(s => s.key !== 'publicar')
  const next = beforePublish[0] ?? (steps.find(s => s.key === 'modelo' && !s.ok) && !blockers.length ? steps.find(s => s.key === 'modelo')! : blockers[0] ?? steps.find(s => !s.ok) ?? null)
  return { steps, next, ready: !blockers.length, blocking: blockers.length }
}
