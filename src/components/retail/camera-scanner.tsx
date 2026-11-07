'use client'
// Leitura de código de barras pela câmera do celular (ou do computador), sem leitor físico.
// Cada código lido vai para o mesmo lugar do leitor USB (onCode). O mesmo código só conta de novo
// depois de sair da frente da câmera por um instante, para não somar várias vezes a mesma etiqueta.
// Usa a câmera traseira quando existe. Nada é gravado nem enviado: a imagem fica só no aparelho.
import { useEffect, useRef, useState } from 'react'

type Controls = { stop: () => void }

export function CameraScanner({ onCode, onClose }: { onCode: (code: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastRead, setLastRead] = useState<string | null>(null)
  const onCodeRef = useRef(onCode)
  useEffect(() => { onCodeRef.current = onCode }, [onCode])

  useEffect(() => {
    let controls: Controls | null = null
    let cancelled = false
    let lastCode = ''
    let lastSeen = 0
    ;(async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('Este navegador não libera a câmera. Use o Chrome ou o Safari atualizados (e o endereço com https).')
        return
      }
      try {
        const [{ BrowserMultiFormatReader }, { DecodeHintType, BarcodeFormat }] = await Promise.all([
          import('@zxing/browser'), import('@zxing/library'),
        ])
        const hints = new Map()
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [
          BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E,
          BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.ITF, BarcodeFormat.QR_CODE,
        ])
        hints.set(DecodeHintType.TRY_HARDER, true)
        const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 120 })
        if (cancelled || !video.current) return
        controls = await reader.decodeFromConstraints(
          { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
          video.current,
          (result) => {
            const now = Date.now()
            if (!result) {
              // etiqueta saiu da frente da câmera: a mesma pode ser lida de novo
              if (now - lastSeen > 900) lastCode = ''
              return
            }
            const code = result.getText().trim()
            lastSeen = now
            if (!code || code === lastCode) return
            lastCode = code
            setLastRead(code)
            try { navigator.vibrate?.(60) } catch { /* sem vibração */ }
            onCodeRef.current(code)
          },
        )
        if (cancelled) controls.stop()
      } catch (e) {
        const name = (e as { name?: string })?.name
        setError(name === 'NotAllowedError'
          ? 'A câmera foi bloqueada. Libere o acesso à câmera para este site nas configurações do navegador e abra de novo.'
          : name === 'NotFoundError' ? 'Nenhuma câmera encontrada neste aparelho.'
          : 'Não consegui abrir a câmera. Feche outros apps que estejam usando a câmera e tente de novo.')
      }
    })()
    return () => { cancelled = true; controls?.stop() }
  }, [])

  return (
    <div className="space-y-2 rounded-xl border border-gray-200 bg-white p-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-gray-900">Câmera: aponte para o código de barras</p>
        <button type="button" onClick={onClose} className="rounded-lg border border-gray-300 px-3 py-1 text-sm text-gray-700 hover:bg-gray-50">Fechar câmera</button>
      </div>
      {error ? (
        <p role="alert" className="rounded-lg bg-warn-100 px-3 py-2 text-sm text-warn-700">{error}</p>
      ) : (
        <div className="relative overflow-hidden rounded-lg bg-black">
          <video ref={video} className="aspect-video w-full object-cover" muted playsInline aria-label="Imagem da câmera" />
          {/* guia de enquadramento */}
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-[12%] top-1/2 h-[30%] -translate-y-1/2 rounded-md border-2 border-white/80" />
        </div>
      )}
      <p className="text-xs text-gray-500">
        Encaixe a etiqueta no retângulo, com boa luz. Cada etiqueta diferente soma 1; para somar a mesma peça de novo, tire da frente e aponte outra vez.
        {lastRead && <> Última leitura: <span className="font-mono">{lastRead}</span>.</>}
      </p>
    </div>
  )
}
