// ─── Varejo: deixa a foto no tamanho exato do espaço da vitrine (roda no navegador) ───
// A foto sai sempre com a largura × altura do espaço (ex.: 1200 × 1600 para o cartão 3:4),
// em JPEG. Se a proporção da foto já for parecida, só recorta as bordas um pouco;
// se for bem diferente (ex.: foto deitada num espaço em pé), a peça entra INTEIRA no
// centro e o fundo é a própria foto desfocada — nada da peça é cortado.

export const PHOTO_FRAMES = {
  produto: { w: 1200, h: 1600, label: '1200 × 1600 px (3:4, em pé)' },
  capaComputador: { w: 1600, h: 2000, label: '1600 × 2000 px (4:5, em pé)' },
  capaCelular: { w: 1200, h: 1260, label: '1200 × 1260 px (quase quadrada)' },
} as const
export type PhotoFrame = { w: number; h: number }

// Diferença de proporção aceita para recortar em vez de encaixar (6%)
export const FIT_TOLERANCE = 0.06

// Como a foto entra no quadro: recorte leve (cover) ou inteira com fundo (contain)
export function fitPlan(imgW: number, imgH: number, frame: PhotoFrame) {
  const imgRatio = imgW / imgH, boxRatio = frame.w / frame.h
  const mode: 'cover' | 'contain' = Math.abs(imgRatio / boxRatio - 1) <= FIT_TOLERANCE ? 'cover' : 'contain'
  const s = mode === 'cover' ? Math.max(frame.w / imgW, frame.h / imgH) : Math.min(frame.w / imgW, frame.h / imgH)
  const w = Math.round(imgW * s), h = Math.round(imgH * s)
  return { mode, x: Math.round((frame.w - w) / 2), y: Math.round((frame.h - h) / 2), w, h }
}

export async function fitPhoto(file: File, frame: PhotoFrame): Promise<File> {
  try {
    const bmp = await createImageBitmap(file)
    const canvas = document.createElement('canvas')
    canvas.width = frame.w; canvas.height = frame.h
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'
    const plan = fitPlan(bmp.width, bmp.height, frame)
    if (plan.mode === 'contain') {
      // Fundo: a foto reduzida a poucos pixels e ampliada (fica desfocada em qualquer navegador)
      const tiny = document.createElement('canvas')
      tiny.width = 16; tiny.height = Math.max(1, Math.round(16 * frame.h / frame.w))
      const tctx = tiny.getContext('2d')
      const sc = Math.max(tiny.width / bmp.width, tiny.height / bmp.height)
      tctx?.drawImage(bmp, (tiny.width - bmp.width * sc) / 2, (tiny.height - bmp.height * sc) / 2, bmp.width * sc, bmp.height * sc)
      ctx.drawImage(tiny, 0, 0, frame.w, frame.h)
      ctx.fillStyle = 'rgba(255,255,255,0.18)'
      ctx.fillRect(0, 0, frame.w, frame.h)
    }
    ctx.drawImage(bmp, plan.x, plan.y, plan.w, plan.h)
    const blob: Blob | null = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.88))
    if (!blob) return file
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' })
  } catch {
    return file // navegador não abriu o formato: envia o original (a vitrine encaixa sem cortar)
  }
}
