// Abre o texto de uma mensagem recebida pelo tempo real (vem cifrada do banco).
import { openWhatsAppMessage } from '@/lib/actions/whatsapp-open'

export const isSealed = (v: unknown): boolean => typeof v === 'string' && v.startsWith('enc:v1')

// null = mensagem fora do trecho que esta pessoa pode ver (Central de atendimento): não mostrar
export async function revealMessage<T extends { id: string; message?: string | null }>(m: T): Promise<T | null> {
  try {
    const r = await openWhatsAppMessage(m.id)
    if (r?.hidden) return null
    if (!isSealed(m.message)) return m
    return { ...m, message: r?.message ?? '' }
  } catch {
    return { ...m, message: '' }
  }
}
