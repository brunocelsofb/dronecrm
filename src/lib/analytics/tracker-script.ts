// Script colado no site da empresa e usado pela vitrine: conta a visita, o tempo com a página
// visível e se a pessoa rolou/clicou. Sem cookies e sem guardar nada no navegador.
// Navegação sem recarregar (sites em React/Next): cada troca de endereço vira uma visita.
export function trackerScript(opts: { startUrl: string; endUrl: string; slugAttr: boolean }): string {
  return `(function(){
  if (window.__droneVisitas) return; window.__droneVisitas = 1;
  var s = document.currentScript, emp = ${opts.slugAttr ? "s && s.getAttribute('data-empresa')" : "''"};
  if (${opts.slugAttr ? '!emp' : 'false'}) return;
  if (navigator.webdriver) return;
  var START = ${JSON.stringify(opts.startUrl)}, END = ${JSON.stringify(opts.endUrl)};
  var id = null, shown = 0, since = null, acted = false, sent = false;
  function now(){ return Date.now(); }
  function visible(){ return document.visibilityState === 'visible'; }
  function tick(){ if (since !== null) { shown += now() - since; since = visible() ? now() : null; } else if (visible()) since = now(); }
  function report(){
    if (!id || sent) return; tick();
    var body = JSON.stringify({ id: id, d: shown, i: acted });
    try { if (navigator.sendBeacon && navigator.sendBeacon(END, new Blob([body], { type: 'text/plain' }))) return; } catch (e) {}
    try { fetch(END, { method: 'POST', body: body, keepalive: true, headers: { 'Content-Type': 'text/plain' } }); } catch (e) {}
  }
  function finish(){ report(); if (id) sent = true; }
  function start(){
    finish(); id = null; shown = 0; acted = false; sent = false; since = visible() ? now() : null;
    var body = JSON.stringify({ e: emp, u: location.href, r: document.referrer, t: document.title, w: window.innerWidth });
    fetch(START, { method: 'POST', body: body, headers: { 'Content-Type': 'text/plain' } })
      .then(function(r){ return r.json(); }).then(function(j){ if (j && j.id) id = j.id; }).catch(function(){});
  }
  function act(){ acted = true; }
  window.addEventListener('scroll', function(){ if (window.scrollY > 200) act(); }, { passive: true });
  window.addEventListener('click', act, true);
  window.addEventListener('keydown', act, true);
  // Saiu da aba (no celular pode ser o fim): manda o tempo até aqui; se voltar, atualiza depois
  document.addEventListener('visibilitychange', function(){ if (!visible()) report(); else tick(); });
  window.addEventListener('pagehide', finish);
  var push = history.pushState;
  history.pushState = function(){ var r = push.apply(this, arguments); setTimeout(start, 0); return r; };
  window.addEventListener('popstate', function(){ setTimeout(start, 0); });
  start();
})();`
}
