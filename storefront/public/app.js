// Vitrine do Varejo — lê o catálogo da loja no Drone (/api/catalogo, pelo domínio)
// e manda o pedido (/api/pedido). Nada da loja fica fixo aqui: nome, logo, cores,
// textos, ocasiões, peças, looks e WhatsApp vêm do Drone (Varejo → Vitrine).
(function () {
  'use strict'

  // ── Qual loja ───────────────────────────────────────────────────────────────
  const qs = new URLSearchParams(location.search)
  // Endereço de teste (?loja=). No endereço da Cloudflare (*.workers.dev), lembra a última loja aberta
  const testHost = /\.workers\.dev$/.test(location.hostname)
  let loja = (qs.get('loja') || '').toLowerCase().replace(/[^a-z0-9-]/g, '')
  if (testHost) {
    try {
      if (loja) localStorage.setItem('vitrine-loja', loja)
      else loja = (localStorage.getItem('vitrine-loja') || '').replace(/[^a-z0-9-]/g, '')
    } catch { /* sem armazenamento: segue sem lembrar */ }
    if (loja && !qs.get('loja')) history.replaceState(null, '', `${location.pathname}?loja=${loja}${location.hash}`)
  }
  const api = (path) => `/api/${path}${loja ? `?loja=${encodeURIComponent(loja)}` : ''}`

  // ── Utilidades ──────────────────────────────────────────────────────────────
  const $ = s => document.querySelector(s)
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const fmt = n => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const cents = n => Math.round(n * 100) / 100
  const digits = s => String(s || '').replace(/\D/g, '')
  const smooth = () => (matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth')
  const WA_SVG = $('.wa-float svg').innerHTML
  const MAX_QTY = 20
  const ONE_COLOR = 'Única'
  const ONE_SIZE = 'Único'

  // Bolinha de cor: pelo nome da cor (português); cor desconhecida fica neutra
  const COLOR_HEX = [
    [/preto|black|ônix|onix/, '#2B2522'], [/branc|off|marfim|perola|pérola|gelo/, '#F3EFE8'], [/areia|bege|nude|cáqui|caqui|camel|creme/, '#D9C7AC'],
    [/oliva|militar/, '#6B6B3A'], [/verde/, '#5E7F5A'], [/bord[oô]|vinho|marsala/, '#5E2430'], [/vermelh/, '#A8322D'], [/rosa|blush/, '#E7C4C0'],
    [/lil[aá]s|lavanda|roxo/, '#A898C4'], [/amarel|manteiga|mostarda/, '#F1DD9C'], [/laranja|terracota|ferrugem/, '#C46B3D'], [/marrom|caf[eé]|chocolate|tabaco/, '#6B4A33'],
    [/jeans claro/, '#A9C1D9'], [/jeans|denim/, '#5D7FA6'], [/marinho/, '#26344F'], [/azul/, '#8FA9C4'], [/cinza|grafite|chumbo/, '#8A8580'], [/dourad|ouro/, '#C9A45C'], [/prata/, '#C9C9C9'],
  ]
  const colorHex = name => { const n = String(name || '').toLowerCase(); return (COLOR_HEX.find(([re]) => re.test(n)) || [null, '#D8CFC4'])[1] }
  const isDark = hex => { const n = parseInt(hex.slice(1), 16); return ((n >> 16) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000 < 120 }

  // ── Dados (vêm do Drone) ────────────────────────────────────────────────────
  let STORE = null, PRODUCTS = [], OCCASIONS = [], LOOKS = [], CATS = [], WA = null
  const byId = id => PRODUCTS.find(p => p.id === id)
  const colorsOf = p => [...new Set(p.variants.map(v => v.color))]
  const sizesOf = (p, c) => p.variants.filter(v => v.color === c)
  const variantOf = (p, c, s) => p.variants.find(v => v.color === c && v.size === s)
  const occName = id => OCCASIONS.find(o => o.id === id)?.name || ''

  function adapt(d) {
    STORE = d.store
    WA = digits(STORE.whatsapp) || null
    PRODUCTS = d.products.map(p => ({
      ...p,
      seal: p.promo_price !== null && p.promo_price < p.price ? 'Promoção' : p.is_new ? 'Novidade' : '',
      variants: p.variants.map(v => ({ ...v, color: v.color || ONE_COLOR, size: v.size || ONE_SIZE })),
    }))
    LOOKS = d.looks.map(l => ({ ...l, items: l.product_ids.filter(byId) })).filter(l => l.items.length)
    // Ocasião aparece se tiver look ou peça
    OCCASIONS = (STORE.occasions || []).map(o => {
      const look = LOOKS.find(l => l.occasion === o.id)
      const prod = PRODUCTS.find(p => p.occasions.includes(o.id) && p.photos[0])
      return { ...o, photo: look?.cover || prod?.photos[0] || null }
    }).filter(o => LOOKS.some(l => l.occasion === o.id) || PRODUCTS.some(p => p.occasions.includes(o.id)))
    CATS = (d.categories || []).map(name => ({ name, photo: PRODUCTS.find(p => p.category === name && p.photos[0])?.photos[0] || null }))
      .filter(c => PRODUCTS.some(p => p.category === c.name))
  }

  // ── Fotos ───────────────────────────────────────────────────────────────────
  function phInner(photo, alt) { return photo ? `<img class="real" src="${esc(photo)}" alt="${esc(alt || '')}" loading="lazy">` : '' }
  function phBox(photo, tone, alt, extra = '') {
    const t = tone || '#E8E0D5'
    return `<div class="ph${!photo && isDark(t) ? ' dark' : ''}" style="${photo ? '' : `background:${t}`}">${phInner(photo, alt)}${extra}</div>`
  }
  const productPhoto = (p, color, i = 0, seal = true) =>
    phBox(p.photos[i] || p.photos[0] || null, colorHex(color), `${p.name}${color && color !== ONE_COLOR ? ` na cor ${color}` : ''}`, seal && p.seal ? `<span class="seal">${esc(p.seal)}</span>` : '')
  const priceLabel = p => (p.promo_price !== null && p.promo_price < p.price ? `<s>${fmt(p.price)}</s>${fmt(p.final_price)}` : fmt(p.final_price))

  // ── WhatsApp e avisos ───────────────────────────────────────────────────────
  function openWhatsApp(text) {
    if (!WA) { toast('A loja ainda não informou o WhatsApp.'); return }
    const n = WA.length <= 11 ? `55${WA}` : WA
    window.open(`https://wa.me/${n}?text=${encodeURIComponent(text)}`, '_blank', 'noopener')
  }
  function toast(text) { const t = $('#toast'); t.textContent = text; t.hidden = false; clearTimeout(t._t); t._t = setTimeout(() => { t.hidden = true }, 4000) }

  // ── Armazenamento neste aparelho (sacola, favoritos, vistos) ────────────────
  const key = k => `vitrine-${k}-${STORE ? STORE.slug : loja || location.hostname}`
  const load = k => { try { const v = JSON.parse(localStorage.getItem(key(k)) || '[]'); return Array.isArray(v) ? v : [] } catch { return [] } }
  const save = (k, v) => { try { localStorage.setItem(key(k), JSON.stringify(v)) } catch { /* sem armazenamento: só na memória */ } }
  let favs = [], seen = [], bag = []

  // ── Conteúdo fixo da loja ───────────────────────────────────────────────────
  function brandHtml() { return STORE.logo ? `<img src="${esc(STORE.logo)}" alt="${esc(STORE.name)}">` : `<span class="brand-txt">${esc(STORE.name)}</span>` }
  function renderStatic() {
    const s = STORE, c = s.content || {}
    document.title = s.name
    const meta = document.querySelector('meta[name="description"]'); if (meta && (c.hero_text || s.tagline)) meta.setAttribute('content', c.hero_text || s.tagline)
    const root = document.documentElement.style
    root.setProperty('--espresso', s.theme.primary)
    root.setProperty('--charcoal', `color-mix(in srgb, ${s.theme.primary} 78%, #000)`)
    root.setProperty('--gold', s.theme.accent)
    document.querySelectorAll('[data-brand]').forEach(el => { el.innerHTML = brandHtml() })

    $('#heroTitle').textContent = c.hero_title || s.tagline || s.name
    $('#heroText').textContent = c.hero_text || (c.hero_title ? s.tagline : '') || ''
    $('#heroText').hidden = !$('#heroText').textContent
    const hp = $('#heroPhoto')
    hp.style.background = s.hero ? '' : 'var(--sand)'
    hp.innerHTML = s.hero ? `<picture>${s.hero_mobile ? `<source media="(max-width: 859px)" srcset="${esc(s.hero_mobile)}">` : ''}<img class="real" src="${esc(s.hero)}" alt="" fetchpriority="high"></picture>` : ''
    if (!OCCASIONS.length) $('.hero .copy a[href="#ocasioes"]').outerHTML = '<a class="btn btn-primary" href="#novidades">Ver as peças</a>'

    // Destaque: só aparece com título
    const feat = $('#destaque')
    feat.hidden = !c.feature_title
    if (c.feature_title) {
      $('#featureTitle').textContent = c.feature_title
      $('#featureText').textContent = c.feature_text || ''
      const fp = c.feature_photo || PRODUCTS.find(p => p.category === c.feature_category && p.photos[0])?.photos[0] || s.hero
      $('#featurePhoto').outerHTML = phBox(fp, '#D8CFC4', c.feature_title).replace('<div class="ph', '<div id="featurePhoto" class="ph')
      $('#featureCta').onclick = () => goCat(c.feature_category && CATS.some(x => x.name === c.feature_category) ? c.feature_category : 'Todas')
    }

    // Sobre
    const paras = String(s.about || '').split(/\n+/).map(t => t.trim()).filter(Boolean)
    $('#sobre').hidden = !paras.length && !c.about_quote
    $('#aboutTitle').textContent = `Sobre a ${s.name}`
    $('#aboutQuote').textContent = c.about_quote || ''
    $('#aboutQuote').hidden = !c.about_quote
    $('#aboutText').innerHTML = paras.map(t => `<p>${esc(t)}</p>`).join('')

    // Contato e dúvidas
    $('#contactText').textContent = c.contact_text || 'Atendimento pelo WhatsApp. Ajudamos a escolher tamanho, cor e composição.'
    const ig = $('#igLink'); if (c.instagram) ig.href = c.instagram; ig.hidden = !c.instagram
    document.querySelectorAll('[data-wa-talk]').forEach(b => { b.hidden = !WA })
    $('#footCity').textContent = c.city || ''
    const faq = c.faq || []
    $('#faq').parentElement.hidden = !faq.length
    $('#faq').innerHTML = faq.map(f => `<details class="faq"><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('')

    // Políticas (rodapé): sem texto mostra "em breve"
    const pols = c.policies || []
    $('#footPolBox').hidden = !pols.length
    $('#footPolicies').innerHTML = pols.map((p, i) => `<li><button class="lnk" type="button" data-policy="${i}">${esc(p.title)}</button></li>`).join('')

    // Menus
    $('#ocasioes').hidden = !OCCASIONS.length
    $('#categorias').hidden = CATS.length < 2
    $('#looks').hidden = !LOOKS.length
    const nav = [OCCASIONS.length && ['Compre por ocasião', '#ocasioes'], ['Novidades', '#novidades'], LOOKS.length && ['Looks', '#looks'],
      !$('#sobre').hidden && [`Sobre a ${s.name}`, '#sobre'], ['Como comprar', '#como-comprar'], ['Contato', '#contato']].filter(Boolean)
    $('#footNav').innerHTML = nav.map(([t, h]) => `<li><a href="${h}">${esc(t)}</a></li>`).join('') + (c.instagram ? `<li><a href="${esc(c.instagram)}" target="_blank" rel="noopener noreferrer">Instagram</a></li>` : '')
    const top = [OCCASIONS.length && ['Ocasiões', '#ocasioes'], ['Novidades', '#novidades'], ...CATS.slice(0, 5).map(x => [x.name, '#novidades', x.name]), LOOKS.length && ['Looks', '#looks']].filter(Boolean)
    $('#menuLinks').innerHTML = top.map(([t, h, cat]) => cat ? `<button type="button" data-goto-cat="${esc(cat)}">${esc(t)}</button>` : `<a href="${h}">${esc(t)}</a>`).join('')
    const mob = [OCCASIONS.length && ['Compre por ocasião', '#ocasioes'], ['Novidades', '#novidades'], ...CATS.map(x => [x.name, '#novidades', x.name]), LOOKS.length && ['Looks por ocasião', '#looks'],
      !$('#sobre').hidden && [`Sobre a ${s.name}`, '#sobre'], ['Contato', '#contato']].filter(Boolean)
    $('#mobileNav').innerHTML = mob.map(([t, h, cat]) => cat ? `<button type="button" data-goto-cat="${esc(cat)}">${esc(t)}</button>` : `<a href="${h}" data-close-nav>${esc(t)}</a>`).join('')
  }

  function renderCats() {
    $('#cats').style.setProperty('--n', CATS.length)
    $('#cats').innerHTML = CATS.map(c => {
      const n = PRODUCTS.filter(p => p.category === c.name).length
      return `<button class="cat" type="button" data-goto-cat="${esc(c.name)}">${phBox(c.photo, '#D8CFC4', c.name)}<span>${esc(c.name)}</span><small>${n} peça${n > 1 ? 's' : ''}</small></button>`
    }).join('')
  }

  // ── Vitrine de peças ────────────────────────────────────────────────────────
  let cat = 'Todas'
  function renderChips() {
    $('#chips').hidden = CATS.length < 2
    $('#chips').innerHTML = ['Todas', ...CATS.map(c => c.name)].map(c => `<button class="chip" type="button" aria-pressed="${c === cat}" data-cat="${esc(c)}">${esc(c)}</button>`).join('')
  }
  function renderGrid() {
    const q = $('#q').value.trim().toLowerCase()
    $('#gridTitle').textContent = cat === 'Todas' ? (PRODUCTS.some(p => p.is_new) ? 'Novidades' : 'Peças') : cat
    const list = PRODUCTS.filter(p => (cat === 'Todas' || p.category === cat) && (!q || p.name.toLowerCase().includes(q)))
    $('#grid').innerHTML = list.length ? list.map(cardHtml).join('') : `<p class="empty">${PRODUCTS.length ? 'Nenhuma peça encontrada. Tente outra busca ou fale com o atendimento.' : 'As peças estão chegando. Fale com o atendimento pelo WhatsApp.'}</p>`
  }
  function favBtn(id) {
    const on = favs.includes(id)
    return `<button class="fav" type="button" data-fav="${esc(id)}" aria-pressed="${on}" aria-label="${on ? 'Tirar dos favoritos' : 'Salvar nos favoritos'}"><svg viewBox="0 0 24 24"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z"/></svg></button>`
  }
  function cardHtml(p) {
    const cs = colorsOf(p)
    const dots = cs.length > 1 || cs[0] !== ONE_COLOR ? `<span class="dots" aria-label="${cs.length} cor(es)">${cs.map(c => `<span class="dot" style="background:${colorHex(c)}" title="${esc(c)}"></span>`).join('')}</span>` : ''
    return `<article class="card">${favBtn(p.id)}<button class="open" type="button" data-open="${esc(p.id)}" aria-label="Ver detalhes de ${esc(p.name)}">
      ${productPhoto(p, cs[0])}<span><span class="name">${esc(p.name)}</span><br><span class="price">${priceLabel(p)}</span></span>${dots}</button></article>`
  }
  function miniHtml(p) { return `<button class="mini" type="button" data-open="${esc(p.id)}">${productPhoto(p, colorsOf(p)[0], 0, false)}<span><b>${esc(p.name)}</b><br>${priceLabel(p)}</span></button>` }
  function goCat(c) { cat = c; renderChips(); renderGrid(); closeSheets(); document.getElementById('novidades').scrollIntoView({ behavior: smooth() }) }

  // ── Ocasiões e looks ────────────────────────────────────────────────────────
  let occ = 'Todas'
  function renderOccCards() {
    $('#occCards').style.setProperty('--n', OCCASIONS.length)
    $('#occCards').innerHTML = OCCASIONS.map(o => {
      const n = LOOKS.filter(l => l.occasion === o.id).length
      const tail = n ? `${n} look${n === 1 ? '' : 's'}.` : ''
      return `<button class="cat" type="button" data-goto-occ="${esc(o.id)}">${phBox(o.photo, '#D8CFC4', o.name)}<span>${esc(o.name)}</span><small>${esc(o.text || '')} ${tail}</small></button>`
    }).join('')
  }
  function renderLooks() {
    const withLooks = OCCASIONS.filter(o => LOOKS.some(l => l.occasion === o.id))
    $('#occChips').hidden = withLooks.length < 2
    $('#occChips').innerHTML = [['Todas', 'Todas'], ...withLooks.map(o => [o.id, o.name])].map(([id, n]) => `<button class="chip" type="button" aria-pressed="${id === occ}" data-occ="${esc(id)}">${esc(n)}</button>`).join('')
    $('#looksTitle').textContent = occ === 'Todas' ? 'Looks por ocasião' : `Looks · ${occName(occ)}`
    const list = LOOKS.filter(l => occ === 'Todas' || l.occasion === occ)
    $('#lookList').innerHTML = list.length ? list.map(l => {
      const ps = l.items.map(byId)
      const total = cents(ps.reduce((t, p) => t + p.final_price, 0))
      return `<article class="look">
      ${phBox(l.cover, '#D8CFC4', l.name)}
      ${l.occasion ? `<div class="tag">${esc(occName(l.occasion))}</div>` : ''}
      <h3 style="margin-top:4px">${esc(l.name)}</h3>${l.description ? `<p>${esc(l.description)}</p>` : ''}
      <ul>${ps.map(p => `<li><button type="button" data-open="${esc(p.id)}">${esc(p.name)} · ${fmt(p.final_price)}</button></li>`).join('')}</ul>
      <div class="acts">${ps.length > 1 ? `<button class="btn btn-primary" type="button" data-look="${esc(l.id)}">Quero o look inteiro · ${fmt(total)}</button>` : `<button class="btn btn-primary" type="button" data-open="${esc(ps[0].id)}">Ver a peça</button>`}</div>
    </article>`
    }).join('') : '<p class="empty">Ainda não há looks para esta ocasião. Veja as peças abaixo.</p>'
    const more = $('#occMore')
    if (occ === 'Todas') { more.hidden = true; return }
    const ps = PRODUCTS.filter(p => p.occasions.includes(occ))
    more.hidden = !ps.length
    $('#occMoreTitle').textContent = `Todas as peças · ${occName(occ)}`
    $('#occGrid').innerHTML = ps.map(cardHtml).join('')
  }
  function goOcc(id) {
    occ = id; renderLooks(); closeSheets()
    const target = LOOKS.length ? 'looks' : 'novidades'
    document.getElementById(target).scrollIntoView({ behavior: smooth() })
  }

  // Look inteiro: escolhe cor e tamanho de cada peça e põe tudo na sacola
  let lk = null
  const firstColor = p => { const ok = colorsOf(p).filter(c => sizesOf(p, c).some(v => v.available)); return ok[0] || colorsOf(p)[0] }
  const onlySize = (p, c) => { const s = sizesOf(p, c).filter(v => v.available); return s.length === 1 ? s[0].size : null }
  function openLook(id) {
    const l = LOOKS.find(x => x.id === id); if (!l) return
    lk = { l, sel: {} }
    l.items.map(byId).forEach(p => { const color = firstColor(p); lk.sel[p.id] = { color, size: onlySize(p, color) } })
    renderLook(); openSheet('#lookSheet')
  }
  function renderLook() {
    const { l, sel } = lk
    $('#lkTitle').textContent = l.name
    const ps = l.items.map(byId)
    $('#lkBody').innerHTML = '<p class="note" style="margin:0 0 4px">Escolha a cor e o seu tamanho em cada peça.</p>' + ps.map(p => {
      const s = sel[p.id], cs = colorsOf(p)
      return `<div class="lk-item">${productPhoto(p, s.color, 0, false)}<div><div class="t">${esc(p.name)}</div><div class="v">${fmt(p.final_price)}</div>
        ${cs.length > 1 || cs[0] !== ONE_COLOR ? `<div class="opt-label">Cor <em>${esc(s.color)}</em></div>
        <div class="swatches">${cs.map(c => `<button class="swatch" type="button" role="radio" aria-checked="${c === s.color}" aria-label="${esc(c)}" data-lk="${esc(p.id)}" data-lk-color="${esc(c)}" style="background:${colorHex(c)}"></button>`).join('')}</div>` : ''}
        <div class="opt-label">Tamanho <em>${s.size ? esc(s.size) : 'escolha'}</em></div>
        <div class="sizes">${sizesOf(p, s.color).map(v => `<button class="size ${v.available ? '' : 'out'}" type="button" role="radio" aria-checked="${v.size === s.size}" data-lk="${esc(p.id)}" data-lk-size="${esc(v.size)}" ${v.available ? '' : 'aria-disabled="true"'}>${esc(v.size)}</button>`).join('')}</div></div></div>`
    }).join('')
    const missing = ps.filter(p => !sel[p.id].size)
    const total = cents(ps.reduce((t, p) => t + p.final_price, 0))
    const btn = $('#lkAdd')
    btn.disabled = missing.length > 0
    btn.textContent = missing.length ? `Escolha o tamanho de ${missing.length === 1 ? missing[0].name : `${missing.length} peças`}` : `Adicionar o look à sacola · ${fmt(total)}`
    $('#lkNote').textContent = ''
  }
  $('#lkBody').addEventListener('click', e => {
    const t = e.target.closest('button[data-lk]'); if (!t || !lk) return
    const p = byId(t.dataset.lk), s = lk.sel[t.dataset.lk]
    if (t.dataset.lkColor) { s.color = t.dataset.lkColor; s.size = onlySize(p, s.color) }
    else if (t.dataset.lkSize) { if (t.getAttribute('aria-disabled')) { toast('Esse tamanho acabou nesta cor. Fale com a loja pelo WhatsApp.'); return } s.size = t.dataset.lkSize }
    renderLook()
  })
  $('#lkAdd').addEventListener('click', () => {
    if (!lk) return
    lk.l.items.map(byId).forEach(p => { const { color, size } = lk.sel[p.id]; const v = size && variantOf(p, color, size); if (v && v.available) addToBag(v.id, 1) })
    closeSheets(); openBag()
  })

  // Peças que combinam: as outras peças dos looks em que esta aparece
  function matchesFor(ids, exclude = ids) {
    const out = []
    LOOKS.filter(l => l.items.some(c => ids.includes(c))).forEach(l => l.items.forEach(c => { if (!exclude.includes(c) && !out.includes(c)) out.push(c) }))
    return out.map(byId).filter(Boolean)
  }

  // ── Favoritos e vistos recentemente ─────────────────────────────────────────
  function toggleFav(id) {
    const on = favs.includes(id)
    favs = on ? favs.filter(c => c !== id) : [id, ...favs]
    save('favs', favs); renderFavCount()
    document.querySelectorAll(`[data-fav="${CSS.escape(id)}"]`).forEach(b => {
      b.setAttribute('aria-pressed', String(!on)); b.setAttribute('aria-label', !on ? 'Tirar dos favoritos' : 'Salvar nos favoritos')
      if (b.classList.contains('pd-fav')) b.lastChild.textContent = !on ? ' Salva nos favoritos' : ' Salvar nos favoritos'
    })
    toast(on ? 'Removida dos favoritos.' : 'Salva nos favoritos. Veja no coração lá em cima.')
    if ($('#favSheet').classList.contains('on')) renderFavs()
  }
  function renderFavCount() { const b = $('#favCount'); b.textContent = favs.length; b.hidden = !favs.length }
  function renderFavs() {
    $('#favBody').innerHTML = favs.length
      ? `<div class="grid" style="grid-template-columns:repeat(2,minmax(0,1fr))">${favs.map(byId).filter(Boolean).map(cardHtml).join('')}</div>`
      : '<p class="empty">Nenhum favorito ainda.<br>Toque no coração de uma peça para guardar aqui.</p>'
  }
  function markSeen(id) { seen = [id, ...seen.filter(c => c !== id)].slice(0, 10); save('seen', seen); renderSeen() }
  function renderSeen() {
    const list = seen.map(byId).filter(Boolean)
    $('#seenBox').hidden = list.length < 2
    $('#seenRow').innerHTML = list.map(miniHtml).join('')
  }

  // ── Peça ────────────────────────────────────────────────────────────────────
  let cur = null
  function openProduct(id) {
    const p = byId(id); if (!p) return
    const c = firstColor(p)
    cur = { p, color: c, size: onlySize(p, c) || sizesOf(p, c).find(v => v.available)?.size || null, qty: 1, photo: 0 }
    renderProduct(); openSheet('#productSheet'); markSeen(id)
  }
  function renderProduct() {
    const { p, color, size, qty } = cur
    const v = size ? variantOf(p, color, size) : null
    const cs = colorsOf(p)
    $('#pdTitle').textContent = p.name
    const thumbs = p.photos.length > 1 ? `<div class="mini-row" style="grid-auto-columns:64px;margin-top:10px">${p.photos.map((ph, i) => `<button class="mini" type="button" data-photo="${i}" aria-label="Foto ${i + 1}" style="${i === cur.photo ? 'outline:1.5px solid var(--espresso);outline-offset:2px;border-radius:3px' : ''}">${phBox(ph, '#E8E0D5', '')}</button>`).join('')}</div>` : ''
    const spec = [['Composição', p.composition], ['Cuidados', p.care], ['Código', p.code]].filter(([, x]) => x)
    $('#pdBody').innerHTML = `<div class="pd"><div>${productPhoto(p, color, cur.photo)}${thumbs}</div>
      <div><h3>${esc(p.name)}</h3><p class="price">${priceLabel(p)}</p>${p.description ? `<p class="desc">${esc(p.description)}</p>` : ''}
        ${cs.length > 1 || cs[0] !== ONE_COLOR ? `<div class="opt-label">Cor <em>${esc(color)}</em></div>
        <div class="swatches" role="radiogroup" aria-label="Cor">${cs.map(c => `<button class="swatch" type="button" role="radio" aria-checked="${c === color}" aria-label="${esc(c)}" data-color="${esc(c)}" style="background:${colorHex(c)}"></button>`).join('')}</div>` : ''}
        <div class="opt-label">Tamanho <em>${size ? esc(size) : 'escolha'}</em></div>
        <div class="sizes" role="radiogroup" aria-label="Tamanho">${sizesOf(p, color).map(x => `<button class="size ${x.available ? '' : 'out'}" type="button" role="radio" aria-checked="${x.size === size}" data-size="${esc(x.size)}" aria-label="${esc(x.size)}${x.available ? '' : ', esgotado'}">${esc(x.size)}</button>`).join('')}</div>
        <div class="avail ${v && v.last_units ? 'low' : ''}">${!v ? '' : !v.available ? 'Esgotado neste tamanho. Pergunte no WhatsApp quando chega.' : v.last_units ? 'Últimas unidades nesta cor e tamanho.' : 'Disponível.'}</div>
        ${v && v.available ? `<div class="opt-label">Quantidade</div>
        <div class="qty"><button type="button" data-q="-1" aria-label="Diminuir">−</button><output aria-live="polite">${qty}</output><button type="button" data-q="1" aria-label="Aumentar">+</button></div>` : ''}
        <button class="pd-fav" type="button" data-fav="${esc(p.id)}" aria-pressed="${favs.includes(p.id)}"><svg viewBox="0 0 24 24"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z"/></svg> ${favs.includes(p.id) ? 'Salva nos favoritos' : 'Salvar nos favoritos'}</button>
        ${spec.length ? `<dl class="spec">${spec.map(([t, x]) => `<dt>${t}</dt><dd>${esc(x)}</dd>`).join('')}</dl>` : ''}
        <details class="faq" style="padding:14px 0"><summary>Guia de medidas</summary>${p.measures ? `<p style="white-space:pre-line">${esc(p.measures)}</p>` : ''}<p>Em dúvida entre dois tamanhos? O atendimento ajuda pelo caimento que você prefere.</p></details>
      </div></div>
      ${(() => {
        const m = matchesFor([p.id]); const look = LOOKS.find(l => l.items.length > 1 && l.items.includes(p.id))
        return m.length ? `<h3 class="row-title">Complete o look ${look ? `<button class="text-link" type="button" data-look="${esc(look.id)}">Ver o look inteiro</button>` : ''}</h3><div class="mini-row">${m.map(miniHtml).join('')}</div>` : ''
      })()}`
    const add = $('#addBtn')
    add.disabled = !v || !v.available
    add.textContent = !size ? 'Escolha o tamanho' : v && v.available ? `Adicionar à sacola · ${fmt(p.final_price * qty)}` : 'Esgotado neste tamanho'
    $('#askBtn').hidden = !WA
  }
  $('#pdBody').addEventListener('click', e => {
    const t = e.target.closest('button'); if (!t || !cur) return
    if (t.dataset.photo !== undefined) { cur.photo = Number(t.dataset.photo) }
    else if (t.dataset.color) { cur.color = t.dataset.color; cur.size = onlySize(cur.p, cur.color) || sizesOf(cur.p, cur.color).find(v => v.available)?.size || null; cur.qty = 1 }
    else if (t.dataset.size) { cur.size = t.dataset.size; cur.qty = 1 }
    else if (t.dataset.q) { cur.qty = Math.min(Math.max(1, cur.qty + Number(t.dataset.q)), MAX_QTY) }
    else return
    renderProduct()
  })
  $('#addBtn').addEventListener('click', () => {
    const { p, color, size, qty } = cur; const v = size && variantOf(p, color, size); if (!v || !v.available) return
    addToBag(v.id, qty); closeSheets(); openBag()
  })
  $('#askBtn').addEventListener('click', () => {
    const { p, color, size } = cur
    openWhatsApp(`Olá! Tenho interesse na peça ${p.name} (código ${p.code})${color !== ONE_COLOR ? `, cor ${color}` : ''}${size && size !== ONE_SIZE ? `, tamanho ${size}` : ''}. Pode me ajudar?`)
  })

  // ── Sacola e pedido ─────────────────────────────────────────────────────────
  function findVariant(id) { for (const p of PRODUCTS) { const v = p.variants.find(x => x.id === id); if (v) return { p, v } } return null }
  function addToBag(id, qty) {
    const hit = bag.find(i => i.variant_id === id)
    if (hit) hit.qty = Math.min(MAX_QTY, hit.qty + qty); else bag.push({ variant_id: id, qty: Math.min(MAX_QTY, qty) })
    saveBag()
  }
  function saveBag() { save('sacola', bag); renderCount() }
  function renderCount() { const n = bag.reduce((t, i) => t + i.qty, 0); const b = $('#bagCount'); b.textContent = n; b.hidden = !n; $('#stickyBag').textContent = n ? `Sacola (${n})` : 'Sacola' }
  const lines = () => bag.map(i => ({ ...i, ...(findVariant(i.variant_id) || {}) })).filter(l => l.p).map(l => ({ ...l, total: cents(l.p.final_price * l.qty) }))
  const subtotal = () => cents(lines().reduce((t, l) => t + l.total, 0))
  const variantText = v => [v.color !== ONE_COLOR && v.color, v.size !== ONE_SIZE && v.size].filter(Boolean).join(' · ')
  let step = 'bag', done = null
  function openBag() { renderBag(); openSheet('#bagSheet') }
  function renderBag() {
    const body = $('#bagBody'), foot = $('#bagFoot')
    if (step === 'done') {
      $('#bagTitle').textContent = 'Pedido enviado'
      body.innerHTML = `<div class="done"><div class="mark" aria-hidden="true">✓</div><h3>Pedido nº ${esc(done.number)} enviado</h3>
        <p>${done.whatsapp_url ? 'Agora chame a loja no WhatsApp: a mensagem já vai pronta com as suas peças. O atendimento confirma o frete e manda o link para pagar.' : 'A loja vai falar com você pelo WhatsApp para confirmar o frete e o pagamento.'}</p></div>`
      foot.innerHTML = (done.whatsapp_url ? `<a class="btn btn-wa btn-block" href="${esc(done.whatsapp_url)}" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" aria-hidden="true">${WA_SVG}</svg>Abrir o WhatsApp da loja</a>` : '') +
        (done.tracking_url ? `<a class="btn btn-line btn-block" href="${esc(done.tracking_url)}" target="_blank" rel="noopener">Acompanhar meu pedido</a>` : '') +
        '<button class="btn btn-line btn-block" type="button" data-close>Continuar olhando</button>'
      return
    }
    if (!lines().length) {
      $('#bagTitle').textContent = 'Sacola'
      body.innerHTML = '<p class="empty">Sua sacola está vazia.<br>Escolha uma peça para começar.</p>'
      foot.innerHTML = '<a class="btn btn-primary btn-block" href="#novidades" data-close>Ver as peças</a>'
      return
    }
    if (step === 'bag') {
      $('#bagTitle').textContent = 'Sacola'
      body.innerHTML = lines().map(l => `<div class="line">${productPhoto(l.p, l.v.color, 0, false)}
          <div><div class="t">${esc(l.p.name)}</div><div class="v">${esc([variantText(l.v), fmt(l.p.final_price)].filter(Boolean).join(' · '))}</div>
            ${l.v.available ? '' : '<div class="v" style="color:#8e3b2c">Esgotou. Remova para continuar.</div>'}
            <div class="ctrl"><div class="qty"><button type="button" data-l="${esc(l.variant_id)}" data-d="-1" aria-label="Diminuir">−</button><output>${l.qty}</output><button type="button" data-l="${esc(l.variant_id)}" data-d="1" aria-label="Aumentar">+</button></div><button class="link" type="button" data-rm="${esc(l.variant_id)}">Remover</button></div></div>
          <div>${fmt(l.total)}</div></div>`).join('') +
        `<div class="sum" style="margin-top:16px"><div><span>Subtotal</span><span>${fmt(subtotal())}</span></div><div><span>Frete</span><span>a calcular</span></div></div>
         <p class="note">Frete e forma de pagamento são confirmados pelo atendimento no WhatsApp.</p>` +
        (() => { const ids = [...new Set(lines().map(l => l.p.id))]; const m = matchesFor(ids, ids); return m.length ? `<h3 class="row-title">Combina com o que você escolheu</h3><div class="mini-row">${m.map(miniHtml).join('')}</div>` : '' })()
      const blocked = lines().some(l => !l.v.available)
      foot.innerHTML = `<button class="btn btn-primary btn-block" type="button" id="toCheckout" ${blocked ? 'disabled' : ''}>Continuar</button>`
      $('#toCheckout').onclick = () => { step = 'checkout'; renderBag(); body.scrollTop = 0 }
      return
    }
    const local = STORE.content?.local_delivery
    $('#bagTitle').textContent = 'Finalizar'
    body.innerHTML = `<form id="co" novalidate>
      <div class="field"><label for="fName">Nome</label><input id="fName" name="name" autocomplete="name"><span class="err" id="eName"></span></div>
      <div class="field"><label for="fPhone">WhatsApp</label><input id="fPhone" name="phone" inputmode="tel" autocomplete="tel" placeholder="(DDD) 99999-9999"><span class="err" id="ePhone"></span></div>
      <div class="field"><label for="fEmail">E-mail</label><input id="fEmail" name="email" type="email" inputmode="email" autocomplete="email" placeholder="voce@exemplo.com"><span class="err" id="eEmail"></span></div>
      <div class="field"><label for="fBirth">Aniversário <span style="font-weight:400;color:var(--muted)">(opcional, para um mimo no seu dia)</span></label><input id="fBirth" name="birth" type="date" autocomplete="bday"></div>
      ${local ? `<fieldset class="field"><legend>Entrega</legend><div class="radios">
        <label class="radio"><input type="radio" name="ship" value="Retirada em ${esc(local)}" checked><span>Retirada em ${esc(local)}<small>Local combinado com o atendimento</small></span></label>
        <label class="radio"><input type="radio" name="ship" value="Entrega em ${esc(local)}"><span>Entrega em ${esc(local)}<small>Valor combinado no atendimento</small></span></label>
        <label class="radio"><input type="radio" name="ship" value="Envio para outra cidade" data-cep><span>Envio para outra cidade<small>Frete calculado pelo CEP</small></span></label>
      </div></fieldset>` : '<input type="hidden" name="ship" value="Envio pelo CEP">'}
      <div class="field" id="cepField" ${local ? 'hidden' : ''}><label for="fCep">CEP</label><input id="fCep" name="cep" inputmode="numeric" autocomplete="postal-code" placeholder="00000-000"><span class="err" id="eCep"></span></div>
      <fieldset class="field"><legend>Como prefere pagar</legend><div class="radios">
        <label class="radio"><input type="radio" name="pay" value="Pix" checked><span>Pix</span></label>
        <label class="radio"><input type="radio" name="pay" value="Cartão"><span>Cartão<small>Parcelamento informado pelo atendimento</small></span></label>
      </div></fieldset>
      <div class="field"><label for="fNote">Observação (opcional)</label><textarea id="fNote" name="note" maxlength="300"></textarea></div>
      <div class="hp" aria-hidden="true"><label>Não preencha <input name="website" tabindex="-1" autocomplete="off"></label></div>
      <label class="check"><input type="checkbox" name="optin"> Quero receber novidades e lançamentos da ${esc(STORE.name)} pelo WhatsApp.</label>
      <div class="sum"><div><span>Subtotal</span><span>${fmt(subtotal())}</span></div><div><span>Frete</span><span>a calcular</span></div><div class="total"><span>Total das peças</span><span>${fmt(subtotal())}</span></div></div>
      <p class="note">Seus dados vão só para a loja, para atender este pedido e avisar cada etapa.</p>
    </form>`
    foot.innerHTML = `<p class="form-err" id="coErr" hidden></p><button class="btn btn-wa btn-block" type="button" id="send"><svg viewBox="0 0 24 24" aria-hidden="true">${WA_SVG}</svg>Enviar pedido</button><button class="link" type="button" id="backBag" style="justify-self:center">Voltar para a sacola</button>`
    const form = $('#co')
    const needCep = () => !local || !!form.querySelector('input[name=ship]:checked')?.hasAttribute('data-cep')
    form.addEventListener('change', () => { $('#cepField').hidden = !needCep() })
    form.addEventListener('input', e => { const er = e.target.parentElement?.querySelector('.err'); if (er) er.textContent = '' })
    $('#backBag').onclick = () => { step = 'bag'; renderBag() }
    $('#send').onclick = () => submitOrder(form, needCep())
  }
  $('#bagBody').addEventListener('click', e => {
    const t = e.target.closest('button'); if (!t) return
    if (t.dataset.rm !== undefined) bag = bag.filter(i => i.variant_id !== t.dataset.rm)
    else if (t.dataset.l !== undefined) { const l = bag.find(i => i.variant_id === t.dataset.l); if (l) l.qty = Math.min(Math.max(1, l.qty + Number(t.dataset.d)), MAX_QTY) }
    else return
    saveBag(); renderBag()
  })
  async function submitOrder(form, needCep) {
    const name = form.name.value.trim(), phone = digits(form.phone.value), cep = digits(form.cep.value), email = form.email.value.trim()
    const ship = form.querySelector('input[name=ship]:checked, input[type=hidden][name=ship]')?.value || ''
    const errs = {
      eName: name.length < 2 ? 'Informe seu nome.' : '',
      ePhone: phone.length < 10 || phone.length > 13 ? 'Informe o WhatsApp com DDD.' : '',
      eEmail: !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? 'Informe um e-mail válido.' : '',
      eCep: needCep && cep.length !== 8 ? 'Informe o CEP com 8 números.' : '',
    }
    Object.entries(errs).forEach(([id, m]) => { $('#' + id).textContent = m })
    const first = Object.entries(errs).find(([, m]) => m); if (first) { $('#' + first[0]).previousElementSibling?.focus(); return }
    const note = [`Entrega: ${ship}`, `Pagamento desejado: ${form.pay.value}`, form.note.value.trim() && `Observação: ${form.note.value.trim()}`].filter(Boolean).join('\n')
    const payload = {
      customer: { name, phone, email, cep: needCep ? cep : null, optin: form.optin.checked, birth_date: form.birth.value || null },
      items: bag.map(i => ({ variant_id: i.variant_id, qty: i.qty })),
      note, website: form.website.value,
    }
    const send = $('#send'), err = $('#coErr')
    err.hidden = true; send.disabled = true; send.lastChild.textContent = 'Enviando…'
    try {
      const r = await fetch(api('pedido'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const out = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(out.error || 'Não foi possível enviar agora. Tente de novo.')
      done = out; bag = []; saveBag(); step = 'done'; renderBag(); $('#bagBody').scrollTop = 0
    } catch (e) {
      err.textContent = e instanceof TypeError ? 'Sem conexão. Confira a internet e tente de novo.' : e.message
      err.hidden = false; send.disabled = false; send.lastChild.textContent = 'Enviar pedido'
    }
  }

  function openPolicy(i) {
    const p = (STORE.content?.policies || [])[i]; if (!p) return
    $('#polTitle').textContent = p.title
    $('#polBody').innerHTML = p.text
      ? String(p.text).split(/\n+/).map(t => `<p style="margin:0 0 12px;color:var(--muted)">${esc(t)}</p>`).join('')
      : `<p style="color:var(--muted)">Em breve publicaremos esta política aqui.${WA ? ' Enquanto isso, fale com o atendimento pelo WhatsApp.' : ''}</p>${WA ? `<button class="btn btn-wa btn-block" type="button" data-wa-talk><svg viewBox="0 0 24 24" aria-hidden="true">${WA_SVG}</svg>Falar no WhatsApp</button>` : ''}`
    openSheet('#policySheet')
  }

  // ── Gavetas e eventos ───────────────────────────────────────────────────────
  let lastFocus = null
  function openSheet(sel) {
    lastFocus = document.activeElement
    document.querySelectorAll('.sheet.on').forEach(s => s.classList.remove('on'))
    const s = $(sel); s.classList.add('on'); $('#scrim').classList.add('on'); document.body.style.overflow = 'hidden'
    setTimeout(() => s.querySelector('[data-close]')?.focus(), 50)
  }
  function closeSheets() {
    document.querySelectorAll('.sheet.on').forEach(s => s.classList.remove('on'))
    $('#scrim').classList.remove('on'); document.body.style.overflow = ''
    if (step === 'done') step = 'bag'
    lastFocus?.focus?.()
  }
  document.addEventListener('click', e => {
    if (!STORE) return
    if (e.target.closest('[data-close]') || e.target.id === 'scrim' || e.target.closest('[data-close-nav]')) closeSheets()
    const pol = e.target.closest('[data-policy]'); if (pol) { openPolicy(Number(pol.dataset.policy)); return }
    const fav = e.target.closest('[data-fav]'); if (fav) { toggleFav(fav.dataset.fav); return }
    const look = e.target.closest('[data-look]'); if (look) { openLook(look.dataset.look); return }
    const go = e.target.closest('[data-goto-occ]'); if (go) { goOcc(go.dataset.gotoOcc); return }
    const oc = e.target.closest('[data-occ]'); if (oc) { occ = oc.dataset.occ; renderLooks(); return }
    const open = e.target.closest('[data-open]'); if (open) { openProduct(open.dataset.open); return }
    const gc = e.target.closest('[data-goto-cat]'); if (gc) { goCat(gc.dataset.gotoCat); return }
    const chip = e.target.closest('[data-cat]'); if (chip) { cat = chip.dataset.cat; renderChips(); renderGrid() }
    if (e.target.closest('[data-wa-talk]')) openWhatsApp(`Olá! Vim pela vitrine da ${STORE.name} e gostaria de ajuda.`)
  })
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheets() })
  $('#openBag').onclick = () => STORE && openBag()
  $('#stickyBag').onclick = () => STORE && openBag()
  $('#openMenu').onclick = () => STORE && openSheet('#menuSheet')
  $('#openFavs').onclick = () => { if (STORE) { renderFavs(); openSheet('#favSheet') } }
  $('#openSearch').onclick = () => { if (!STORE) return; $('#searchBar').classList.add('on'); document.getElementById('novidades').scrollIntoView({ behavior: smooth() }); setTimeout(() => $('#q').focus(), 350) }
  $('#q').addEventListener('input', renderGrid)

  // ── Início ──────────────────────────────────────────────────────────────────
  function showState(html) { $('#state').innerHTML = `<p>${html}</p>` }
  async function start() {
    try {
      const r = await fetch(api('catalogo'), { headers: { Accept: 'application/json' } })
      if (r.status === 404) {
        showState(testHost && !loja
          ? 'Falta o nome da loja no link. Use o <b>link de teste</b> que aparece no Drone em Varejo → Vitrine (termina com <code>?loja=nome-da-loja</code>).'
          : `Loja não encontrada${loja ? ` (“${esc(loja)}”)` : ''}. Confira se a vitrine está <b>No ar</b> e salva em Varejo → Vitrine e se o endereço está certo.`)
        return
      }
      if (!r.ok) throw new Error(String(r.status))
      adapt(await r.json())
      const valid = new Set(PRODUCTS.map(p => p.id))
      favs = load('favs').filter(id => valid.has(id))
      seen = load('seen').filter(id => valid.has(id))
      bag = load('sacola').filter(i => i && findVariant(i.variant_id) && i.qty > 0)
      renderStatic(); renderOccCards(); renderCats(); renderChips(); renderGrid(); renderLooks(); renderCount(); renderFavCount(); renderSeen()
      $('#state').hidden = true
      ;['#inicio', '#foot', '#stickyBar'].forEach(s => { $(s).hidden = false })
      $('#waFloat').hidden = !WA
      if (location.hash) document.querySelector(location.hash)?.scrollIntoView()
    } catch (e) {
      console.error(e)
      showState('A loja não carregou agora. <button class="text-link" type="button" onclick="location.reload()">Tentar de novo</button>')
    }
  }
  start()
})()
