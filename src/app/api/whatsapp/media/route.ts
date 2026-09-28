// src/app/api/whatsapp/media/route.ts
//
// Proxy de mídia da Evolution API.
//
// O browser chama:
//   GET /api/whatsapp/media?id=<messageId>&instance=<instanceName>
//
// Este endpoint chama a Evolution API para obter o base64 da mensagem,
// converte para binário e devolve ao browser com o Content-Type correcto.
//
// Porquê é necessário:
//   A Evolution API não devolve URLs públicas nos webhooks. O campo
//   imageMessage.url é uma URL interna do servidor WhatsApp que o browser
//   do cliente não consegue carregar directamente. A solução correcta é
//   guardar o messageId e buscar a mídia em runtime através deste proxy,
//   que corre no servidor onde as credenciais da Evolution estão disponíveis.

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Mapeia o mimetype devolvido pela Evolution para extensão e Content-Type
const MIME_MAP: Record<string, string> = {
  'image/jpeg': 'image/jpeg',
  'image/jpg': 'image/jpeg',
  'image/png': 'image/png',
  'image/webp': 'image/webp',
  'image/gif': 'image/gif',
  'audio/ogg': 'audio/ogg',
  'audio/ogg; codecs=opus': 'audio/ogg',
  'audio/mpeg': 'audio/mpeg',
  'audio/mp4': 'audio/mp4',
  'video/mp4': 'video/mp4',
  'video/webm': 'video/webm',
  'application/pdf': 'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const messageId = searchParams.get('id')
  const instanceParam = searchParams.get('instance')

  if (!messageId) {
    return NextResponse.json({ error: 'id obrigatório' }, { status: 400 })
  }

  // Busca configurações da Evolution no Supabase
  const supabase = createAdminClient()
  const { data: orgSettings } = await supabase
    .from('organization_settings')
    .select('evo_server_url, evo_api_key, evo_instance_name')
    .eq('id', 'default')
    .maybeSingle()

  if (!orgSettings?.evo_server_url || !orgSettings?.evo_api_key) {
    return NextResponse.json({ error: 'Evolution API não configurada' }, { status: 503 })
  }

  // Usa a instância do parâmetro, com fallback para a instância padrão
  const instance = instanceParam ?? orgSettings.evo_instance_name
  if (!instance) {
    return NextResponse.json({ error: 'instance não encontrada' }, { status: 400 })
  }

  // Chama a Evolution API para obter o base64 da mensagem
  // Endpoint: POST /chat/getBase64FromMediaMessage/{instance}
  // Payload: { message: { key: { id: messageId } } }
  let evoResponse: Response
  try {
    evoResponse = await fetch(
      `${orgSettings.evo_server_url}/chat/getBase64FromMediaMessage/${instance}`,
      {
        method: 'POST',
        headers: {
          'apikey': orgSettings.evo_api_key,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: { key: { id: messageId } },
          convertToMp4: false,
        }),
      }
    )
  } catch (e) {
    console.error('[media-proxy] erro ao chamar Evolution:', e)
    return NextResponse.json({ error: 'Erro ao conectar à Evolution API' }, { status: 502 })
  }

  if (!evoResponse.ok) {
    const errText = await evoResponse.text().catch(() => '')
    console.error(`[media-proxy] Evolution retornou ${evoResponse.status}:`, errText)
    return NextResponse.json(
      { error: `Evolution API retornou ${evoResponse.status}` },
      { status: evoResponse.status >= 500 ? 502 : 404 }
    )
  }

  let evoData: any
  try {
    evoData = await evoResponse.json()
  } catch (e) {
    return NextResponse.json({ error: 'Resposta inválida da Evolution API' }, { status: 502 })
  }

  // A Evolution devolve { base64: "data:image/jpeg;base64,/9j/...", mimetype: "image/jpeg" }
  // ou { base64: "/9j/...", mimetype: "image/jpeg" } (sem o prefixo data URI)
  const rawBase64: string | undefined = evoData?.base64
  const mimetype: string | undefined = evoData?.mimetype

  if (!rawBase64) {
    return NextResponse.json({ error: 'Mídia não encontrada na Evolution API' }, { status: 404 })
  }

  // Remove prefixo "data:...;base64," se presente
  const base64Data = rawBase64.includes(',') ? rawBase64.split(',')[1] : rawBase64

  // Converte base64 para ArrayBuffer — é BodyInit garantido em todos os
  // ambientes (Web API, Edge, Node) e aceite pelos tipos do Next.js 16.
  // Uint8Array e Buffer têm problemas de tipagem no Next.js 16 Turbopack.
  let arrayBuffer: ArrayBuffer
  try {
    const buf = Buffer.from(base64Data, 'base64')
    arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  } catch (e) {
    return NextResponse.json({ error: 'Base64 inválido' }, { status: 502 })
  }

  // Determina o Content-Type
  const contentType = (mimetype && MIME_MAP[mimetype]) ?? mimetype ?? 'application/octet-stream'

  // Usa Response nativo da Web API — NextResponse herda o mesmo construtor
  // mas os tipos do Next.js 16 aceitam ArrayBuffer em Response sem problema.
  return new Response(arrayBuffer, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(arrayBuffer.byteLength),
      'Cache-Control': 'private, max-age=3600',
    },
  })
}
