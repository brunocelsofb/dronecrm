import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Serve arquivos do bucket "proposal-files" (pastas signatures/ e
// custom-fields/) SEM exigir login — precisa ser público porque quem
// carrega isso pode ser um cliente de e-mail externo, ou um link
// compartilhado de campo customizado.
const CONTENT_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params
  const fullPath = path.join('/')

  // Só permite servir arquivos dentro dessas pastas — não abre a porta
  // pra servir qualquer arquivo do bucket sem autenticação.
  // Aceita também a pasta da empresa na frente: <tenant_id>/signatures/...
  if (!/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/)?(signatures|custom-fields|whatsapp-media)\//i.test(fullPath) || fullPath.includes('..')) {
    return NextResponse.json({ error: 'Caminho inválido.' }, { status: 400 })
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase.storage.from('proposal-files').download(fullPath)

  if (error || !data) {
    return NextResponse.json({ error: 'Arquivo não encontrado.' }, { status: 404 })
  }

  const buffer = await data.arrayBuffer()
  const ext = fullPath.toLowerCase().split('.').pop() ?? ''
  const contentType = CONTENT_TYPES[ext] ?? 'application/octet-stream'
  const fileName = fullPath.split('/').pop() ?? 'arquivo'

  return new NextResponse(Buffer.from(buffer), {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Content-Disposition': `inline; filename="${fileName}"`,
    },
  })
}
