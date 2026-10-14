'use client'

// NOTA DE INCERTEZA: a parte de tempo real (supabase.channel(...).on(
// 'postgres_changes', ...)) é a API que eu conheço do supabase-js, mas
// não tive como testar ao vivo — se as notificações não aparecerem
// sozinhas (só ao recarregar a página), o mais provável é a tabela
// "notifications" não estar habilitada em Database → Replication →
// supabase_realtime no painel do Supabase. Habilitar isso lá resolve.

import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Bell } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

type Notification = {
  id: string
  contract_id: string | null
  message: string
  read: boolean
  created_at: string
}

export function NotificationBell({ userId }: { userId: string }) {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [open, setOpen] = useState(false)
  const router = useRouter()
  const dropdownRef = useRef<HTMLDivElement>(null)

  const unreadCount = notifications.filter((n) => !n.read).length

  useEffect(() => {
    const supabase = createClient()

    async function loadInitial() {
      const { data } = await supabase
        .from('notifications')
        .select('id, contract_id, message, read, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(30)
      if (data) setNotifications(data)
    }

    loadInitial()

    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'contract_crm', table: 'notifications', filter: `user_id=eq.${userId}` },
        (payload) => {
          setNotifications((prev) => [payload.new as Notification, ...prev])
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [userId])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  async function handleOpenNotification(n: Notification) {
    const supabase = createClient()
    if (!n.read) {
      await supabase.from('notifications').update({ read: true }).eq('id', n.id)
      setNotifications((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)))
    }
    setOpen(false)
    if (n.contract_id) router.push(`/contracts/${n.contract_id}`)
    else if (n.message?.includes('Relatório mensal de implantação')) router.push('/copiloto/relatorios')
  }

  async function handleMarkAllRead() {
    const supabase = createClient()
    await supabase.from('notifications').update({ read: true }).eq('user_id', userId).eq('read', false)
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative flex items-center justify-center rounded-md p-1.5 text-brand-100/70 hover:bg-white/5 hover:text-white"
        title="Notificações"
      >
        <Bell size={17} />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-negative-600 text-[9px] font-bold text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute bottom-full left-0 z-50 mb-2 w-80 rounded-lg border border-gray-200 bg-white shadow-lg">
          <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
            <p className="text-xs font-semibold text-gray-700">Notificações</p>
            {unreadCount > 0 && (
              <button onClick={handleMarkAllRead} className="text-[11px] text-brand-700 hover:underline">
                Marcar todas como lidas
              </button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {notifications.length === 0 && (
              <p className="px-3 py-6 text-center text-xs text-gray-400">Nenhuma notificação ainda.</p>
            )}
            {notifications.map((n) => (
              <button
                key={n.id}
                onClick={() => handleOpenNotification(n)}
                className={`block w-full border-b border-gray-50 px-3 py-2 text-left text-xs hover:bg-gray-50 ${
                  n.read ? 'text-gray-500' : 'bg-brand-100/40 font-medium text-gray-900'
                }`}
              >
                {n.message}
                <p className="mt-0.5 text-[10px] text-gray-400">{new Date(n.created_at).toLocaleString('pt-BR')}</p>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
