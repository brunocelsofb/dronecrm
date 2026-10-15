'use client'

// "ⓘ" discreto: passa o mouse (ou foca com o teclado) e aparece a explicação.

import { useId, useState } from 'react'

export function HelpTip({
  title,
  text,
  tips,
  align = 'right',
  label = 'Como funciona',
}: {
  title?: string
  text: string
  tips?: string[]
  align?: 'left' | 'right'
  label?: string
}) {
  const id = useId()
  const [open, setOpen] = useState(false)

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-describedby={open ? id : undefined}
        aria-label={label}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen(o => !o)}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-gray-300 bg-white text-[11px] font-semibold text-gray-500 hover:border-[#1B556B] hover:text-[#1B556B] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1B556B]/40"
      >
        i
      </button>
      {open && (
        <span
          id={id}
          role="tooltip"
          className={`absolute top-7 z-50 w-72 rounded-lg border border-gray-200 bg-white p-3 text-left shadow-lg ${align === 'right' ? 'right-0' : 'left-0'}`}
        >
          {title && <span className="block text-xs font-semibold text-gray-900">{title}</span>}
          <span className="mt-0.5 block text-xs leading-relaxed text-gray-600">{text}</span>
          {tips && tips.length > 0 && (
            <span className="mt-2 block space-y-1">
              {tips.map((t, i) => (
                <span key={i} className="flex gap-1.5 text-[11px] leading-snug text-gray-500">
                  <span aria-hidden="true" className="text-[#1B556B]">•</span>
                  <span>{t}</span>
                </span>
              ))}
            </span>
          )}
        </span>
      )}
    </span>
  )
}
