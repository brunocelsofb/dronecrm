'use client'

// Menu do celular: botão na barra do topo que abre o menu completo por cima da tela.
// Mesmos grupos e regras de abas da barra lateral (sidebar-nav.tsx); no computador
// este componente não aparece.

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState, type ReactNode } from 'react'
import { Menu, X, Settings, ShieldCheck } from 'lucide-react'
import { NAV_GROUPS, activeHref, matches } from '@/components/layout/sidebar-nav'
import { isSettingsChild } from '@/lib/config/settings-nav'

export function MobileNav({
  features, isSuperAdmin, logo, footer,
}: {
  features: string[]
  isSuperAdmin?: boolean
  logo: ReactNode
  footer?: ReactNode
}) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [openedFor, setOpenedFor] = useState(pathname)

  // Trocou de tela: fecha o menu
  if (openedFor !== pathname) { setOpenedFor(pathname); setOpen(false) }

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [open])

  const groups = NAV_GROUPS
    .map(g => ({ ...g, items: g.items.filter(i => features.includes(i.feature)) }))
    .filter(g => g.items.length > 0)
  const inSettings = isSettingsChild(pathname) || matches(pathname, '/settings')

  const item = (on: boolean) =>
    `flex items-center gap-3 rounded-lg px-3 py-2.5 text-[15px] ${on ? 'bg-white/15 text-white' : 'text-brand-100/85 hover:bg-white/10 hover:text-white'}`

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label="Abrir menu" aria-expanded={open}
        className="flex h-10 w-10 items-center justify-center rounded-lg text-white hover:bg-white/10">
        <Menu size={22} strokeWidth={1.75} />
      </button>

      {open && (
        <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label="Menu">
          <button type="button" aria-label="Fechar menu" className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <nav className="absolute inset-y-0 left-0 flex w-[min(20rem,86vw)] flex-col bg-brand-800 shadow-2xl">
            <div className="flex h-14 shrink-0 items-center justify-between px-3">
              <div className="pl-1">{logo}</div>
              <button type="button" onClick={() => setOpen(false)} aria-label="Fechar menu"
                className="flex h-10 w-10 items-center justify-center rounded-lg text-white hover:bg-white/10">
                <X size={22} strokeWidth={1.75} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
              {groups.map(g => {
                const current = activeHref(pathname, g.items)
                return (
                  <div key={g.key} className="mt-3 first:mt-1">
                    {g.items.length > 1 && <p className="px-3 pb-1 text-xs font-medium text-brand-100/55">{g.label}</p>}
                    {g.items.map(it => {
                      const Icon = it.icon
                      const on = it.href === current && !inSettings
                      return (
                        <Link key={it.href} href={it.href} aria-current={on ? 'page' : undefined} className={item(on)}>
                          <Icon size={18} strokeWidth={1.75} className="shrink-0" />
                          <span>{it.label}</span>
                        </Link>
                      )
                    })}
                  </div>
                )
              })}
              <div className="my-3 border-t border-white/10" />
              <Link href="/settings" aria-current={inSettings ? 'page' : undefined} className={item(inSettings)}>
                <Settings size={18} strokeWidth={1.75} className="shrink-0" /><span>Configurações</span>
              </Link>
              {isSuperAdmin && (
                <Link href="/super-admin" className={item(matches(pathname, '/super-admin'))}>
                  <ShieldCheck size={18} strokeWidth={1.75} className="shrink-0" /><span>Super Admin</span>
                </Link>
              )}
            </div>
            {footer && <div className="shrink-0 border-t border-white/10 px-3 py-3">{footer}</div>}
          </nav>
        </div>
      )}
    </>
  )
}
