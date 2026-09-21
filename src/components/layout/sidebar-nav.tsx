'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, KanbanSquare, FileText, Building2, Settings, Target, LifeBuoy, MessageCircle, BarChart3, Briefcase, ShieldCheck, ClipboardList } from 'lucide-react'
import { canAccess, type PlanId } from '@/lib/config/plans'

const ALL_NAV_ITEMS = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard, feature: 'dashboard' },
  { href: '/pipeline', label: 'Funil', icon: KanbanSquare, feature: 'pipeline' },
  { href: '/leads', label: 'Leads', icon: Target, feature: 'leads' },
  { href: '/contracts', label: 'Oportunidades', icon: FileText, feature: 'contracts' },
  { href: '/propostas', label: 'Propostas', icon: FileText, feature: 'propostas' },
  { href: '/carteira', label: 'Gestão de Carteira', icon: Briefcase, feature: 'carteira' },
  { href: '/companies', label: 'Empresas', icon: Building2, feature: 'companies' },
  { href: '/tickets', label: 'Atendimento', icon: LifeBuoy, feature: 'tickets' },
  { href: '/whatsapp', label: 'WhatsApp', icon: MessageCircle, feature: 'whatsapp' },
  { href: '/whatsapp/relatorios', label: 'Relatórios WPP', icon: BarChart3, feature: 'whatsapp-relatorios' },
  { href: '/surveys-dashboard', label: 'Pesquisas & NPS', icon: ClipboardList, feature: 'surveys' },
]

export function SidebarNav({
  isAdmin,
  isSuperAdmin,
  effectivePlan = 'starter',
}: {
  isAdmin: boolean
  isSuperAdmin?: boolean
  effectivePlan?: PlanId
}) {
  const pathname = usePathname()

  const items = [
    ...ALL_NAV_ITEMS.filter((item) => canAccess(effectivePlan, item.feature)),
    { href: '/settings', label: 'Configurações', icon: Settings, feature: 'settings' },
    ...(isSuperAdmin ? [{ href: '/super-admin', label: '⚙️ Super Admin', icon: ShieldCheck, feature: 'settings' }] : []),
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
