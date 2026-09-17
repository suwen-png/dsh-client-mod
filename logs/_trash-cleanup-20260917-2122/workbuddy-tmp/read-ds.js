(function(){
  var p = document.querySelector('[data-testid=ds-logic]');
  var s = document.querySelector('[data-testid=ds-zoom]');
  var out = document.querySelector('[data-testid=ds-outline]');
  return JSON.stringify({
    sel: p ? p.getAttribute('data-el-id') : null,
    logicCount: document.querySelectorAll('[data-testid=ds-logic]').length,
    els: document.querySelectorAll('[data-testid=ds-el]').length,
    ghosts: document.querySelectorAll('[data-testid=ds-ghost]').length,
    oline: document.querySelectorAll('[data-testid=ds-oline]').length,
    focus: out ? out.getAttribute('data-focus') : null,
    scale: s ? s.textContent : null,
    docs: document.querySelectorAll('[data-testid=ds-doclist] option').length
  });
})()
