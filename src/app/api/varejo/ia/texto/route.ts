// Estúdio IA: sugere o texto do look (vitrine + rede social) e a ocasião, olhando a foto,
// com a conta de IA da própria administradora. Guarda junto da imagem.
import { NextResponse, type NextRequest } from 'next/server'
import { hasFeature } from '@/lib/auth/access'
import { requireTenantId } from '@/lib/tenant/context'
import { createScopedAdmin } from '@/lib/tenant/scoped-admin'
import { getSupportSession } from '@/lib/tenant/support'
import { decryptSecret } from '@/lib/ai/tenant-key'
import { describeImage } from '@/lib/retail/ai-providers'
import { AI_TEXT_MODEL, copyPrompt, isAiProvider, parseLookCopy, type AiProvider } from '@/lib/retail/ai-studio'
import { readContent, readOccasions } from '@/lib/retail/storefront'
import { retailPhotoUrl } from '@/lib/retail/products'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status })

export async function POST(req: NextRequest) {
  const access = await hasFeature('varejo')
  if (!access) return bad('Sem acesso ao módulo Varejo.', 403)
  if (await getSupportSession()) return bad('Acesso de suporte é só leitura.', 403)
  if (!access.isAdmin) return bad('Só a administradora da loja usa o Estúdio IA.', 403)
  const tenantId = await requireTenantId()
  let b: Record<string, unknown>
  try { b = await req.json() } catch { return bad('Pedido inválido.') }
  const id = String(b.image_id ?? '')
  if (!UUID.test(id)) return bad('Imagem inválida.')
  const db = await createScopedAdmin(tenantId)
  const { data: img } = await db.from('retail_ai_images').select('id, kind, path, provider, inputs').eq('id', id).maybeSingle()
  if (!img || img.kind !== 'look') return bad('Escolha uma foto de look.')

  // Conta de IA da usuária: a mesma da foto, ou outra que ela tenha conectado
  const { data: conns } = await db.from('retail_ai_connections').select('provider, key_enc').eq('user_id', access.userId)
  const conn = (conns ?? []).find(c => c.provider === img.provider) ?? (conns ?? [])[0]
  if (!conn || !isAiProvider(conn.provider)) return bad('Conecte a sua conta do Gemini ou do ChatGPT no topo do Estúdio.')
  let key: string
  try { key = decryptSecret(String(conn.key_enc)) } catch { return bad('Não consegui ler a sua chave. Conecte de novo.') }
  const provider = conn.provider as AiProvider

  // Contexto: nome e essência da loja, peças do look e ocasiões existentes
  const pieceIds = (((img.inputs ?? {}) as { pieces?: { product_id?: string }[] }).pieces ?? []).map(p => String(p.product_id ?? '')).filter(x => UUID.test(x))
  const [{ data: sf }, { data: org }, { data: prods }] = await Promise.all([
    db.from('retail_storefronts').select('title, tagline, content, occasions').maybeSingle(),
    db.from('organization_settings').select('company_name, name').eq('tenant_id', tenantId).maybeSingle(),
    pieceIds.length ? db.from('retail_products').select('name, category, composition, retail_product_variants(color, active)').in('id', pieceIds) : Promise.resolve({ data: [] as { name: string; category: string | null; composition: string | null; retail_product_variants?: { color: string | null; active: boolean }[] }[] }),
  ])
  const content = readContent(sf?.content)
  const occasions = readOccasions(sf?.occasions).map(o => ({ id: o.id, name: o.name }))
  const store = ((sf?.title as string | null) || (org?.company_name as string | null) || (org?.name as string | null) || 'a loja').trim()
  const essence = content.hero_title || (sf?.tagline as string | null) || 'moda feminina elegante para o dia a dia'
  const pieces = (prods ?? []).map(p => [p.name, p.category, p.composition].filter(Boolean).join(', '))

  const r = await describeImage({ provider, key, model: AI_TEXT_MODEL[provider], prompt: copyPrompt({ store, essence, pieces, occasions, multiColor: (prods ?? []).length === 1 && new Set(((prods ?? [])[0]?.retail_product_variants ?? []).filter(v => v.active && v.color).map(v => v.color)).size > 1 }), imageUrl: retailPhotoUrl(img.path as string) })
  if (!r.ok) return bad(r.error, 502)
  const copy = [...r.texts].reverse().map(t => parseLookCopy(t, occasions.map(o => o.id))).find(Boolean)
  if (!copy) return bad('A IA respondeu fora do formato. Tente "Refazer texto".', 502)
  await db.from('retail_ai_images').update({ copy }).eq('id', id)
  return NextResponse.json({ copy })
}
