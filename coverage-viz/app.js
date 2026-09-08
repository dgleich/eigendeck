
'use strict';
function colorFor(f){
  var r,g,b;
  if(f<=0.5){ var t=f/0.5; r=210; g=Math.round(60+150*t); b=60; }
  else { var t=(f-0.5)/0.5; r=Math.round(210-150*t); g=Math.round(210-40*t); b=60; }
  return 'rgb('+r+','+g+','+b+')';
}
// Canonical squarified treemap (Bruls, Huizing, van Wijk).
// `items` each carry a pre-scaled area `a` (sum(a) == w*h).
function squarify(items, x, y, w, h){
  var res=[], rect={x:x,y:y,w:w,h:h}, row=[], q=items.slice();
  function sum(rw){ var s=0; for(var i=0;i<rw.length;i++) s+=rw[i].a; return s; }
  function worst(rw, side){
    if(!rw.length) return Infinity;
    var s=sum(rw), mx=-Infinity, mn=Infinity;
    for(var i=0;i<rw.length;i++){ var a=rw[i].a; if(a>mx)mx=a; if(a<mn)mn=a; }
    return Math.max(side*side*mx/(s*s), s*s/(side*side*mn));
  }
  function layout(rw, rc){
    var s=sum(rw);
    if(rc.w>=rc.h){
      var cw=s/rc.h, yy=rc.y;
      for(var i=0;i<rw.length;i++){ var dh=rw[i].a/cw; res.push(Object.assign({},rw[i],{x:rc.x,y:yy,w:cw,h:dh})); yy+=dh; }
      return {x:rc.x+cw,y:rc.y,w:rc.w-cw,h:rc.h};
    } else {
      var rh=s/rc.w, xx=rc.x;
      for(var i=0;i<rw.length;i++){ var dw=rw[i].a/rh; res.push(Object.assign({},rw[i],{x:xx,y:rc.y,w:dw,h:rh})); xx+=dw; }
      return {x:rc.x,y:rc.y+rh,w:rc.w,h:rc.h-rh};
    }
  }
  while(q.length){
    var side=Math.min(rect.w,rect.h), d=q[0];
    if(row.length===0){ row.push(d); q.shift(); continue; }
    if(worst(row,side) >= worst(row.concat([d]),side)){ row.push(d); q.shift(); }
    else { rect=layout(row,rect); row=[]; }
  }
  if(row.length) layout(row,rect);
  return res;
}
function drawTreemap(){
  var el=document.getElementById('treemap');
  if(!el) return;
  var W=el.clientWidth||900, H=560;
  el.style.height=H+'px';
  var total=0; for(var i=0;i<TM.length;i++) total+=TM[i].v;
  var scale=(W*H)/total;
  var items=TM.map(function(d){ return Object.assign({},d,{a:d.v*scale}); });
  var laid=squarify(items,0,0,W,H);
  el.innerHTML='';
  for(var i=0;i<laid.length;i++){
    var d=laid[i];
    if(d.w<0.5||d.h<0.5) continue;
    var a=document.createElement('a');
    a.href=d.href; a.className='cell';
    a.title=d.p+'\n'+(d.cov*100).toFixed(0)+'% covered · '+d.unc+' uncovered · '+d.v+' units';
    a.style.cssText='left:'+d.x+'px;top:'+d.y+'px;width:'+d.w+'px;height:'+d.h+'px;background:'+colorFor(d.cov);
    if(d.w>46&&d.h>16){ var s=document.createElement('span'); s.textContent=d.p.split('/').pop(); a.appendChild(s); }
    el.appendChild(a);
  }
}
drawTreemap();
window.addEventListener('resize',function(){ clearTimeout(window._t); window._t=setTimeout(drawTreemap,150); });
// sortable file table
var tb=document.querySelector('#ftbl tbody');
document.querySelectorAll('.sortbar button').forEach(function(b){
  b.onclick=function(){
    document.querySelectorAll('.sortbar button').forEach(function(x){ x.classList.remove('on'); });
    b.classList.add('on');
    var k=b.dataset.k, rows=Array.prototype.slice.call(tb.children);
    rows.sort(function(r1,r2){
      if(k==='path') return r1.querySelector('.path').textContent.localeCompare(r2.querySelector('.path').textContent);
      if(k==='cov') return (+r1.dataset.cov)-(+r2.dataset.cov);
      return (+r2.dataset[k])-(+r1.dataset[k]);
    });
    rows.forEach(function(r){ tb.appendChild(r); });
  };
});
