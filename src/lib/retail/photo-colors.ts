// ─── Varejo: foto por cor (regras puras, sem imports) ─────────────────────────
// Cada foto da peça pode ter uma cor e dizer se é "com modelo" (pessoa vestindo).
// Foto sem cor vale para todas as cores. Foto do Estúdio IA ("/ia/" no caminho) já
// conta como foto com modelo. Na vitrine, escolher a cor troca a foto.

export type PhotoInfo = { color: string | null; model: boolean }
export type PhotoMeta = Record<string, PhotoInfo>

export const isAiPhotoPath = (path: string) => /(^|\/)ia\//.test(path)

// Lê e limpa o que veio do banco: só fotos que a peça tem e cores que existem nela
export function readPhotoMeta(raw: unknown, photos: string[], colors: string[]): PhotoMeta {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const out: PhotoMeta = {}
  for (const p of photos) {
    const m = src[p] && typeof src[p] === 'object' ? (src[p] as Record<string, unknown>) : {}
    const color = typeof m.color === 'string' && colors.includes(m.color) ? m.color : null
    out[p] = { color, model: m.model === true || (m.model === undefined && isAiPhotoPath(p)) }
  }
  return out
}

// Fotos de uma cor, na ordem da peça: as da cor primeiro, depois as sem cor.
// Sem nenhuma foto para a cor, mostra as sem cor; sem essas também, todas.
export function photosForColor(photos: string[], meta: PhotoMeta, color: string | null): string[] {
  if (!color) return photos
  const mine = photos.filter(p => meta[p]?.color === color)
  const shared = photos.filter(p => !meta[p]?.color)
  const list = [...mine, ...shared]
  return list.length ? list : photos
}

export type ColorStatus = { color: string; model: boolean; reference: number | null }

// Por cor: já tem foto com modelo? qual foto real da peça nessa cor serve de base para a IA?
export function colorCoverage(photos: string[], meta: PhotoMeta, colors: string[]): ColorStatus[] {
  return colors.map(color => {
    const model = photos.some(p => meta[p]?.color === color && meta[p]?.model)
    const ref = photos.findIndex(p => meta[p]?.color === color && !meta[p]?.model)
    return { color, model, reference: ref >= 0 ? ref : null }
  })
}

// Peça precisa de atenção no Estúdio: tem mais de uma cor e alguma cor sem foto com modelo
export function missingModelColors(photos: string[], meta: PhotoMeta, colors: string[]): ColorStatus[] {
  if (colors.length < 2) return []
  return colorCoverage(photos, meta, colors).filter(c => !c.model)
}

// Onde entra a foto com modelo publicada: depois das outras fotos com modelo (as com
// modelo vêm na frente, porque a primeira foto é a capa do cartão na vitrine)
export function insertModelPhoto(photos: string[], meta: PhotoMeta, path: string): string[] {
  const rest = photos.filter(p => p !== path)
  let at = 0
  while (at < rest.length && meta[rest[at]]?.model) at++
  return [...rest.slice(0, at), path, ...rest.slice(at)]
}
