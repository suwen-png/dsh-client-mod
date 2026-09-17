(async function(){
  var sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
  var out = {};
  // 开：走用户真实入口
  var before = Boolean(document.querySelector('[data-testid=ds-root]'));
  if (!before) {
    var b = document.getElementById('dsh-design-studio-launcher');
    if (b) b.click();
    await sleep(1200);
  }
  out.openedFrom = before ? 'already' : 'launcher';
  out.root = Boolean(document.querySelector('[data-testid=ds-root]'));
  // 数据层：把当前 doc 重载标准框架，确保 DOM 反映 20 个
  try { window.__dshDesign.loadStandardFrame && window.__dshDesign.loadStandardFrame(); } catch(e){ out.reloadErr = String(e && e.message); }
  await sleep(700);
  var els = [].slice.call(document.querySelectorAll('[data-testid=ds-el]'));
  var ids = els.map(function(e){ return e.getAttribute('data-el-id'); });
  var dup = {};
  ids.forEach(function(i){ dup[i] = (dup[i]||0)+1; });
  out.elNodes = els.length;
  out.uniqueIds = Object.keys(dup).length;
  out.duplicated = Object.keys(dup).filter(function(k){ return dup[k] > 1; }).map(function(k){ return k + 'x' + dup[k]; });
  out.ids = ids;
  out.dsLogicElId = (function(){ var p=document.querySelector('[data-testid=ds-logic]'); return p?p.getAttribute('data-el-id'):null; })();
  out.innerWidth = window.innerWidth;
  out.hasMore = Boolean(document.querySelector('[data-testid=ds-more]'));
  out.hasFrameBtn = Boolean(document.querySelector('[data-testid=ds-frame]'));
  out.hasDupDoc = Boolean(document.querySelector('[data-testid=ds-dup-doc]'));
  // 受控：验证点底板会发生什么（只点一次，读完恢复）
  var winEl = els.filter(function(e){ return e.getAttribute('data-el-id') === 'el-2-win'; })[0];
  out.winRect = winEl ? (function(){ var r = winEl.getBoundingClientRect(); return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}; })() : null;
  return JSON.stringify(out);
})()
