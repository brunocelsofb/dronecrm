// ─── Prévia das tarefas dos agentes ("Testar" na tela IA da empresa) ─────────
// Roda a rotina de verdade, com os dados e a configuração atuais, mas dentro de
// runPreview nada é gravado nem enviado: createAgentActivity, sendWhatsApp e
// sendAgentEmail só anotam o que fariam. Rotinas com gravações próprias conferem
// inPreview() antes de gravar. Só servidor.
import { AsyncLocalStorage } from 'node:async_hooks'

export type PreviewItem =
  | { kind: 'atividade'; title: string; content: string; assignedTo: string | null; due: string | null; skipped?: string }
  | { kind: 'whatsapp'; to: string | null; text: string }
  | { kind: 'email'; to: string; subject: string; html: string }
  | { kind: 'nota'; text: string }

type Store = { items: PreviewItem[] }
// Uma instância só no processo (mesmo se o módulo for carregado duas vezes)
const KEY = Symbol.for('drone.agentPreview')
const g = globalThis as unknown as Record<symbol, AsyncLocalStorage<Store> | undefined>
const als: AsyncLocalStorage<Store> = g[KEY] ?? (g[KEY] = new AsyncLocalStorage<Store>())

export const inPreview = () => !!als.getStore()
export function record(item: PreviewItem) { als.getStore()?.items.push(item) }

export async function runPreview<T>(fn: () => Promise<T>): Promise<{ result: T | null; items: PreviewItem[]; error?: string }> {
  const store: Store = { items: [] }
  try {
    const result = await als.run(store, fn)
    return { result, items: store.items }
  } catch (e) {
    return { result: null, items: store.items, error: e instanceof Error ? e.message : String(e) }
  }
}
