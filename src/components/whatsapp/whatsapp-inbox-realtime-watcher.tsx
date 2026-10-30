'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

const last8 = (p: unknown) => String(p ?? '').replace(/\D/g, '').slice(-8)

// Som curto de mensagem nova (gerado no navegador; sem arquivo de áudio)
function beep() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const now = ctx.currentTime
    for (const [i, f] of [880, 1320].entries()) {
      const o = ctx.createOscillator(), g = ctx.createGain()
      o.type = 'sine'; o.frequency.value = f
      g.gain.setValueAtTime(0.0001, now + i * 0.12)
      g.gain.exponentialRampToValueAtTime(0.15, now + i * 0.12 + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.12 + 0.18)
      o.connect(g).connect(ctx.destination)
      o.start(now + i * 0.12); o.stop(now + i * 0.12 + 0.2)
    }
    setTimeout(() => void ctx.close().catch(() => {}), 600)
  } catch { /* sem som, segue */ }
}

// Não renderiza nada — só fica escutando qualquer mensagem nova (de
// qualquer conversa) pra atualizar a lista da esquerda (última
// mensagem, ordem, conversas não vinculadas novas). O chat em si
// (quando uma conversa está aberta) tem sua própria inscrição em
// tempo real, mais direta.
// Mensagem recebida de outra conversa (ou com a aba escondida): toca um som e,
// se a pessoa liberou, mostra o aviso do navegador — só o nome, nunca o texto.
export function WhatsAppInboxRealtimeWatcher({ selectedPhone = null, names = {} }: {
  selectedPhone?: string | null
  names?: Record<string, string>
} = {}) {
  const router = useRouter()
  const ctx = useRef({ selectedPhone, names })
  useEffect(() => { ctx.current = { selectedPhone, names } }, [selectedPhone, names])

  useEffect(() => {
    const supabase = createClient()
    let lastAlert = 0
    const channel = supabase
      .channel('whatsapp-inbox')
      .on('postgres_changes', { event: 'INSERT', schema: 'contract_crm', table: 'contract_whatsapp_messages' }, (payload) => {
        router.refresh()
        const m = payload.new as { direction?: string; phone?: string; triggered_automatically?: boolean }
        if (m?.direction !== 'recebido' || !m.phone) return
        const k = last8(m.phone)
        const isOpen = !!ctx.current.selectedPhone && last8(ctx.current.selectedPhone) === k
        if (isOpen && document.visibilityState === 'visible') return
        if (Date.now() - lastAlert < 1500) return // várias de uma vez: um aviso só
        lastAlert = Date.now()
        beep()
        try {
          if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
            const who = ctx.current.names[k] || 'um contato'
            const n = new Notification('Nova mensagem no WhatsApp', { body: `De ${who}`, tag: `wpp-${k}`, icon: '/drone-logo.png' })
            n.onclick = () => { window.focus(); n.close() }
          }
        } catch { /* navegador sem aviso */ }
      })
      .on('postgres_changes', { event: '*', schema: 'contract_crm', table: 'whatsapp_conversation_assignments' }, () => {
        router.refresh()
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [router])

  return null
}
