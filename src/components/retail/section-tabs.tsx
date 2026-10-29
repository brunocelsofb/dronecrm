import Link from 'next/link'

// Abas de uma mesma área (ex.: Produtos: O que falta | Todas). Só links: nada de estado.
export function SectionTabs({ tabs, active }: { tabs: { href: string; label: string }[]; active: string }) {
  return (
    <nav className="flex gap-1 border-b border-gray-200" aria-label="Abas">
      {tabs.map(t => (
        <Link key={t.href} href={t.href} aria-current={t.href === active ? 'page' : undefined}
          className={`-mb-px border-b-2 px-3 py-2 text-sm ${t.href === active ? 'border-brand-700 font-medium text-brand-800' : 'border-transparent text-gray-600 hover:text-gray-900'}`}>{t.label}</Link>
      ))}
    </nav>
  )
}
export const PRODUCT_TABS = [{ href: '/varejo/produtos/prontas', label: 'O que falta' }, { href: '/varejo/produtos', label: 'Todas as peças' }, { href: '/varejo/estoque', label: 'Estoque' }]
export const ORDER_TABS = [{ href: '/varejo/funil', label: 'Quadro' }, { href: '/varejo/pedidos', label: 'Lista' }]
export const CUSTOMER_TABS = [{ href: '/varejo/clientes', label: 'Clientes' }, { href: '/varejo/campanhas', label: 'Campanhas' }]
