'use client'

// Envolve o conteúdo de cada tela. Usa o caminho ATUAL (usePathname), porque o
// layout do Next não é refeito ao trocar de tela pelo menu — antes a ajuda e o
// bloqueio ficavam presos na primeira tela aberta.

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { FEATURES, featureForPath } from '@/lib/config/plans'
import { getPageHelp } from '@/lib/help/page-help'
import { HelpTip } from '@/components/ui/help-tip'

export function PageFrame({ enabledFeatures, children }: { enabledFeatures: string[]; children: React.ReactNode }) {
  const pathname = usePathname() ?? '/'
  const pathFeature = featureForPath(pathname)
  const blocked = !!pathFeature && !enabledFeatures.includes(pathFeature)
  const help = getPageHelp(pathname)
  const [blockedFrom, setBlockedFrom] = useState<string | null>(null)
  useEffect(() => {
    setBlockedFrom(new URLSearchParams(window.location.search).get('bloqueado'))
  }, [pathname])

  if (blocked) {
    return (
      <div className="mx-auto mt-16 max-w-md rounded-xl border border-gray-200 bg-white p-8 text-center">
        <p className="text-base font-semibold text-gray-900">
          {FEATURES.find(f => f.key === pathFeature)?.label ?? 'Esta área'} não está liberada no seu plano
        </p>
        <p className="mt-2 text-sm text-gray-500">Fale com o administrador da sua licença para liberar esta aba.</p>
      </div>
    )
  }

  return (
    <>
      {blockedFrom && pathname === '/settings' && (
        <p role="status" className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          A aba “{FEATURES.find(f => f.key === blockedFrom)?.label ?? blockedFrom}” não está liberada no seu plano.
        </p>
      )}
      {help && (
        <div key={pathname} className="-mt-2 mb-2 flex items-center justify-end gap-1.5 text-[11px] text-gray-400">
          <span>Como funciona esta tela</span>
          <HelpTip title={help.title} text={help.text} tips={help.tips} />
        </div>
      )}
      {children}
    </>
  )
}
