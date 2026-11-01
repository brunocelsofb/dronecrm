import { NextResponse } from 'next/server'
import { loadTheoContext, providerLabel } from '@/lib/ai/theo-server'

// O que o Théo faz para esta pessoa (aba "O que o Théo faz" do assistente)
export async function GET() {
  const ctx = await loadTheoContext()
  if (!ctx) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  if (!ctx.canUse) return NextResponse.json({ canUse: false })
  return NextResponse.json({
    canUse: true, isAdmin: ctx.isAdmin, ready: !!(ctx.provider && ctx.key),
    provider: providerLabel(ctx.provider), model: ctx.model,
    tools: ctx.tools.map(t => ({ name: t.name, label: t.label, group: t.group, kind: t.kind })),
  })
}
