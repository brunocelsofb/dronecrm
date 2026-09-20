'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, KanbanSquare, FileText, Building2, Settings, Target, LifeBuoy, MessageCircle, BarChart3, Briefcase, ShieldCheck } from 'lucide-react'

const BASE_NAV_ITEMS = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/pipeline', label: 'Funil', icon: KanbanSquare },
  { href: '/leads', label: 'Leads', icon: Target },
  { href: '/contracts', label: 'Oportunidades', icon: FileText },
  { href: '/propostas', label: 'Propostas', icon: FileText },
  { href: '/carteira', label: 'Gestão de Carteira', icon: Briefcase },
  { href: '/companies', label: 'Empresas', icon: Building2 },
  { href: '/tickets', label: 'Atendimento', icon: LifeBuoy },
  { href: '/whatsapp', label: 'WhatsApp', icon: MessageCircle },
  { href: '/whatsapp/relatorios', label: 'Relatórios WPP', icon: BarChart3 },
  { href: '/surveys-dashboard', label: 'Pesquisas & NPS', icon: BarChart3 },
]

export function SidebarNav({ isAdmin, isSuperAdmin }: { isAdmin: boolean; isSuperAdmin?: boolean }) {
  const pathname = usePathname()

  const items = [
    ...BASE_NAV_ITEMS,
    { href: '/settings', label: 'Configurações', icon: Settings },
    ...(isSuperAdmin ? [{ href: '/super-admin', label: '⚙️ Super Admin', icon: ShieldCheck }] : []),
  ]

  return (
    <nav className="space-y-0.5">
      {items.map((item) => {
        const active = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href))
        const Icon = item.icon
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors ${
              active
                ? 'bg-white/10 text-white'
                : 'text-brand-100/70 hover:bg-white/5 hover:text-white'
            }`}
          >
            <Icon size={16} strokeWidth={1.75} />
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
