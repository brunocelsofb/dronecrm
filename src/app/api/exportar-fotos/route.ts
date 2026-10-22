// Fotos das peças do Varejo (.zip, pasta por código da peça), em partes de até
// PHOTOS_PER_PART fotos. Mesmas regras da exportação de dados (admin, sem suporte,
// link de 10 minutos, registro de acessos).

import { NextResponse, type NextRequest } from 'next/server'
import { zipSync } from 'fflate'
import { createRawAdminClient } from '@/lib/supabase/admin'
import { logSupport } from '@/lib/tenant/support'
import { storeExport } from '@/lib/tenant/export-files'
import { exportContext, fileSlug, todayBR } from '@/lib/tenant/export-guard'
import { RETAIL_MEDIA_BUCKET } from '@/lib/retail/products'
import { listProductPhotos, PHOTOS_PER_PART } from '@/lib/retail/photo-export'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const back = (req: NextRequest, erro: string) => NextResponse.redirect(new URL(`/settings/privacidade?erro=${encodeURIComponent(erro)}#exportar`, req.url), 303)

export async function GET(req: NextRequest) {
  const ctx = await exportContext()
  if (!ctx.ok) return back(req, ctx.error)
  if (!ctx.features.includes('varejo')) return back(req, 'Sua empresa não tem o módulo Varejo.')

  const photos = await listProductPhotos(ctx.db, ctx.tenantId)
  const parts = Math.max(1, Math.ceil(photos.length / PHOTOS_PER_PART))
  const part = Math.min(parts, Math.max(1, Number(req.nextUrl.searchParams.get('parte')) || 1))
  const slice = photos.slice((part - 1) * PHOTOS_PER_PART, part * PHOTOS_PER_PART)
  if (!slice.length) return back(req, 'Nenhuma foto de peça para baixar.')

  // Lê as fotos do armazenamento (6 por vez); foto que falhar entra na lista do LEIA-ME
  const storage = createRawAdminClient().storage.from(RETAIL_MEDIA_BUCKET)
  const files: Record<string, Uint8Array> = {}
  const failed: string[] = []
  for (let i = 0; i < slice.length; i += 6) {
    await Promise.all(slice.slice(i, i + 6).map(async p => {
      const { data, error } = await storage.download(p.path)
      if (error || !data) { failed.push(p.name); return }
      files[p.name] = new Uint8Array(await data.arrayBuffer())
    }))
  }
  const readme = [
    `Fotos das peças — ${ctx.companyName}`,
    `Parte ${part} de ${parts} (${Object.keys(files).length} foto(s)). Gerado em ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.`,
    'Uma pasta por código da peça; 01 é a capa da vitrine.',
    ...(failed.length ? ['', 'Não foi possível ler (gere de novo):', ...failed] : []),
  ].join('\r\n')
  files['LEIA-ME.txt'] = new TextEncoder().encode(`﻿${readme}\r\n`)

  const zip = zipSync(files, { level: 0 }) // JPEG já é comprimido
  const stored = await storeExport(ctx.tenantId, `fotos-${fileSlug(ctx.companyName)}-${todayBR()}${parts > 1 ? `-parte-${part}` : ''}.zip`, zip)
  if (!stored.ok) return back(req, stored.error)
  await logSupport({ tenantId: ctx.tenantId, actorId: ctx.userId, actorName: ctx.by, action: 'export', detail: `Baixou as fotos das peças (parte ${part} de ${parts}, ${Object.keys(files).length - 1} foto(s))` })
  return NextResponse.redirect(stored.url, 303)
}
