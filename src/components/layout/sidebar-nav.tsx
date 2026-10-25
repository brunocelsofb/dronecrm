'use client'

/**
 * Menu lateral em barra fina de ícones (estilo PipeRun): cada ícone é um grupo;
 * ao passar o mouse (ou clicar/tocar) abre a continuação com as telas do grupo.
 * Grupo com uma só tela liberada vira link direto. Telas aparecem conforme
 * plano ∩ perfil de acesso (features) — vale para qualquer empresa.
 */

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState, type ComponentType, type FocusEvent, type MouseEvent as ReactMouseEvent } from 'react'
import { NAV_HELP } from '@/lib/help/page-help'
import { isSettingsChild } from '@/lib/config/settings-nav'
import {
  LayoutDashboard, KanbanSquare, FileText, Building2, Settings, Target, LifeBuoy, MessageCircle, BarChart3,
  Briefcase, ShieldCheck, ClipboardList, BrainCircuit, Receipt, Megaphone, Gauge, Handshake, Users, Headset, Bot,
  ShoppingBag, Package, Calculator,
  SquareKanban,
  Store,
  MessageSquareText,
} from 'lucide-react'

type Icon = ComponentType<{ size?: number; strokeWidth?: number; className?: string }>
type NavItem = { href: string; label: string; icon: Icon; feature: string }
type NavGroup = { key: string; label: string; icon: Icon; items: NavItem[] }

export const NAV_GROUPS: NavGroup[] = [
  {
    key: 'visao', label: 'Visão geral', icon: Gauge, items: [
      { href: '/', label: 'Dashboard', icon: LayoutDashboard, feature: 'dashboard' },
      { href: '/painel', label: 'Painel gerencial', icon: BarChart3, feature: 'painel' },
    ],
  },
  {
    key: 'vendas', label: 'Vendas', icon: Handshake, items: [
      { href: '/pipeline', label: 'Funil', icon: KanbanSquare, feature: 'pipeline' },
      { href: '/contracts', label: 'Oportunidades', icon: FileText, feature: 'contracts' },
      { href: '/propostas', label: 'Propostas', icon: FileText, feature: 'propostas' },
      { href: '/leads', label: 'Leads', icon: Target, feature: 'leads' },
    ],
  },
  {
    key: 'marketing', label: 'Marketing', icon: Megaphone, items: [
      { href: '/marketing', label: 'Marketing', icon: Megaphone, feature: 'marketing' },
      { href: '/sdr', label: 'SDR de IA', icon: Bot, feature: 'sdr' },
    ],
  },
  {
    key: 'clientes', label: 'Clientes', icon: Users, items: [
      { href: '/carteira', label: 'Gestão de Carteira', icon: Briefcase, feature: 'carteira' },
      { href: '/companies', label: 'Empresas', icon: Building2, feature: 'companies' },
      { href: '/surveys-dashboard', label: 'Pesquisas & NPS', icon: ClipboardList, feature: 'surveys' },
    ],
  },
  {
    key: 'atendimento', label: 'Atendimento', icon: Headset, items: [
      { href: '/tickets', label: 'Chamados', icon: LifeBuoy, feature: 'tickets' },
      { href: '/whatsapp', label: 'WhatsApp', icon: MessageCircle, feature: 'whatsapp' },
      { href: '/whatsapp/relatorios', label: 'Relatórios WPP', icon: BarChart3, feature: 'whatsapp-relatorios' },
    ],
  },
  {
    key: 'varejo', label: 'Varejo', icon: ShoppingBag, items: [
      { href: '/varejo/precificacao', label: 'Custos e preço', icon: Calculator, feature: 'varejo' },
      { href: '/varejo/produtos', label: 'Produtos', icon: Package, feature: 'varejo' },
      { href: '/varejo/vitrine', label: 'Vitrine', icon: Store, feature: 'varejo' },
      { href: '/varejo/clientes', label: 'Clientes', icon: Users, feature: 'varejo' },
      { href: '/varejo/funil', label: 'Funil da loja', icon: SquareKanban, feature: 'varejo' },
      { href: '/varejo/pedidos', label: 'Pedidos', icon: Receipt, feature: 'varejo' },
      { href: '/varejo/mensagens', label: 'Mensagens do pedido', icon: MessageSquareText, feature: 'varejo' },
      { href: '/varejo/painel', label: 'Painel da loja', icon: Gauge, feature: 'varejo' },
    ],
  },
  {
    key: 'financeiro', label: 'Financeiro', icon: Receipt, items: [
      { href: '/financeiro', label: 'Financeiro', icon: Receipt, feature: 'financeiro' },
    ],
  },
  {
    key: 'agentes', label: 'Agentes IA', icon: BrainCircuit, items: [
      { href: '/briefing', label: 'Agentes IA', icon: BrainCircuit, feature: 'copiloto' },
    ],
  },
]

