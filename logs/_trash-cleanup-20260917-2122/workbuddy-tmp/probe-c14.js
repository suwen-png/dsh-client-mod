(function(){
  var q = function(t){ return document.querySelector('[data-testid=' + t + ']'); };
  var sel = q('ds-doclist');
  var root = document.querySelector('[data-testid=dp-root]') || document.querySelector('#dp-root');
  return JSON.stringify({
    studioOpen: !!document.querySelector('[data-testid=ds-doclist],[data-testid=ds-docname]'),
    hasDoclist: !!sel,
    hasDocname: !!q('ds-docname'),
    hasRename: !!q('ds-rename'),
    hasNew: !!q('ds-new'),
    hasDelDoc: !!q('ds-del-doc'),
    hasMore: !!q('ds-more'),
    armed: q('ds-del-doc') ? q('ds-del-doc').getAttribute('data-armed') : 'NOEL',
    delDisabled: q('ds-del-doc') ? q('ds-del-doc').disabled : 'NOEL',
    docs: sel ? sel.options.length : -1,
    options: sel ? Array.prototype.map.call(sel.options, function(o){return o.textContent;}) : [],
    els: document.querySelectorAll('[data-testid=ds-el]').length,
    dpRoot: !!root,
    origin: performance.timeOrigin,
    w: window.innerWidth, h: window.innerHeight
  });
})()
