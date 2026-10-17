'use client'

// Envolve o conteúdo de cada tela. Usa o caminho ATUAL (usePathname), porque o
// layout do Next não é refeito ao trocar de tela pelo menu — antes a ajuda e o
// bloqueio ficavam presos na primeira tela aberta.

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { FEATURES, featureForPath } from '@/lib/config/plans'
import { getPageHelp } from '@/lib/help/page-help'
import { HelpTip } from '@/components/ui/help-tip'
import Link from 'next/link'
import { isSettingsChild } from '@/lib/config/settings-nav'

export function PageFrame({ enabledFeatures, planFeatures, children }: { enabledFeatures: string[]; planFeatures?: string[]; children: React.ReactNode }) {
  const pathname = usePathname() ?? '/'
  const pathFeature = featureForPath(pathname)
  const blocked = !!pathFeature && !enabledFeatures.includes(pathFeature)
  const help = getPageHelp(pathname)
  // Bloqueada pelo plano (licença) ou pelo perfil de acesso da pessoa
  const byProfile = blocked && !!planFeatures && planFeatures.includes(pathFeature!)
  const [blockedFrom, setBlockedFrom] = useState<{ key: string; profile: boolean } | null>(null)
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const key = q.get('bloqueado')
    setBlockedFrom(key ? { key, profile: q.get('motivo') === 'perfil' } : null)
  }, [pathname])

  if (blocked) {
    return (
      <div className="mx-auto mt-16 max-w-md rounded-xl border border-gray-200 bg-white p-8 text-center">
        <p className="text-base font-semibold text-gray-900">
          {FEATURES.find(f => f.key === pathFeature)?.label ?? 'Esta área'} não está liberada {byProfile ? 'para o seu perfil de acesso' : 'no seu plano'}
        </p>
        <p className="mt-2 text-sm text-gray-500">{byProfile ? 'Fale com o administrador do CRM da sua empresa para liberar esta aba.' : 'Fale com o administrador da sua licença para liberar esta aba.'}</p>
      </div>
    )
  }

  return (
    <>
      {blockedFrom && (
        <p role="status" className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          A aba “{FEATURES.find(f => f.key === blockedFrom.key)?.label ?? blockedFrom.key}” não está liberada {blockedFrom.profile ? 'para o seu perfil de acesso' : 'no seu plano'}.
        </p>
      )}
      {(help || isSettingsChild(pathname)) && (
        <div key={pathname} className="-mt-2 mb-2 flex items-center justify-between gap-3 text-[11px] text-gray-400">
          {isSettingsChild(pathname)
            ? <Link href="/settings" className="rounded-md px-1 py-0.5 text-xs font-medium text-brand-700 hover:bg-brand-100">← Configurações</Link>
            : <span />}
          {help && (
            <span className="flex items-center gap-1.5">
              <span>Como funciona esta tela</span>
              <HelpTip title={help.title} text={help.text} tips={help.tips} />
            </span>
          )}
        </div>
      )}
      {children}
    </>
  )
}
