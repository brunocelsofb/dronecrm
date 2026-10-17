'use client'

import { useState } from 'react'
import { PLATFORM_BRAND } from '@/lib/config/platform'

export function LogoBadge({ src }: { src?: string }) {
  const fallback = PLATFORM_BRAND.logoUrl
  const [imgSrc, setImgSrc] = useState(src || fallback)
  const [failed, setFailed] = useState(false)

  if (!src && failed) return null

  return (
    <img
      src={imgSrc}
      alt="Logo"
      className="h-8 md:h-10 w-auto object-contain flex-shrink-0"
      onError={() => {
        if (imgSrc !== fallback) setImgSrc(fallback)
        else setFailed(true)
      }}
    />
  )
}
