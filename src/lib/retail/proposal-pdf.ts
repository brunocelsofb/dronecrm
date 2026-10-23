// PDF da proposta do Varejo (pdf-lib, A4). Só o que a cliente pode ver: sem custo nem margem.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import type { RetailProposal } from './proposal'

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const money = (n: number) => BRL.format(n).replace(/ /g, ' ')
const day = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
// Helvetica padrão só escreve o alfabeto WinAnsi (acentos do português incluídos)
const safe = (s: string) => Array.from(s ?? '').map(ch => (ch.charCodeAt(0) <= 255 || '—–‘’“”•…€'.includes(ch) ? ch : '-')).join('')

function hexToRgb(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? '')
  const n = m ? parseInt(m[1], 16) : 0x1b556b
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255)
}

export async function buildProposalPdf(p: RetailProposal, opts: { logo: Uint8Array | null; brandColor: string; acceptUrl: string; chosen: string | null }): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setTitle(safe(`Pedido ${p.number} — ${p.store}`))
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const brand = hexToRgb(opts.brandColor)
  const gray = rgb(0.38, 0.38, 0.4), dark = rgb(0.1, 0.1, 0.12), line = rgb(0.88, 0.88, 0.9)
  const W = 595.28, H = 841.89, M = 48
  let page: PDFPage = doc.addPage([W, H])
  let y = H - M

  const text = (s: string, x: number, yy: number, size = 10, f: PDFFont = font, color = dark) => page.drawText(safe(s), { x, y: yy, size, font: f, color })
  const right = (s: string, xr: number, yy: number, size = 10, f: PDFFont = font, color = dark) => { const t = safe(s); page.drawText(t, { x: xr - f.widthOfTextAtSize(t, size), y: yy, size, font: f, color }) }
  const ensure = (need: number) => { if (y - need < M + 40) { page = doc.addPage([W, H]); y = H - M } }

  // Cabeçalho: logo + loja + número
  let logoH = 0
  if (opts.logo) {
    try {
      const isPng = opts.logo[0] === 0x89 && opts.logo[1] === 0x50
      const img = isPng ? await doc.embedPng(opts.logo) : await doc.embedJpg(opts.logo)
      const s = img.scale(Math.min(150 / img.width, 56 / img.height, 1))
      page.drawImage(img, { x: M, y: y - s.height, width: s.width, height: s.height })
      logoH = s.height
    } catch { logoH = 0 }
  }
  if (!logoH) { text(p.store, M, y - 18, 18, bold, brand); logoH = 24 }
  right('RESUMO DO PEDIDO', W - M, y - 12, 9, bold, gray)
  right(`Nº ${p.number}`, W - M, y - 30, 16, bold, brand)
  right(`${day(p.created_at)} · válida até ${day(p.valid_until)}`, W - M, y - 46, 9, font, gray)
  y -= Math.max(logoH, 50) + 22
  page.drawRectangle({ x: M, y, width: W - 2 * M, height: 2, color: brand })
  y -= 26

  text('Para', M, y, 9, bold, gray)
  text(p.customer.name ?? 'Cliente', M, y - 16, 14, bold)
  if (p.customer.phone) text(p.customer.phone.replace(/^(\d{2})(\d{4,5})(\d{4})$/, '($1) $2-$3'), M, y - 32, 10, font, gray)
  y -= 56

  // Itens
  const cQty = W - M - 200, cUnit = W - M - 110, cTot = W - M
  text('Peça', M, y, 9, bold, gray); right('Qtd.', cQty, y, 9, bold, gray); right('Valor un.', cUnit, y, 9, bold, gray); right('Total', cTot, y, 9, bold, gray)
  y -= 8; page.drawRectangle({ x: M, y, width: W - 2 * M, height: 0.7, color: line }); y -= 16
  for (const it of p.items) {
    ensure(34)
    text(it.name.slice(0, 60), M, y, 10.5, bold)
    if (it.detail) text(it.detail.slice(0, 70), M, y - 13, 9, font, gray)
    right(String(it.qty), cQty, y, 10.5); right(money(it.unit_price), cUnit, y, 10.5); right(money(it.total), cTot, y, 10.5, bold)
    y -= it.detail ? 26 : 18
    page.drawRectangle({ x: M, y: y + 6, width: W - 2 * M, height: 0.5, color: line })
    y -= 6
  }
  // Totais
  const totRow = (label: string, value: string, f: PDFFont = font, size = 10) => { ensure(18); text(label, cUnit - 120, y, size, f, f === bold ? dark : gray); right(value, cTot, y, size, f); y -= 16 }
  y -= 4
  totRow('Subtotal das peças', money(p.subtotal))
  if (p.discount > 0) totRow('Desconto', `- ${money(p.discount)}`)
  if (p.loyalty_discount > 0) totRow('Fidelidade', `- ${money(p.loyalty_discount)}`)
  if (p.shipping > 0) totRow('Frete', money(p.shipping))
  y -= 14

  // Condições
  ensure(40 + p.options.length * 52)
  text('Condições de pagamento', M, y, 12, bold, brand); y -= 20
  for (const o of p.options) {
    const chosen = opts.chosen === o.id
    page.drawRectangle({ x: M, y: y - 34, width: W - 2 * M, height: 44, borderColor: chosen ? brand : line, borderWidth: chosen ? 1.5 : 0.8, color: chosen ? rgb(0.96, 0.98, 0.98) : rgb(1, 1, 1) })
    text(o.label + (chosen ? '  (escolhida)' : ''), M + 12, y - 8, 11, bold)
    text(o.installments > 1 ? `${o.installments}x de ${money(o.installmentValue)}` : 'Pagamento único', M + 12, y - 24, 9, font, gray)
    right(money(o.grand_total), W - M - 12, y - 14, 15, bold, brand)
    y -= 54
  }
  y -= 4
  ensure(60)
  text(opts.chosen ? 'Forma de pagamento escolhida. Obrigado!' : 'Para finalizar, abra o link, escolha Pix ou cartão e pague:', M, y, 10, bold); y -= 15
  if (!opts.chosen) { text(opts.acceptUrl, M, y, 9, font, brand); y -= 14 }
  text('Disponibilidade das peças confirmada pelo atendimento. Valores válidos até a data acima.', M, y, 8.5, font, gray)

  // Rodapé em todas as páginas
  for (const pg of doc.getPages()) {
    pg.drawRectangle({ x: 0, y: 0, width: W, height: 26, color: brand })
    pg.drawText(safe(p.store), { x: M, y: 9, size: 8.5, font: bold, color: rgb(1, 1, 1) })
  }
  return doc.save()
}
