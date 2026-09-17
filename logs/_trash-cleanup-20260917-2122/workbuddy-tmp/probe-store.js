(function(){
  var o = JSON.parse(localStorage.getItem('dsh.director.design') || '{}');
  var docs = o.docs || [];
  var d = docs.filter(function(x){ return x.docId === o.activeDocId; })[0] || docs[0];
  if (!d) return JSON.stringify({err:'no-doc', docCount: docs.length});
  var els = d.elements || [];
  return JSON.stringify({
    docCount: docs.length,
    activeDocId: o.activeDocId,
    title: d.title,
    revision: d.revision,
    versions: (d.versions||[]).length,
    n: els.length,
    list: els.map(function(e){ return [e.id, e.kind, e.layer, e.screen, e.z, e.locked===true?'LOCK':'', e.x+','+e.y+' '+e.w+'x'+e.h].join(' | '); })
  }, null, 1);
})()
