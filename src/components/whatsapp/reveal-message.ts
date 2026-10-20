// Abre o texto de uma mensagem recebida pelo tempo real (vem cifrada do banco).
import { openWhatsAppMessage } from '@/lib/actions/whatsapp-open'

export const isSealed = (v: unknown): boolean => typeof v === 'string' && v.startsWith('enc:v1')

export async function revealMessage<T extends { id: string; message?: string | null }>(m: T): Promise<T> {
  if (!isSealed(m.message)) return m
  try {
    const r = await openWhatsAppMessage(m.id)
    return { ...m, message: r?.message ?? '' }
  } catch {
    return { ...m, message: '' }
  }
}