export function matches(pathname: string, href: string) {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`)
}

// Tela ativa = a de endereço mais específico (ex.: /whatsapp/relatorios ganha de /whatsapp)
export function activeHref(pathname: string, items: NavItem[]): string | null {
  let best: string | null = null
  for (const it of items) if (matches(pathname, it.href) && (!best || it.href.length > best.length)) best = it.href
  return best
}

const railItem = (active: boolean, open = false) =>
  `relative flex w-full flex-col items-center gap-1 rounded-lg px-1 py-1.5 text-center text-[10.5px] leading-tight transition-colors ${
    active ? 'bg-white/15 text-white' : open ? 'bg-white/10 text-white' : 'text-brand-100/70 hover:bg-white/10 hover:text-white'
  }`

// Posição fixa (não é cortada quando a barra rola em telas baixas)
type Pos = { top: number; left: number }
function posOf(el: HTMLElement): Pos {
  const r = el.getBoundingClientRect()
  return { top: r.top, left: r.right }
}

export function SidebarNav({
  isSuperAdmin,
  features,
}: {
  isAdmin?: boolean
  isSuperAdmin?: boolean
  features: string[]
}) {
  const pathname = usePathname()
  const [open, setOpen] = useState<{ key: string; pos: Pos } | null>(null)
  const [tip, setTip] = useState<{ text: string; pos: Pos; h: number } | null>(null)
  const [openedFor, setOpenedFor] = useState(pathname)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const navRef = useRef<HTMLElement>(null)

  // Trocou de tela: fecha a continuação
  if (openedFor !== pathname) {
    setOpenedFor(pathname)
    setOpen(null)
    setTip(null)
  }

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(null)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    const onDown = (e: MouseEvent) => { if (navRef.current && !navRef.current.contains(e.target as Node)) close() }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('resize', close)
    }
  }, [open])

  const cancelClose = () => { if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null } }
  const scheduleClose = () => { cancelClose(); closeTimer.current = setTimeout(() => setOpen(null), 180) }
  const showTip = (text: string | undefined, el: HTMLElement) => {
    if (text) setTip({ text, pos: posOf(el), h: el.offsetHeight })
  }
  const tipProps = (href: string) => ({
    'aria-description': NAV_HELP[href],
    onMouseEnter: (e: ReactMouseEvent<HTMLElement>) => { setOpen(null); showTip(NAV_HELP[href], e.currentTarget) },
    onMouseLeave: () => setTip(null),
    onFocus: (e: FocusEvent<HTMLElement>) => showTip(NAV_HELP[href], e.currentTarget),
    onBlur: () => setTip(null),
  })

  const groups = NAV_GROUPS
    .map(g => ({ ...g, items: g.items.filter(i => features.includes(i.feature)) }))
    .filter(g => g.items.length > 0)

  const inSettings = isSettingsChild(pathname) || matches(pathname, '/settings')

  return (
    <nav
      ref={navRef}
      aria-label="Menu principal"
      // Tela baixa: a barra rola (as continuações ficam fixas e fecham ao rolar)
      className="min-h-0 flex-1 space-y-1 overflow-y-auto [scrollbar-width:none]"
      onScroll={() => { setOpen(null); setTip(null) }}
    >
      {groups.map(g => {
        const current = activeHref(pathname, g.items)
        const active = !!current && !inSettings
        const GroupIcon = g.icon

        if (g.items.length === 1) {
          const it = g.items[0]
          return (
            <Link key={g.key} href={it.href} aria-current={active ? 'page' : undefined} className={railItem(active)} {...tipProps(it.href)}>
              <GroupIcon size={19} strokeWidth={1.75} />
              <span>{g.label}</span>
            </Link>
          )
        }

        const isOpen = open?.key === g.key
        const openHere = (el: HTMLElement) => { cancelClose(); setTip(null); setOpen({ key: g.key, pos: posOf(el) }) }
        return (
          <div
            key={g.key}
            onMouseEnter={e => openHere(e.currentTarget)}
            onMouseLeave={scheduleClose}
          >
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={isOpen}
              onClick={e => (isOpen ? setOpen(null) : openHere(e.currentTarget))}
              onKeyDown={e => { if (e.key === 'ArrowRight') { e.preventDefault(); openHere(e.currentTarget) } }}
              className={railItem(active, isOpen)}
            >
              <GroupIcon size={19} strokeWidth={1.75} />
              <span>{g.label}</span>
            </button>
            {isOpen && open && (
              // Continuação do grupo, encostada na barra (o pl-2 mantém o mouse "dentro" ao atravessar)
              <div
                ref={el => {
                  // Perto do rodapé: sobe o necessário para caber na tela
                  if (!el) return
                  const over = open.pos.top + el.offsetHeight - (window.innerHeight - 8)
                  el.style.top = `${open.pos.top - (over > 0 ? Math.min(over, open.pos.top - 8) : 0)}px`
                }}
                className="fixed z-50 pl-2"
                style={{ top: open.pos.top, left: open.pos.left }}
                role="menu"
                aria-label={g.label}
              >
                <div className="w-64 rounded-lg border border-gray-200 bg-white py-2 shadow-xl">
                  <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">{g.label}</p>
                  {g.items.map(it => {
                    const ItIcon = it.icon
                    const on = it.href === current && !inSettings
                    return (
                      <Link
                        key={it.href}
                        href={it.href}
                        role="menuitem"
                        aria-current={on ? 'page' : undefined}
                        onClick={() => setOpen(null)}
                        className={`mx-1.5 flex items-start gap-2.5 rounded-md px-2 py-2 ${on ? 'bg-brand-100 text-brand-800' : 'text-gray-700 hover:bg-gray-50'}`}
                      >
                        <ItIcon size={16} strokeWidth={1.75} className={`mt-0.5 shrink-0 ${on ? 'text-brand-700' : 'text-gray-400'}`} />
                        <span className="min-w-0">
                          <span className="block text-sm font-medium">{it.label}</span>
                          {NAV_HELP[it.href] && <span className="block text-xs text-gray-500">{NAV_HELP[it.href]}</span>}
                        </span>
                      </Link>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )
      })}

      <div className="my-2 border-t border-white/10" />

      <Link href="/settings" aria-current={inSettings ? 'page' : undefined} className={railItem(inSettings)} {...tipProps('/settings')}>
        <Settings size={19} strokeWidth={1.75} />
        <span>Configurações</span>
      </Link>
      {isSuperAdmin && (
        <Link href="/super-admin" className={railItem(matches(pathname, '/super-admin'))} {...tipProps('/super-admin')}>
          <ShieldCheck size={19} strokeWidth={1.75} />
          <span>Super Admin</span>
        </Link>
      )}

      {tip && (
        // Dica do link direto (grupo de uma tela só), à direita da barra
        <span
          aria-hidden="true"
          className="pointer-events-none fixed z-50 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md bg-gray-900 px-2.5 py-1.5 text-xs text-white shadow-lg"
          style={{ top: tip.pos.top + tip.h / 2, left: tip.pos.left }}
        >
          {tip.text}
        </span>
      )}
    </nav>
  )
}
