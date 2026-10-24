// Vitrine do Varejo — lê o catálogo da loja no Drone (/api/catalogo, pelo domínio)
// e manda o pedido (/api/pedido). Nada da loja fica fixo aqui: nome, cores, ocasiões,
// peças, looks e WhatsApp vêm do Drone (Varejo → Vitrine).
(function () {
  'use strict'

  const qs = new URLSearchParams(location.search)
  const loja = (qs.get('loja') || '').toLowerCase().replace(/[^a-z0-9-]/g, '')
  const api = (path) => `/api/${path}${loja ? `?loja=${encodeURIComponent(loja)}` : ''}`
  const $ = (s, el = document) => el.querySelector(s)
  const app = $('#app')
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const variantLabel = (v) => [v.color, v.size].filter(Boolean).join(' / ')

  let data = null
  let state = { occasion: '', category: '', q: '' }
  let bag = []
  const bagKey = () => `vitrine-sacola-${data ? data.store.slug : loja || location.hostname}`

  // ── Sacola (fica neste aparelho) ────────────────────────────────────────────
  function loadBag() { try { bag = JSON.parse(localStorage.getItem(bagKey()) || '[]').filter(i => i && i.variant_id && i.qty > 0) } catch { bag = [] } }
  function saveBag() { try { localStorage.setItem(bagKey(), JSON.stringify(bag)) } catch { /* modo privado: fica só na tela */ } renderBadge() }
  function renderBadge() {
    const n = bag.reduce((s, i) => s + i.qty, 0)
    const b = $('#bagCount'); b.textContent = String(n); b.hidden = n === 0
  }
  function findVariant(variantId) {
    for (const p of data.products) { const v = p.variants.find(x => x.id === variantId); if (v) return { p, v } }
    return null
  }
  function addToBag(variantId, qty = 1) {
    const hit = bag.find(i => i.variant_id === variantId)
    if (hit) hit.qty = Math.min(20, hit.qty + qty); else bag.push({ variant_id: variantId, qty })
    saveBag()
  }
  function bagLines() {
    return bag.map(i => ({ ...i, ...(findVariant(i.variant_id) || {}) })).filter(l => l.p && l.v && l.v.available)
  }

  // ── Janela (peça, look, sacola) ─────────────────────────────────────────────
  let lastFocus = null
  function openSheet(html, title) {
    lastFocus = document.activeElement
    $('#sheetBody').innerHTML = html
    $('#sheet').setAttribute('aria-label', title || 'Detalhes')
    $('#scrim').hidden = false; $('#sheet').hidden = false
    document.body.style.overflow = 'hidden'
    $('#sheet').scrollTop = 0
    $('#sheetClose').focus()
  }
  function closeSheet() {
    $('#scrim').hidden = true; $('#sheet').hidden = true
    document.body.style.overflow = ''
    if (lastFocus && lastFocus.focus) lastFocus.focus()
  }
  $('#scrim').addEventListener('click', closeSheet)
  $('#sheetClose').addEventListener('click', closeSheet)
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#sheet').hidden) closeSheet() })
  $('#bagBtn').addEventListener('click', () => data && showBag())

  function toast(text) {
    const t = $('#toast'); t.textContent = text; t.hidden = false
    clearTimeout(toast.timer); toast.timer = setTimeout(() => { t.hidden = true }, 2200)
  }

  // ── Tela principal ──────────────────────────────────────────────────────────
  function priceHtml(p) {
    return p.promo_price !== null && p.promo_price < p.price ? `<span class="price"><s>${brl(p.price)}</s>${brl(p.final_price)}</span>` : `<span class="price">${brl(p.final_price)}</span>`
  }
  function card(p) {
    const last = p.variants.some(v => v.last_units) && !p.variants.some(v => v.available && !v.last_units)
    return `<button class="card" type="button" data-product="${esc(p.id)}">
      <div class="ph">${p.photos[0] ? `<img src="${esc(p.photos[0])}" alt="${esc(p.name)}" loading="lazy">` : ''}
        ${p.is_new ? '<span class="tag">Novo</span>' : ''}${last ? '<span class="tag warn">Últimas unidades</span>' : ''}</div>
      <div class="name">${esc(p.name)}</div>${priceHtml(p)}</button>`
  }
  function visibleProducts() {
    const q = state.q.trim().toLowerCase()
    return data.products.filter(p => (!state.occasion || p.occasions.includes(state.occasion)) && (!state.category || p.category === state.category) && (!q || `${p.name} ${p.category || ''}`.toLowerCase().includes(q)))
  }
  function visibleLooks() { return data.looks.filter(l => !state.occasion || l.occasion === state.occasion) }

  function render() {
    const s = data.store
    const occ = s.occasions.filter(o => data.products.some(p => p.occasions.includes(o.id)) || data.looks.some(l => l.occasion === o.id))
    const looks = visibleLooks()
    const prods = visibleProducts()
    app.innerHTML = `
      <section class="hero" id="inicio">
        ${s.hero ? `<picture>${s.hero_mobile ? `<source media="(max-width: 859px)" srcset="${esc(s.hero_mobile)}">` : ''}<img src="${esc(s.hero)}" alt="" fetchpriority="high"></picture>` : ''}
        <div class="wrap">
          <h1>${esc(s.name)}</h1>
          ${s.tagline ? `<p>${esc(s.tagline)}</p>` : ''}
          <a class="btn light" href="#pecas">Ver as peças</a>
        </div>
      </section>
      ${occ.length ? `<section class="block wrap" id="ocasioes">
        <h2>Para cada momento</h2><p class="sub">Escolha a ocasião e veja o que combina.</p>
        <div class="chips" role="group" aria-label="Ocasiões">
          <button class="chip" type="button" data-occ="" aria-pressed="${!state.occasion}">Todas</button>
          ${occ.map(o => `<button class="chip" type="button" data-occ="${esc(o.id)}" aria-pressed="${state.occasion === o.id}">${esc(o.name)}</button>`).join('')}
        </div></section>` : ''}
      ${looks.length ? `<section class="block wrap" id="looks">
        <h2>Looks prontos</h2><p class="sub">Peças que já combinam. Toque para montar o seu.</p>
        <div class="looks">${looks.map(l => `<button class="look" type="button" data-look="${esc(l.id)}">
          <div class="ph">${l.cover ? `<img src="${esc(l.cover)}" alt="${esc(l.name)}" loading="lazy">` : ''}</div>
          <b>${esc(l.name)}</b><span>${l.product_ids.length} peça${l.product_ids.length === 1 ? '' : 's'}${l.occasion ? ` · ${esc((s.occasions.find(o => o.id === l.occasion) || {}).name || '')}` : ''}</span></button>`).join('')}</div>
      </section>` : ''}
      <section class="block wrap" id="pecas">
        <h2>${state.occasion ? esc((s.occasions.find(o => o.id === state.occasion) || {}).name || 'Peças') : 'Peças'}</h2>
        <div class="tools"><label class="sr" for="q">Buscar</label><input class="search" id="q" type="search" placeholder="Buscar peça" value="${esc(state.q)}" enterkeyhint="search"></div>
        ${data.categories.length > 1 ? `<div class="chips" role="group" aria-label="Categorias">
          <button class="chip" type="button" data-cat="" aria-pressed="${!state.category}">Tudo</button>
          ${data.categories.map(c => `<button class="chip" type="button" data-cat="${esc(c)}" aria-pressed="${state.category === c}">${esc(c)}</button>`).join('')}</div>` : ''}
        ${prods.length ? `<div class="grid" id="grid">${prods.map(card).join('')}</div>` : '<p class="empty">Nenhuma peça por aqui. Tente outra ocasião ou busca.</p>'}
      </section>
      <section class="about" id="sobre"><div class="wrap">
        ${s.about ? `<h2 class="block" style="padding:0;font-family:var(--serif);font-weight:400;font-size:34px;color:var(--brand);margin:0 0 8px">Sobre a ${esc(s.name)}</h2><p>${esc(s.about)}</p>` : ''}
        <h2 style="font-family:var(--serif);font-weight:400;font-size:34px;color:var(--brand);margin:24px 0 12px">Como comprar</h2>
        <div class="steps">
          <div class="step"><b>Escolha</b><br>Monte a sacola com as peças e os tamanhos.</div>
          <div class="step"><b>Envie o pedido</b><br>Só nome e WhatsApp. Sem senha, sem cadastro longo.</div>
          <div class="step"><b>Finalize no WhatsApp</b><br>A loja confirma o tamanho e o frete e te manda o link para pagar.</div>
        </div>
      </div></section>
      <footer class="wrap">${esc(s.name)}${s.whatsapp ? ` · <a href="https://wa.me/${s.whatsapp.length <= 11 ? '55' + esc(s.whatsapp) : esc(s.whatsapp)}" target="_blank" rel="noopener">Fale no WhatsApp</a>` : ''}</footer>`
    bindMain()
  }

  function bindMain() {
    app.querySelectorAll('[data-occ]').forEach(b => b.addEventListener('click', () => { state.occasion = b.dataset.occ; render(); const t = $('#looks') || $('#pecas'); if (t) t.scrollIntoView({ behavior: 'smooth' }) }))
    app.querySelectorAll('[data-cat]').forEach(b => b.addEventListener('click', () => { state.category = b.dataset.cat; render(); $('#pecas').scrollIntoView() }))
    app.querySelectorAll('[data-product]').forEach(b => b.addEventListener('click', () => showProduct(b.dataset.product)))
    app.querySelectorAll('[data-look]').forEach(b => b.addEventListener('click', () => showLook(b.dataset.look)))
    const q = $('#q')
    if (q) q.addEventListener('input', () => { state.q = q.value; clearTimeout(bindMain.t); bindMain.t = setTimeout(() => { const pos = q.selectionStart; render(); const n = $('#q'); n.focus(); try { n.setSelectionRange(pos, pos) } catch { /* ok */ } }, 250) })
  }

  // ── Peça ────────────────────────────────────────────────────────────────────
  function picker(p, prefix) {
    const colors = [...new Set(p.variants.map(v => v.color || ''))]
    return `<div data-picker="${esc(p.id)}" data-prefix="${prefix}">
      ${colors.length > 1 || colors[0] ? `<div class="opt-label">Cor</div><div class="opts">${colors.map(c => `<button class="opt" type="button" data-color="${esc(c)}" ${p.variants.some(v => (v.color || '') === c && v.available) ? '' : 'disabled'}>${esc(c || 'Única')}</button>`).join('')}</div>` : ''}
      <div class="opt-label">Tamanho</div><div class="opts" data-sizes></div>
    </div>`
  }
  function bindPicker(root, p, onPick) {
    const el = root.querySelector(`[data-picker="${CSS.escape(p.id)}"]`)
    let color = null
    const colors = [...new Set(p.variants.map(v => v.color || ''))]
    if (colors.length === 1) color = colors[0]
    const firstAvail = p.variants.find(v => v.available)
    if (color === null && firstAvail) color = firstAvail.color || ''
    function sizes() {
      el.querySelectorAll('[data-color]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.color === color)))
      const list = p.variants.filter(v => (v.color || '') === color)
      el.querySelector('[data-sizes]').innerHTML = list.map(v => `<button class="opt" type="button" data-variant="${esc(v.id)}" ${v.available ? '' : 'disabled'}>${esc(v.size || 'Único')}${v.last_units && v.available ? ' (últimas)' : ''}</button>`).join('')
      el.querySelectorAll('[data-variant]').forEach(b => b.addEventListener('click', () => {
        el.querySelectorAll('[data-variant]').forEach(x => x.setAttribute('aria-pressed', String(x === b)))
        onPick(b.dataset.variant)
      }))
      onPick(null)
      const avail = list.filter(v => v.available)
      if (avail.length === 1) { const b = el.querySelector(`[data-variant="${CSS.escape(avail[0].id)}"]`); if (b) b.click() }
    }
    el.querySelectorAll('[data-color]').forEach(b => b.addEventListener('click', () => { color = b.dataset.color; sizes() }))
    sizes()
  }

  function showProduct(id) {
    const p = data.products.find(x => x.id === id)
    if (!p) return
    const inLooks = data.looks.filter(l => l.product_ids.includes(p.id))
    const goes = data.products.filter(x => x.id !== p.id && x.occasions.some(o => p.occasions.includes(o))).slice(0, 6)
    const info = [['Descrição', p.description], ['Tecido', p.composition], ['Medidas e caimento', p.measures], ['Cuidados', p.care]].filter(x => x[1])
    openSheet(`
      ${p.photos.length ? `<div class="gallery">${p.photos.map(src => `<img src="${esc(src)}" alt="${esc(p.name)}" loading="lazy">`).join('')}</div>` : ''}
      <h3 id="sheetTitle">${esc(p.name)}</h3>${priceHtml(p)}
      ${picker(p, 'p')}
      <p class="note" data-hint style="margin:10px 0 0">Escolha o tamanho.</p>
      <div style="margin-top:14px"><button class="btn block" type="button" data-add disabled>Colocar na sacola</button></div>
      ${info.length ? `<div class="details">${info.map(([t, v]) => `<details><summary>${esc(t)}</summary><p>${esc(v)}</p></details>`).join('')}</div>` : ''}
      ${inLooks.length ? `<div class="opt-label" style="margin-top:20px">Complete o look</div><div class="looks" style="grid-auto-columns:46%">${inLooks.map(l => `<button class="look" type="button" data-look="${esc(l.id)}"><div class="ph">${l.cover ? `<img src="${esc(l.cover)}" alt="" loading="lazy">` : ''}</div><b>${esc(l.name)}</b></button>`).join('')}</div>` : ''}
      ${goes.length ? `<div class="opt-label" style="margin-top:20px">Combina com</div><div class="looks" style="grid-auto-columns:40%">${goes.map(x => `<button class="look" type="button" data-product="${esc(x.id)}"><div class="ph">${x.photos[0] ? `<img src="${esc(x.photos[0])}" alt="" loading="lazy">` : ''}</div><b>${esc(x.name)}</b><span>${brl(x.final_price)}</span></button>`).join('')}</div>` : ''}
    `, p.name)
    const body = $('#sheetBody')
    let chosen = null
    bindPicker(body, p, v => {
      chosen = v
      body.querySelector('[data-add]').disabled = !v
      const vv = v && p.variants.find(x => x.id === v)
      body.querySelector('[data-hint]').textContent = vv ? (vv.last_units ? 'Últimas unidades deste tamanho.' : `${variantLabel(vv)} disponível.`) : 'Escolha o tamanho.'
    })
    body.querySelector('[data-add]').addEventListener('click', () => { if (!chosen) return; addToBag(chosen); toast('Na sacola!'); closeSheet() })
    body.querySelectorAll('[data-look]').forEach(b => b.addEventListener('click', () => showLook(b.dataset.look)))
    body.querySelectorAll('[data-product]').forEach(b => b.addEventListener('click', () => showProduct(b.dataset.product)))
  }

  // ── Look: escolhe o tamanho de cada peça e leva tudo junto ───────────────────
  function showLook(id) {
    const l = data.looks.find(x => x.id === id)
    if (!l) return
    const items = l.product_ids.map(pid => data.products.find(p => p.id === pid)).filter(Boolean)
    const total = items.reduce((s, p) => s + p.final_price, 0)
    openSheet(`
      ${l.cover ? `<div class="gallery" style="grid-auto-columns:100%"><img src="${esc(l.cover)}" alt="${esc(l.name)}"></div>` : ''}
      <h3 id="sheetTitle">${esc(l.name)}</h3>
      ${l.description ? `<p style="margin:0 0 8px;color:var(--muted)">${esc(l.description)}</p>` : ''}
      <p class="note">Escolha o tamanho de cada peça. Leve só as que quiser.</p>
      ${items.map(p => `<div class="mini" style="grid-template-columns:64px 1fr">
        ${p.photos[0] ? `<img src="${esc(p.photos[0])}" alt="">` : '<span class="noimg"></span>'}
        <div><b style="font-weight:500">${esc(p.name)}</b> <small>${brl(p.final_price)}</small>
          ${picker(p, 'l')}
          <label class="check" style="margin-top:8px"><input type="checkbox" data-take="${esc(p.id)}" checked> Levar esta peça</label>
        </div></div>`).join('')}
      <div class="total"><span>Look completo</span><b>${brl(total)}</b></div>
      <button class="btn block" type="button" data-add-look>Colocar na sacola</button>
      <p class="note" data-hint></p>
    `, l.name)
    const body = $('#sheetBody')
    const chosen = {}
    items.forEach(p => bindPicker(body, p, v => { chosen[p.id] = v }))
    body.querySelector('[data-add-look]').addEventListener('click', () => {
      const take = items.filter(p => body.querySelector(`[data-take="${CSS.escape(p.id)}"]`).checked)
      const missing = take.filter(p => !chosen[p.id])
      if (!take.length) { body.querySelector('[data-hint]').textContent = 'Marque ao menos uma peça.'; return }
      if (missing.length) { body.querySelector('[data-hint]').textContent = `Escolha o tamanho de: ${missing.map(p => p.name).join(', ')}.`; return }
      take.forEach(p => addToBag(chosen[p.id]))
      toast(take.length > 1 ? `${take.length} peças na sacola!` : 'Na sacola!')
      closeSheet()
    })
  }

  // ── Sacola e pedido ─────────────────────────────────────────────────────────
  function showBag() {
    const lines = bagLines()
    if (lines.length !== bag.length) { bag = lines.map(l => ({ variant_id: l.variant_id, qty: l.qty })); saveBag() }
    const total = lines.reduce((s, l) => s + l.p.final_price * l.qty, 0)
    openSheet(`
      <h3 id="sheetTitle">Sua sacola</h3>
      ${lines.length ? lines.map(l => `<div class="mini">
        ${l.p.photos[0] ? `<img src="${esc(l.p.photos[0])}" alt="">` : '<span class="noimg"></span>'}
        <div><b style="font-weight:500">${esc(l.p.name)}</b><small>${esc(variantLabel(l.v))}</small><small>${brl(l.p.final_price)}</small>
          <button class="link" type="button" data-rm="${esc(l.variant_id)}">Tirar</button></div>
        <div class="qty"><button type="button" aria-label="Menos" data-dec="${esc(l.variant_id)}">−</button><span>${l.qty}</span><button type="button" aria-label="Mais" data-inc="${esc(l.variant_id)}">+</button></div>
      </div>`).join('') + `
      <div class="total"><span>Total das peças</span><b>${brl(total)}</b></div>
      <p class="note">O frete e a forma de pagamento a loja combina com você no WhatsApp.</p>
      <form class="form" id="checkout" novalidate>
        <div><label for="c-name">Seu nome *</label><input type="text" id="c-name" autocomplete="name" required maxlength="120"></div>
        <div><label for="c-phone">Seu WhatsApp com DDD *</label><input type="tel" id="c-phone" autocomplete="tel" inputmode="tel" required placeholder="(00) 00000-0000"></div>
        <div><label for="c-email">E-mail (opcional)</label><input type="email" id="c-email" autocomplete="email" inputmode="email"></div>
        <div><label for="c-cep">CEP para o frete (opcional)</label><input type="text" id="c-cep" autocomplete="postal-code" inputmode="numeric" maxlength="9"></div>
        <div class="hp" aria-hidden="true"><label for="c-site">Site</label><input type="text" id="c-site" tabindex="-1" autocomplete="off"></div>
        <label class="check"><input type="checkbox" id="c-optin"> Aceito receber novidades da loja pelo WhatsApp.</label>
        <div class="err" id="c-err" role="alert" hidden></div>
        <button class="btn block" type="submit" id="c-send">Enviar pedido</button>
        <p class="note">Seus dados vão só para a loja, para atender este pedido.</p>
      </form>` : '<p class="empty">Sua sacola está vazia.</p>'}
    `, 'Sua sacola')
    const body = $('#sheetBody')
    const change = (id, d) => { const it = bag.find(i => i.variant_id === id); if (!it) return; it.qty = Math.max(0, Math.min(20, it.qty + d)); bag = bag.filter(i => i.qty > 0); saveBag(); showBag() }
    body.querySelectorAll('[data-inc]').forEach(b => b.addEventListener('click', () => change(b.dataset.inc, 1)))
    body.querySelectorAll('[data-dec]').forEach(b => b.addEventListener('click', () => change(b.dataset.dec, -1)))
    body.querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', () => { bag = bag.filter(i => i.variant_id !== b.dataset.rm); saveBag(); showBag() }))
    const form = $('#checkout')
    if (form) form.addEventListener('submit', submitOrder)
  }

  async function submitOrder(e) {
    e.preventDefault()
    const err = $('#c-err'), send = $('#c-send')
    err.hidden = true
    const payload = {
      customer: { name: $('#c-name').value, phone: $('#c-phone').value, email: $('#c-email').value, cep: $('#c-cep').value, optin: $('#c-optin').checked },
      items: bag.map(i => ({ variant_id: i.variant_id, qty: i.qty })),
      website: $('#c-site').value,
    }
    if (payload.customer.name.trim().length < 2) { err.textContent = 'Informe seu nome.'; err.hidden = false; return }
    if (payload.customer.phone.replace(/\D/g, '').length < 10) { err.textContent = 'Informe seu WhatsApp com DDD.'; err.hidden = false; return }
    send.disabled = true; send.textContent = 'Enviando…'
    try {
      const r = await fetch(api('pedido'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const out = await r.json().catch(() => ({}))
      if (!r.ok) { err.textContent = out.error || 'Não foi possível enviar agora. Tente de novo.'; err.hidden = false; send.disabled = false; send.textContent = 'Enviar pedido'; return }
      bag = []; saveBag()
      openSheet(`<div class="done"><div class="ok" aria-hidden="true">✓</div>
        <h3 id="sheetTitle">Pedido nº ${esc(out.number)} enviado!</h3>
        <p>Agora é só chamar a loja no WhatsApp: a mensagem já vai pronta com as suas peças.</p>
        ${out.whatsapp_url ? `<a class="btn wa block" href="${esc(out.whatsapp_url)}" target="_blank" rel="noopener">Abrir o WhatsApp da loja</a>` : '<p>A loja vai falar com você pelo WhatsApp.</p>'}
        </div>`, 'Pedido enviado')
    } catch {
      err.textContent = 'Sem conexão. Confira a internet e tente de novo.'; err.hidden = false
      send.disabled = false; send.textContent = 'Enviar pedido'
    }
  }

  // ── Início ──────────────────────────────────────────────────────────────────
  function applyStore(s) {
    document.title = s.name
    const meta = document.querySelector('meta[name="description"]'); if (meta && s.tagline) meta.setAttribute('content', s.tagline)
    document.documentElement.style.setProperty('--brand', s.theme.primary)
    document.documentElement.style.setProperty('--accent', s.theme.accent)
    $('#brand').innerHTML = s.logo ? `<img src="${esc(s.logo)}" alt="${esc(s.name)}">` : esc(s.name)
  }

  async function start() {
    try {
      const r = await fetch(api('catalogo'), { headers: { Accept: 'application/json' } })
      if (r.status === 404) { app.innerHTML = '<p class="empty wrap">Loja não encontrada. Confira o endereço.</p>'; return }
      if (!r.ok) throw new Error(String(r.status))
      data = await r.json()
      applyStore(data.store)
      loadBag(); renderBadge()
      render()
    } catch {
      app.innerHTML = '<p class="empty wrap">A loja não carregou agora. <button class="link" type="button" onclick="location.reload()">Tentar de novo</button></p>'
    }
  }
  start()
})()
