// Rudy & Aya Ledger — sheets, settings, capture, boot (continues app.js)
'use strict';
// ---------- charts ----------
function chartFrame(box, H, padL, padR, padT, padB){ const W=Math.max(280, box.clientWidth||340); return {W,H,padL,padR,padT,padB,iw:W-padL-padR,ih:H-padT-padB}; }
function yGrid(f, niceMax, ticks){ let s=''; ticks.forEach(fr=>{ const yy=f.padT+f.ih-fr*f.ih; s+=`<line class="gl" x1="${f.padL}" x2="${f.W-f.padR}" y1="${yy.toFixed(1)}" y2="${yy.toFixed(1)}"/><text x="${f.padL-6}" y="${(yy+4).toFixed(1)}" text-anchor="end">${esc(fmtShort(niceMax*fr))}</text>`; }); return s; }
function linePath(pts){ if(!pts.length) return ''; let d=`M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`; for(let i=1;i<pts.length;i++){ const [x0,y0]=pts[i-1],[x1,y1]=pts[i]; const cx=(x0+x1)/2; d+=` C${cx.toFixed(1)},${y0.toFixed(1)} ${cx.toFixed(1)},${y1.toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`; } return d; }
function lineChart(box, f, series, xLabels, opts){
  // series: [{name,color,values:[number|null],dashed?}] all same length; xLabels: strings per index
  const n=xLabels.length; let max=0; series.forEach(s=>s.values.forEach(v=>{ if(v!=null&&v>max) max=v; })); const niceMax=niceCeil(max||1);
  const x=i=>f.padL+(n>1? i/(n-1)*f.iw : f.iw/2); const y=v=>f.padT+f.ih-(v/niceMax)*f.ih;
  let s=`<svg viewBox="0 0 ${f.W} ${f.H}" width="${f.W}" height="${f.H}" role="img" aria-label="${esc(opts.aria||'Line chart')}">`;
  s+=`<defs>${series.map((sr,i)=>`<linearGradient id="g${i}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${sr.color}" stop-opacity=".28"/><stop offset="1" stop-color="${sr.color}" stop-opacity="0"/></linearGradient>`).join('')}</defs>`;
  s+=yGrid(f,niceMax,[0.5,1]); s+=`<line class="base" x1="${f.padL}" x2="${f.W-f.padR}" y1="${f.padT+f.ih}" y2="${f.padT+f.ih}"/>`;
  const placed=[];
  series.forEach((sr,i)=>{ const pts=[]; sr.values.forEach((v,j)=>{ if(v!=null) pts.push([x(j),y(v)]); }); if(!pts.length) return; const d=linePath(pts);
    if(!sr.dashed){ s+=`<path d="${d} L${pts[pts.length-1][0].toFixed(1)},${f.padT+f.ih} L${pts[0][0].toFixed(1)},${f.padT+f.ih} Z" fill="url(#g${i})"/>`; }
    s+=`<path d="${d}" fill="none" stroke="${sr.color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" ${sr.dashed?'stroke-dasharray="5 4" opacity=".8"':''}/>`;
    const last=pts[pts.length-1]; s+=`<circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="4" fill="${sr.color}" stroke="var(--surface)" stroke-width="2"/>`;
    const lv=sr.values.filter(v=>v!=null).pop(); const anchor = last[0] > f.W-f.padR-40 ? 'end' : 'start'; const lx = anchor==='end'? last[0]-7 : last[0]+7;
    let ly=last[1]-7; for(const p of placed){ if(Math.abs(p.x-lx)<48 && Math.abs(p.y-ly)<13) ly = p.y>last[1]? last[1]-9 : last[1]+15; } placed.push({x:lx,y:ly});
    s+=`<text class="lbl" x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="${anchor}">${esc(fmtShort(lv))}</text>`; });
  const step=Math.max(1,Math.ceil(n/(opts.maxXLabels||6)));
  xLabels.forEach((l,i)=>{ if(i%step===0 || i===n-1) s+=`<text x="${x(i).toFixed(1)}" y="${f.H-6}" text-anchor="${i===0?'start':i===n-1?'end':'middle'}">${esc(l)}</text>`; });
  s+=`<line id="xh" class="xh" x1="0" x2="0" y1="${f.padT}" y2="${f.padT+f.ih}" opacity="0"/>`;
  s+=`<rect x="${f.padL}" y="${f.padT}" width="${f.iw}" height="${f.ih}" fill="transparent" id="hit"/>`;
  s+='</svg><div class="tip hide"></div>'; box.innerHTML=s;
  const svg=box.querySelector('svg'), tip=box.querySelector('.tip'), xh=svg.querySelector('#xh'), hit=svg.querySelector('#hit');
  const show=ev=>{ const r=svg.getBoundingClientRect(); const px=(ev.clientX-r.left)*(f.W/r.width); let i=n>1? Math.round((px-f.padL)/f.iw*(n-1)) : 0; i=Math.max(0,Math.min(n-1,i)); const xx=x(i); xh.setAttribute('x1',xx); xh.setAttribute('x2',xx); xh.setAttribute('opacity','1');
    tip.innerHTML=`${esc(opts.tipTitle? opts.tipTitle(i) : xLabels[i])}<br>`+series.map(sr=> sr.values[i]==null? '' : `<span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${sr.color};margin-right:5px"></span>${esc(sr.name)} <b>${esc(fmtBase(sr.values[i]))}</b>`).filter(Boolean).join('<br>');
    tip.classList.remove('hide'); const bx=box.getBoundingClientRect(); tip.style.left=(xx*(r.width/f.W))+'px'; tip.style.top=Math.max(26,(f.padT*(r.height/f.H)))+'px'; };
  hit.addEventListener('pointermove',show); hit.addEventListener('pointerdown',show); svg.addEventListener('pointerleave',()=>{ tip.classList.add('hide'); xh.setAttribute('opacity','0'); });
}
function drawDailyLines(mk, st){
  const box=$('lineChart'); const f=chartFrame(box,190,44,14,16,24);
  const pm=shiftMonth(mk,-1); const pv=monthStats(pm); const dim=st.dim; const today = mk===monthKey(new Date()) ? Number(todayKey().slice(8,10)) : dim;
  const cum=[], pcum=[]; let a=0,b=0; for(let d=1;d<=dim;d++){ a+=st.byDay[d]||0; cum.push(d<=today? a : null); if(d<=pv.dim){ b+=pv.byDay[d]||0; pcum.push(b); } else pcum.push(null); }
  const hasPrev=pv.total>0;
  const labels=[]; for(let d=1;d<=dim;d++) labels.push(String(d));
  lineChart(box, f, [ {name:monthShort(mk),color:'var(--p1)',values:cum}, ...(hasPrev? [{name:monthShort(pm),color:'var(--p2)',values:pcum,dashed:true}] : []) ], labels, {aria:'Cumulative spending by day', tipTitle:i=>`${monthShort(mk).split(' ')[0]} ${i+1}`, maxXLabels:7});
  $('lineTitle').textContent='Running total'; $('lineSub').textContent='day by day';
  $('lineLegend').innerHTML = `<span><i class="sw" style="background:var(--p1)"></i>${esc(monthLabel(mk))}</span>`+(hasPrev? `<span><i class="sw" style="background:var(--p2);opacity:.8"></i>${esc(monthLabel(pm))} (dashed)</span>` : '');
}
function drawMonthlyLines(per, fixed){
  const box=$('lineChart'); const f=chartFrame(box,190,44,14,16,24);
  const dd=per.map(p=>p.st.total); const allin=per.map(p=>p.st.total+fixed); const labels=per.map(p=>monthShort(p.mk));
  const series=[{name:'Day-to-day',color:'var(--p1)',values:dd}]; if(fixed>0) series.push({name:'With fixed costs',color:'var(--p4)',values:allin,dashed:true});
  lineChart(box, f, series, labels, {aria:'Spending per month', maxXLabels:6});
  $('lineTitle').textContent='Spending per month'; $('lineSub').textContent=per.length+' months';
  $('lineLegend').innerHTML = series.map(s=>`<span><i class="sw" style="background:${s.color}"></i>${esc(s.name)}</span>`).join('');
}
function drawCategoryBars(per, agg){
  const box=$('barChart'); const grouped = per.length>=2 && per.length<=4;
  const cats=Object.entries(agg.byTag).sort((a,b)=>b[1]-a[1]).slice(0,8).map(x=>x[0]);
  if(!cats.length){ box.innerHTML='<div class="faint" style="font-size:13px;padding:8px 0">Categories appear as you log expenses.</div>'; $('barLegend').innerHTML=''; $('barSub').textContent=''; return; }
  const f=chartFrame(box, 236, 44, 8, 18, 58);
  const series = grouped ? per.map((p,i)=>({name:monthShort(p.mk), color:PCOL[i], values:cats.map(c=>p.st.byTag[c]||0)})) : [{name:'Total', color:'var(--p1)', values:cats.map(c=>agg.byTag[c])}];
  let max=0; series.forEach(s=>s.values.forEach(v=>{ if(v>max) max=v; })); const niceMax=niceCeil(max||1);
  const slot=f.iw/cats.length; const groupW=Math.min(slot*0.78, grouped? 60 : 40); const bw=grouped? (groupW-2*(series.length-1))/series.length : groupW;
  const y=v=>f.padT+f.ih-(v/niceMax)*f.ih;
  let s=`<svg viewBox="0 0 ${f.W} ${f.H}" width="${f.W}" height="${f.H}" role="img" aria-label="Spending by category">`;
  s+=yGrid(f,niceMax,[0.5,1]); s+=`<line class="base" x1="${f.padL}" x2="${f.W-f.padR}" y1="${f.padT+f.ih}" y2="${f.padT+f.ih}"/>`;
  cats.forEach((c,ci)=>{ const gx=f.padL+ci*slot+(slot-groupW)/2;
    series.forEach((sr,si)=>{ const v=sr.values[ci]; const h=v? Math.max(2,(v/niceMax)*f.ih) : 0; const x=gx+si*(bw+2); s+=`<rect data-c="${ci}" data-s="${si}" x="${x.toFixed(1)}" y="${(f.padT+f.ih-h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="4" fill="${sr.color}"/>`; });
    if(!grouped){ const v=series[0].values[ci]; s+=`<text class="lbl" x="${(gx+groupW/2).toFixed(1)}" y="${(y(v)-6).toFixed(1)}" text-anchor="middle">${esc(fmtShort(v))}</text>`; }
    const lx=(gx+groupW/2).toFixed(1), ly=(f.padT+f.ih+10).toFixed(1); s+=`<text x="${lx}" y="${ly}" text-anchor="end" transform="rotate(-38 ${lx} ${ly})" font-size="11">${esc(c)}</text>`;
    s+=`<rect data-c="${ci}" x="${(f.padL+ci*slot).toFixed(1)}" y="${f.padT}" width="${slot.toFixed(1)}" height="${f.ih}" fill="transparent"/>`; });
  s+='</svg><div class="tip hide"></div>'; box.innerHTML=s;
  const svg=box.querySelector('svg'), tip=box.querySelector('.tip');
  const show=ev=>{ const el=ev.target.closest('rect[data-c]'); if(!el){ tip.classList.add('hide'); return; } const ci=Number(el.dataset.c); const r=box.getBoundingClientRect(); const b=el.getBoundingClientRect();
    tip.innerHTML=`${esc(cats[ci])}<br>`+series.map(sr=>`<span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${sr.color};margin-right:5px"></span>${esc(sr.name)} <b>${esc(fmtBase(sr.values[ci]))}</b>`).join('<br>')+(grouped?'':`<br><span style="opacity:.7">${Math.round(series[0].values[ci]/(agg.total||1)*100)}% of spending</span>`);
    tip.classList.remove('hide'); tip.style.left=(b.left-r.left+b.width/2)+'px'; tip.style.top=Math.max(30,(b.top-r.top))+'px'; };
  svg.addEventListener('pointermove',show); svg.addEventListener('pointerdown',show); svg.addEventListener('pointerleave',()=>tip.classList.add('hide'));
  $('barSub').textContent = grouped? 'per month' : (per.length>4? 'total over '+per.length+' months' : 'top categories');
  $('barLegend').innerHTML = grouped? series.map(s=>`<span><i class="sw" style="background:${s.color}"></i>${esc(s.name)}</span>`).join('') : '';
}

// ---------- sheets ----------
function openSheet(html, onReady){ $('sheetIn').innerHTML=html; const bd=$('backdrop'), sh=$('sheet'); bd.classList.remove('hide'); requestAnimationFrame(()=>{ bd.classList.add('show'); sh.classList.add('show'); }); if(onReady) onReady($('sheetIn')); }
function closeSheet(){ const bd=$('backdrop'), sh=$('sheet'); bd.classList.remove('show'); sh.classList.remove('show'); setTimeout(()=>{ bd.classList.add('hide'); $('sheetIn').innerHTML=''; },280); }
$('backdrop').addEventListener('click',closeSheet);
function chipsHTML(name, options, selected, colored){ return options.map(o=>`<button type="button" class="chip ${o===selected?'on':''}" data-chip="${esc(name)}" data-val="${esc(o)}">${colored?`<i class="dot" style="background:${memberColor(o)}"></i>`:(TAG_ICON[o]&&name==='tag'?TAG_ICON[o]+' ':'')}${esc(o)}</button>`).join(''); }
function wireChips(root){ root.querySelectorAll('[data-chip]').forEach(b=>b.addEventListener('click',()=>{ root.querySelectorAll(`[data-chip="${b.dataset.chip}"]`).forEach(x=>x.classList.remove('on')); b.classList.add('on'); })); }
function chipVal(root,name){ const b=root.querySelector(`[data-chip="${name}"].on`); return b? b.dataset.val : null; }
function errMsg(e){ return e&&e.message? e.message : 'Could not save. Check your connection and try again.'; }

function openExpenseSheet(e){
  const isNew=!e || !e.id; e=e||{}; const d={amount:'',currency:S.settings.base,desc:'',tag:'Other',by:S.who||'',date:todayKey(),note:'',...e};
  const members=S.settings.members||[];
  // a new expense defaults to this member's usual account; an existing one keeps its account, or stays untracked
  const fromSel = isNew ? (d.from && accById(d.from)? d.from : 'auto') : (d.from && accById(d.from)? d.from : 'none');
  openSheet(`<div class="grab"></div><h3>${isNew?'New expense':'Edit expense'}</h3><div class="form">
    <div class="grid2"><div class="field"><label for="f-amount">Amount</label><input class="num" id="f-amount" type="number" inputmode="decimal" step="any" value="${esc(d.amount)}" placeholder="0"></div>
    <div class="field"><label for="f-cur">Currency</label><select id="f-cur">${CURRENCIES.map(c=>`<option ${c===d.currency?'selected':''}>${c}</option>`).join('')}</select></div></div>
    <div class="field"><label for="f-desc">What for</label><input id="f-desc" value="${esc(d.desc)}" placeholder="Groceries at Spinneys"></div>
    <div class="field"><label>Category</label><div class="chips">${chipsHTML('tag',TAGS,d.tag)}</div></div>
    <div class="grid2"><div class="field"><label>Paid by</label><div class="chips">${chipsHTML('by',members,d.by,true)}</div></div>
    <div class="field"><label for="f-date">Date</label><input id="f-date" type="date" value="${esc(d.date)}"></div></div>
    <div class="field"><label for="f-from">Paid from</label><select id="f-from"><option value="auto" ${fromSel==='auto'?'selected':''}>Default for ${esc(d.by||S.who||'this person')} (${esc(((S.settings.defaultPaid||{})[d.by||S.who]||'cash'))})</option>${accOptgroups(flowAccounts(), fromSel)}<option value="none" ${fromSel==='none'?'selected':''}>Not tracked</option></select></div>
    <div class="field"><label for="f-note">Note</label><input id="f-note" value="${esc(d.note||'')}" placeholder="Optional"></div>
    <div class="actions"><div>${isNew?'':'<button type="button" class="danger" id="f-del">Delete</button>'}</div><div class="right"><button type="button" class="secondary" id="f-cancel">Cancel</button><button type="button" class="primary" id="f-save">${isNew?'Add':'Save'}</button></div></div>
  </div>`, root=>{
    wireChips(root); if(isNew && !d.amount) setTimeout(()=>$('f-amount').focus(),300);
    $('f-cancel').onclick=closeSheet;
    if(!isNew) $('f-del').onclick=async()=>{ if($('f-del').dataset.arm){ try{ await api('expense',{method:'DELETE',body:{id:e.id,month:e.month}}); removeLocal(e.id,e.month); closeSheet(); toast('Deleted'); load(); }catch(err){ toast(errMsg(err)); } } else { $('f-del').dataset.arm='1'; $('f-del').textContent='Tap again to delete'; } };
    $('f-save').onclick=async()=>{ const amount=Number($('f-amount').value); if(!(amount>0)){ $('f-amount').focus(); return; }
      const ex={ id:e.id, amount, currency:$('f-cur').value, desc:$('f-desc').value.trim()||chipVal(root,'tag')||'Expense', tag:chipVal(root,'tag')||'Other', by:chipVal(root,'by')||S.who||'', date:$('f-date').value||todayKey(), note:$('f-note').value.trim()||null, from:$('f-from').value||'auto' };
      $('f-save').disabled=true;
      try{ let r; if(isNew) r=await api('expense',{method:'POST',body:{expense:ex, by:S.who||'', source:'manual'}}); else r=await api('expense',{method:'PUT',body:{month:e.month, expense:ex}});
        if(!isNew) removeLocal(e.id,e.month); (r.saved||[]).forEach(addLocal); closeSheet(); toast(isNew? 'Added '+fmtBase(r.saved[0].usd)+' · '+r.saved[0].desc : 'Saved'); load(); }
      catch(err){ toast(errMsg(err)); $('f-save').disabled=false; } };
  });
}
function addLocal(doc){ const arr=S.months[doc.month]||(S.months[doc.month]=[]); if(!arr.some(x=>x.id===doc.id)) arr.push(doc); if(!S.monthKeys.includes(doc.month)) S.monthKeys.push(doc.month); render(); }
function removeLocal(id, mk){ if(S.months[mk]) S.months[mk]=S.months[mk].filter(x=>x.id!==id); render(); }
function openRecurringSheet(r){
  const isNew=!r; r=r||{name:'',amount:'',currency:S.settings.base,period:'monthly',kind:'subscription',by:'',day:'',active:true};
  const members=S.settings.members||[];
  openSheet(`<div class="grab"></div><h3>${isNew?'New fixed cost':'Edit fixed cost'}</h3><div class="form">
    <div class="field"><label for="r-name">Name</label><input id="r-name" value="${esc(r.name)}" placeholder="Netflix, Nanny, Rent, Generator…"></div>
    <div class="grid2"><div class="field"><label for="r-amount">Amount</label><input class="num" id="r-amount" type="number" inputmode="decimal" step="any" value="${esc(r.amount)}" placeholder="0"></div>
    <div class="field"><label for="r-cur">Currency</label><select id="r-cur">${CURRENCIES.map(c=>`<option ${c===r.currency?'selected':''}>${c}</option>`).join('')}</select></div></div>
    <div class="field"><label>Billed</label><div class="seg" id="r-period"><button type="button" class="${r.period!=='yearly'?'on':''}" data-p="monthly">Monthly</button><button type="button" class="${r.period==='yearly'?'on':''}" data-p="yearly">Yearly</button></div><div class="muted" style="font-size:12.5px" id="r-permonth"></div></div>
    <div class="field"><label>Type</label><div class="chips">${chipsHTML('kind',KINDS.map(k=>k[1]),(KINDS.find(k=>k[0]===(r.kind||'other'))||KINDS[5])[1])}</div></div>
    <div class="grid2"><div class="field"><label>Paid by</label><div class="chips">${chipsHTML('by',members,r.by,true)}</div></div>
    <div class="field"><label for="r-day">Day of month</label><input id="r-day" type="number" inputmode="numeric" min="1" max="31" value="${esc(r.day||'')}" placeholder="Optional"></div></div>
    <div class="field"><label for="r-active">Status</label><select id="r-active"><option value="1" ${r.active!==false?'selected':''}>Active</option><option value="0" ${r.active===false?'selected':''}>Paused</option></select></div>
    <div class="actions"><div>${isNew?'':'<button type="button" class="danger" id="r-del">Delete</button>'}</div><div class="right"><button type="button" class="secondary" id="r-cancel">Cancel</button><button type="button" class="primary" id="r-save">${isNew?'Add':'Save'}</button></div></div>
  </div>`, root=>{
    wireChips(root); let period=r.period==='yearly'?'yearly':'monthly';
    const upd=()=>{ const a=Number($('r-amount').value)||0; $('r-permonth').textContent = period==='yearly'&&a? '≈ '+fmtAmt(a/12,$('r-cur').value)+' per month in the totals' : (period==='monthly'&&a? fmtAmt(a*12,$('r-cur').value)+' a year':''); };
    root.querySelectorAll('#r-period button').forEach(b=>b.onclick=()=>{ period=b.dataset.p; root.querySelectorAll('#r-period button').forEach(x=>x.classList.toggle('on',x===b)); upd(); });
    $('r-amount').oninput=upd; $('r-cur').onchange=upd; upd(); if(isNew) setTimeout(()=>$('r-name').focus(),300);
    $('r-cancel').onclick=closeSheet;
    if(!isNew) $('r-del').onclick=async()=>{ if($('r-del').dataset.arm){ try{ const d=await api('recurring',{method:'DELETE',body:{id:r.id}}); S.recurring=d.recurring||[]; closeSheet(); toast('Deleted'); render(); }catch(err){ toast(errMsg(err)); } } else { $('r-del').dataset.arm='1'; $('r-del').textContent='Tap again to delete'; } };
    $('r-save').onclick=async()=>{ const name=$('r-name').value.trim(); const amount=Number($('r-amount').value); if(!name){ $('r-name').focus(); return; } if(!(amount>0)){ $('r-amount').focus(); return; }
      const kind=(KINDS.find(k=>k[1]===chipVal(root,'kind'))||['other'])[0];
      const item={ id:r.id, name, amount, currency:$('r-cur').value, period, kind, by:chipVal(root,'by')||'', day:Number($('r-day').value)||null, active:$('r-active').value==='1', ts:r.ts };
      $('r-save').disabled=true; try{ const d=await api('recurring',{method:'POST',body:{item}}); S.recurring=d.recurring||S.recurring; closeSheet(); toast('Saved '+name); render(); }catch(err){ toast(errMsg(err)); $('r-save').disabled=false; } };
  });
}
function openIncomeSheet(r){
  const isNew=!r; r=r||{name:'',amount:'',currency:S.settings.base,period:'monthly',by:S.who||'',active:true};
  const members=S.settings.members||[];
  openSheet(`<div class="grab"></div><h3>${isNew?'New income':'Edit income'}</h3><div class="form">
    <div class="field"><label for="i-name">Name</label><input id="i-name" value="${esc(r.name)}" placeholder="Rudy's salary, rent from the flat…"></div>
    <div class="grid2"><div class="field"><label for="i-amount">Amount</label><input class="num" id="i-amount" type="number" inputmode="decimal" step="any" value="${esc(r.amount)}" placeholder="0"></div>
    <div class="field"><label for="i-cur">Currency</label><select id="i-cur">${CURRENCIES.map(c=>`<option ${c===r.currency?'selected':''}>${c}</option>`).join('')}</select></div></div>
    <div class="field"><label>Paid</label><div class="seg" id="i-period"><button type="button" class="${r.period!=='yearly'?'on':''}" data-p="monthly">Monthly</button><button type="button" class="${r.period==='yearly'?'on':''}" data-p="yearly">Yearly</button></div></div>
    <div class="field"><label>Whose</label><div class="chips">${chipsHTML('by',members,r.by,true)}</div></div>
    <div class="field"><label for="i-active">Status</label><select id="i-active"><option value="1" ${r.active!==false?'selected':''}>Active</option><option value="0" ${r.active===false?'selected':''}>Paused</option></select></div>
    <div class="actions"><div>${isNew?'':'<button type="button" class="danger" id="i-del">Delete</button>'}</div><div class="right"><button type="button" class="secondary" id="i-cancel">Cancel</button><button type="button" class="primary" id="i-save">${isNew?'Add':'Save'}</button></div></div>
  </div>`, root=>{
    wireChips(root); let period=r.period==='yearly'?'yearly':'monthly';
    root.querySelectorAll('#i-period button').forEach(b=>b.onclick=()=>{ period=b.dataset.p; root.querySelectorAll('#i-period button').forEach(x=>x.classList.toggle('on',x===b)); });
    if(isNew) setTimeout(()=>$('i-name').focus(),300);
    $('i-cancel').onclick=closeSheet;
    if(!isNew) $('i-del').onclick=async()=>{ if($('i-del').dataset.arm){ try{ const d=await api('income',{method:'DELETE',body:{id:r.id}}); S.income=d.income||[]; closeSheet(); toast('Deleted'); render(); }catch(err){ toast(errMsg(err)); } } else { $('i-del').dataset.arm='1'; $('i-del').textContent='Tap again to delete'; } };
    $('i-save').onclick=async()=>{ const name=$('i-name').value.trim(); const amount=Number($('i-amount').value); if(!name){ $('i-name').focus(); return; } if(!(amount>0)){ $('i-amount').focus(); return; }
      const item={ id:r.id, name, amount, currency:$('i-cur').value, period, by:chipVal(root,'by')||'', active:$('i-active').value==='1', ts:r.ts };
      $('i-save').disabled=true; try{ const d=await api('income',{method:'POST',body:{item}}); S.income=d.income||S.income; closeSheet(); toast('Saved '+name); render(); }catch(err){ toast(errMsg(err)); $('i-save').disabled=false; } };
  });
}
function openAccountSheet(a, debtDefault, savedDefault){
  const isNew=!a; a=a||{name:'',type:debtDefault?'loan':(savedDefault?'cash':'bank'),owner:S.who||'Joint',amount:'',currency:S.settings.base,grams:'',note:'',active:true, bucket: savedDefault? 'saved' : null};
  const types = ACC_TYPES.map(t=>t[1]); const cur=accType(a.type)[1];
  openSheet(`<div class="grab"></div><h3>${isNew? (debtDefault?'New debt':'New account') : 'Edit'}</h3><div class="form">
    <div class="field"><label for="a-name">Name</label><input id="a-name" value="${esc(a.name)}" placeholder="${savedDefault? 'Savings (USD), Gold coins…' : 'HSBC current, Cash in hand…'}"></div>
    <div class="field"><label>Type</label><div class="chips" id="a-types">${ACC_TYPES.map(t=>`<button type="button" class="chip ${t[1]===cur?'on':''}" data-chip="type" data-val="${esc(t[1])}">${t[2]} ${esc(t[1])}</button>`).join('')}</div></div>
    <div class="field"><label>Whose</label><div class="chips">${owners().map(o=>`<button type="button" class="chip ${o===(a.owner||'Joint')?'on':''}" data-chip="owner" data-val="${esc(o)}"><i class="dot" style="background:${ownerColor(o)}"></i>${esc(o)}</button>`).join('')}</div></div>
    <div class="field" id="a-bucketf"><label>Which pot</label><div class="seg" id="a-bucket"><button type="button" class="${bucketOf(a)==='spending'?'on':''}" data-b="spending">Everyday money</button><button type="button" class="${bucketOf(a)==='saved'?'on':''}" data-b="saved">Long-term savings</button></div><span class="help">Everyday: spending flows through it (bank, cash in hand). Long-term: savings cash, gold, anything you do not touch.</span></div>
    <div class="grid2" id="a-money"><div class="field"><label for="a-amount" id="a-amount-l">Balance</label><input class="num" id="a-amount" type="number" inputmode="decimal" step="any" value="${esc(a.amount)}" placeholder="0"></div>
    <div class="field"><label for="a-cur">Currency</label><select id="a-cur">${CURRENCIES.map(c=>`<option ${c===a.currency?'selected':''}>${c}</option>`).join('')}</select></div></div>
    <div class="grid2 hide" id="a-cardf"><div class="field"><label for="a-limit">Credit limit</label><input class="num" id="a-limit" type="number" inputmode="decimal" step="any" value="${esc(a.limit||'')}" placeholder="31800"></div>
    <div class="field"><label for="a-avail">Available now</label><input class="num" id="a-avail" type="number" inputmode="decimal" step="any" value="${esc(a.available==null?'':a.available)}" placeholder="8514"></div></div>
    <div class="field hide" id="a-last4f"><label for="a-last4" id="a-last4-l">Card ending (last 4 digits)</label><input id="a-last4" inputmode="numeric" maxlength="4" value="${esc(a.last4||'')}" placeholder="Optional, matches bank alerts"><span class="help" id="a-cardhelp"></span></div>
    <div class="field hide" id="a-maskf"><label for="a-mask">Account number as the bank writes it in alerts</label><input id="a-mask" value="${esc(a.mask||'')}" placeholder="032-401***-001"><span class="help">Lets bank alerts find this account. Copy it from an SMS.</span></div>
    ${(!isNew && S.recon[a.id])? `<div class="field"><label>Reconciliation</label><div class="help" id="a-recon"></div><div class="rowbtns" id="a-resolve"></div></div>` : ''}
    <div class="field hide" id="a-goldf"><label for="a-grams">Weight in grams</label><input class="num" id="a-grams" type="number" inputmode="decimal" step="any" value="${esc(a.grams||'')}" placeholder="0"><span class="help" id="a-goldhelp"></span></div>
    <div class="field"><label for="a-note">Note</label><input id="a-note" value="${esc(a.note||'')}" placeholder="Optional"></div>
    <div class="actions"><div>${isNew?'':'<button type="button" class="danger" id="a-del">Delete</button>'}</div><div class="right"><button type="button" class="secondary" id="a-cancel">Cancel</button><button type="button" class="primary" id="a-save">${isNew?'Add':'Save'}</button></div></div>
  </div>`, root=>{
    wireChips(root);
    const sync=()=>{ const t=(ACC_TYPES.find(x=>x[1]===chipVal(root,'type'))||ACC_TYPES[1])[0]; const gold=t==='gold', card=t==='card', bank=t==='bank'; $('a-goldf').classList.toggle('hide',!gold); $('a-cardf').classList.toggle('hide',!card); $('a-last4f').classList.toggle('hide',!(card||bank)); $('a-maskf').classList.toggle('hide',!bank); $('a-last4-l').textContent = bank? 'Debit card ending (last 4 digits)' : 'Card ending (last 4 digits)'; $('a-money').classList.toggle('hide',gold && Number(S.settings.goldPrice)>0); $('a-amount-l').textContent = card? 'Amount owed (auto when limit and available are set)' : LIAB.includes(t)? 'Amount owed' : (gold? 'Value (if no gold price set)' : 'Balance'); const pr=Number(S.settings.goldPrice)||0; $('a-goldhelp').textContent = pr? `Valued at ${fmtAmt(pr,'USD')} per gram (change it in Settings).` : 'Set a gold price per gram in Settings to value it automatically, or enter the value below.';
      if(card){ const lim=Number($('a-limit').value)||0, av=$('a-avail').value===''? null : Number($('a-avail').value); if(lim>0 && av!=null){ $('a-amount').value=Math.round((lim-Math.min(lim,av))*100)/100; } $('a-cardhelp').textContent='The debt is the limit minus what the bank says is available. Card alerts keep it exact; the monthly payment from the bank is a transfer that brings it down.'; } };
    root.querySelectorAll('[data-chip="type"]').forEach(b=>b.addEventListener('click',sync)); $('a-limit').addEventListener('input',sync); $('a-avail').addEventListener('input',sync); sync();
    let bucket=bucketOf(a), bucketTouched=!isNew || !!a.bucket; const showBucket=()=>root.querySelectorAll('#a-bucket button').forEach(x=>x.classList.toggle('on',x.dataset.b===bucket));
    root.querySelectorAll('#a-bucket button').forEach(b=>b.onclick=()=>{ bucket=b.dataset.b; bucketTouched=true; showBucket(); });
    // until the pot is chosen by hand, it follows the type (gold and savings are long-term; bank and cash in hand are everyday)
    const syncBucket=()=>{ const t=(ACC_TYPES.find(x=>x[1]===chipVal(root,'type'))||ACC_TYPES[1])[0]; $('a-bucketf').classList.toggle('hide', LIAB.includes(t)); if(!bucketTouched){ bucket=bucketOf({type:t}); showBucket(); } }; root.querySelectorAll('[data-chip="type"]').forEach(b=>b.addEventListener('click',syncBucket)); syncBucket();
    if(isNew) setTimeout(()=>$('a-name').focus(),300);
    const rc=S.recon[a.id]; if(!isNew && rc){ const liab=a.type==='card'; const out = liab? rc.gap>0 : rc.gap<0;
      $('a-recon').innerHTML = rc.gap? `Expected ${esc(fmtAmt(rc.expected,a.currency))} from what is logged${rc.since?' since '+esc(rc.since):''}; the ${liab?'card says you owe':'balance is'} ${esc(fmtAmt(rc.actual,a.currency))}. <b>${esc(gapText(a, rc))}.</b> Type the balance above whenever you check it; then explain any gap here.` : (rc.confirmed? `Matches what is logged (checked ${esc(rc.since||'')}). Type a new balance above whenever you check the account.` : 'Type the balance above to start tracking it.');
      const btns=[]; if(rc.gap){ if(out && !liab) btns.push(['withdrawal','I withdrew cash']); if(out) btns.push(['expense','Forgot an expense']); if(out) btns.push(['fee','Bank fee / interest']); btns.push(['accept', out? 'Accept as is' : 'Accept as is']); }
      $('a-resolve').innerHTML = btns.map(([k,l])=>`<button type="button" class="secondary" data-resolve="${k}">${l}</button>`).join('');
      root.querySelectorAll('[data-resolve]').forEach(b=>b.onclick=async()=>{ b.disabled=true; try{ const d=await api('account/resolve',{method:'POST',body:{id:a.id, action:b.dataset.resolve, by:S.who||''}}); S.accounts=d.accounts||S.accounts; S.recon=d.recon||S.recon; closeSheet(); toast('Explained'); render(); load(); }catch(err){ toast(errMsg(err)); b.disabled=false; } }); }
    $('a-cancel').onclick=closeSheet;
    if(!isNew) $('a-del').onclick=async()=>{ if($('a-del').dataset.arm){ try{ const d=await api('account',{method:'DELETE',body:{id:a.id}}); S.accounts=d.accounts||[]; S.networth=d.networth||S.networth; S.recon=d.recon||S.recon; closeSheet(); toast('Deleted'); render(); load(); }catch(err){ toast(errMsg(err)); } } else { $('a-del').dataset.arm='1'; $('a-del').textContent='Tap again to delete'; } };
    $('a-save').onclick=async()=>{ const name=$('a-name').value.trim(); if(!name){ $('a-name').focus(); return; } const t=(ACC_TYPES.find(x=>x[1]===chipVal(root,'type'))||ACC_TYPES[1])[0];
      const item={ id:a.id, name, type:t, owner:chipVal(root,'owner')||'Joint', amount:Number($('a-amount').value)||0, currency:$('a-cur').value, grams: t==='gold'? Number($('a-grams').value)||0 : null, limit: t==='card'? Number($('a-limit').value)||null : null, available: t==='card' && $('a-avail').value!==''? Number($('a-avail').value) : null, last4: (t==='card'||t==='bank')? $('a-last4').value.replace(/\D/g,'').slice(-4)||null : null, mask: t==='bank'? $('a-mask').value.trim()||null : null, bucket, note:$('a-note').value.trim()||null, active:true, ts:a.ts };
      if(t!=='gold' && !(item.amount>=0)){ $('a-amount').focus(); return; }
      $('a-save').disabled=true; try{ const d=await api('account',{method:'POST',body:{item}}); S.accounts=d.accounts||S.accounts; S.networth=d.networth||S.networth; S.recon=d.recon||S.recon; closeSheet(); toast('Saved '+name); render(); load(); }catch(err){ toast(errMsg(err)); $('a-save').disabled=false; } };
  });
}
function openTransferSheet(){
  const flow=flowAccounts();
  if(flow.length<2){ toast('Add two accounts first (a bank and cash in hand, say).'); return; }
  const opts=sel=>accOptgroups(flow, sel);
  const bank=flow.find(a=>a.type==='bank'&&a.owner===S.who)||flow.find(a=>a.type==='bank')||flow[0]; const cash=flow.find(a=>a.type==='cash'&&bucketOf(a)==='spending'&&a.owner===S.who)||flow.find(a=>a.type==='cash'&&bucketOf(a)==='spending')||flow.find(a=>a.id!==bank.id)||bank;
  openSheet(`<div class="grab"></div><h3>Move money</h3><div class="muted" style="font-size:13.5px">A transfer between your own accounts is not an expense: cash withdrawals, paying the credit card, moving to savings.</div><div class="form">
    <div class="field"><label for="t-from">From</label><select id="t-from">${opts(bank.id)}</select></div>
    <div class="field"><label for="t-to">To</label><select id="t-to">${opts(cash.id)}</select></div>
    <div class="grid2"><div class="field"><label for="t-amount">Amount</label><input class="num" id="t-amount" type="number" inputmode="decimal" step="any" placeholder="0"></div>
    <div class="field"><label for="t-cur">Currency</label><select id="t-cur">${CURRENCIES.map(c=>`<option ${c===bank.currency?'selected':''}>${c}</option>`).join('')}</select></div></div>
    <div class="grid2"><div class="field"><label for="t-date">Date</label><input id="t-date" type="date" value="${esc(todayKey())}"></div><div class="field"><label for="t-desc">Note</label><input id="t-desc" placeholder="Cash withdrawal"></div></div>
    <div class="actions"><div></div><div class="right"><button type="button" class="secondary" id="t-cancel">Cancel</button><button type="button" class="primary" id="t-save">Move</button></div></div>
  </div>`, root=>{
    setTimeout(()=>$('t-amount').focus(),300); $('t-cancel').onclick=closeSheet;
    $('t-from').onchange=()=>{ const a=accById($('t-from').value); if(a) $('t-cur').value=a.currency; };
    $('t-save').onclick=async()=>{ const amount=Number($('t-amount').value); if(!(amount>0)){ $('t-amount').focus(); return; } const fromAcc=$('t-from').value, toAcc=$('t-to').value; if(fromAcc===toAcc){ toast('Pick two different accounts.'); return; }
      const to=accById(toAcc); const desc=$('t-desc').value.trim()|| (to&&to.type==='card'?'Credit card payment': to&&bucketOf(to)==='saved'?'To long-term savings': to&&to.type==='cash'?'Cash withdrawal':'Transfer');
      $('t-save').disabled=true; try{ await api('move',{method:'POST',body:{move:{kind:'transfer', fromAcc, toAcc, amount, currency:$('t-cur').value, desc, date:$('t-date').value||todayKey()}, by:S.who||''}}); closeSheet(); toast('Moved '+fmtAmt(amount,$('t-cur').value)); load(); }catch(err){ toast(errMsg(err)); $('t-save').disabled=false; } };
  });
}
function openMoveSheet(m){
  const f=accById(m.fromAcc), t=accById(m.toAcc);
  openSheet(`<div class="grab"></div><h3>${esc(m.desc)}</h3><div class="muted" style="font-size:14px;line-height:1.6">${esc(fmtAmt(m.amount,m.currency))}${m.currency!==S.settings.base?' ('+esc(fmtBase(m.usd))+')':''}<br>${m.kind==='income'?'Income received':m.kind==='refund'?'Refund':m.kind==='adjust'?'Adjustment':'Transfer'}${f?' from '+esc(f.name):''}${t?' to '+esc(t.name):''}<br>${esc(m.date)}${m.by?' · '+esc(m.by):''}${m.source==='sms'?' · from a bank alert':''}</div>
    <div class="actions" style="display:flex;justify-content:space-between"><button type="button" class="danger" id="m-del">Delete</button><button type="button" class="secondary" id="m-close">Close</button></div>`, root=>{
    $('m-close').onclick=closeSheet;
    $('m-del').onclick=async()=>{ if($('m-del').dataset.arm){ try{ await api('move',{method:'DELETE',body:{id:m.id, month:m.month}}); if(S.moves[m.month]) S.moves[m.month]=S.moves[m.month].filter(x=>x.id!==m.id); closeSheet(); toast('Deleted'); render(); load(); }catch(err){ toast(errMsg(err)); } } else { $('m-del').dataset.arm='1'; $('m-del').textContent='Tap again to delete'; } };
  });
}
function siriURL(who){ return location.origin+'/siri?key='+encodeURIComponent(S.key)+'&by='+encodeURIComponent(who||S.who||'')+'&text='; }
function payURL(who){ return location.origin+'/pay?key='+encodeURIComponent(S.key)+'&by='+encodeURIComponent(who||S.who||''); }
function smsURL(who){ return location.origin+'/sms?key='+encodeURIComponent(S.key)+'&by='+encodeURIComponent(who||S.who||''); }
function openSettingsSheet(){
  const s=S.settings;
  openSheet(`<div class="grab"></div><h3>Settings</h3><div class="form">
    <div class="field"><label>This phone belongs to</label><div class="chips">${chipsHTML('who',s.members||[],S.who,true)}</div></div>
    <div class="field"><label for="s-members">Members</label><input id="s-members" value="${esc((s.members||[]).join(', '))}" placeholder="Rudy, Aya"><span class="help">Comma separated. First names are enough.</span></div>
    <div class="grid2"><div class="field"><label for="s-base">Show totals in</label><select id="s-base">${CURRENCIES.map(c=>`<option ${c===s.base?'selected':''}>${c}</option>`).join('')}</select></div>
    <div class="field"><label for="s-lbp">1 USD = ? LBP</label><input class="num" id="s-lbp" type="number" inputmode="numeric" value="${esc(s.rates.LBP||89500)}"></div></div>
    <div class="grid2"><div class="field"><label for="s-eur">1 USD = ? EUR</label><input class="num" id="s-eur" type="number" inputmode="decimal" step="any" value="${esc(s.rates.EUR||0.92)}"></div>
    <div class="field"><label for="s-aed">1 USD = ? AED</label><input class="num" id="s-aed" type="number" inputmode="decimal" step="any" value="${esc(s.rates.AED||3.6725)}"></div></div>
    <div class="field"><label for="s-budget">Monthly budget (${esc(s.base)})</label><input class="num" id="s-budget" type="number" inputmode="decimal" value="${esc(s.budget||'')}" placeholder="Optional"></div>
    <div class="grid2"><div class="field"><label for="s-people">Also track for</label><input id="s-people" value="${esc((s.people||[]).join(', '))}" placeholder="Noah"><span class="help">Family members with savings but no phone.</span></div>
    <div class="field"><label for="s-gold">Gold price (USD per gram)</label><input class="num" id="s-gold" type="number" inputmode="decimal" step="any" value="${esc(s.goldPrice||'')}" placeholder="e.g. 130"></div></div>
    <div class="field"><label for="s-cash">Bank debits that are really cash withdrawals</label><input id="s-cash" value="${esc((s.cashRules||[]).join(', '))}" placeholder="ATM, Careem Deliveries"><span class="help">Merchant names in bank alerts that mean money moved to cash, not spending. Comma separated.</span></div>
    <div class="field"><label>How typed and Siri expenses are paid by default</label><div class="help">Used when the note does not say "cash", "by card" or "from the bank".</div>${(s.members||[]).map(m=>`<div class="row-between" style="padding:4px 0"><span>${esc(m)}</span><div class="seg" data-paid="${esc(m)}">${['cash','card','bank'].map(v=>`<button type="button" class="${((s.defaultPaid||{})[m]||'cash')===v?'on':''}" data-v="${v}">${v}</button>`).join('')}</div></div>`).join('')}</div>
    <div class="field"><label for="s-tz">Time zone</label><select id="s-tz">${['Asia/Beirut','Europe/Paris','Europe/London','Asia/Dubai','America/New_York'].map(z=>`<option ${z===(s.timezone||'Asia/Beirut')?'selected':''}>${z}</option>`).join('')}</select></div>
    <div class="field"><label>Siri shortcut for this phone</label>
      <div class="help">In the Shortcuts app, make a shortcut named <b>Add to my expenses</b> with these actions:</div>
      <ol class="steps"><li><b>Dictate Text</b></li><li><b>URL Encode</b> (its input fills in as Dictated Text)</li><li><b>Get Contents of URL</b>: paste the address below, then tap right after it and insert the <b>URL Encoded Text</b> variable</li><li><b>Speak Text</b> (or Show Result)</li></ol>
      <div class="code" id="s-siriurl">${esc(siriURL())}</div>
      <div><button type="button" class="secondary" id="s-copy">Copy address</button></div>
    </div>
    <div class="field"><label>Apple Pay automation for this phone</label>
      <div class="help">Shortcuts → Automation → <b>+</b> → <b>Transaction</b> → your card → Run Immediately. Add <b>Get Contents of URL</b> with the address below, Method <b>POST</b>, Request Body <b>Form</b>, fields <b>merchant</b> = Merchant, <b>amount</b> = Amount, <b>card</b> = Card or Pass.</div>
      <div class="code" id="s-payurl">${esc(payURL())}</div>
      <div><button type="button" class="secondary" id="s-copy2">Copy address</button></div>
    </div>
    <div class="field"><label>Bank SMS automation for this phone</label>
      <div class="help">Catches every card payment, withdrawal, salary and card payment the bank texts you about. Shortcuts → Automation → <b>+</b> → <b>Message</b> → Message Contains <b>available</b> (the word in every HSBC balance alert; the sender name is not part of the text) → Run Immediately. Add <b>Get Contents of URL</b> with the address below, Method <b>POST</b>, Request Body <b>Form</b>, one field <b>text</b> = Shortcut Input.</div>
      <div class="code" id="s-smsurl">${esc(smsURL())}</div>
      <div><button type="button" class="secondary" id="s-copy3">Copy address</button></div>
    </div>
    <div class="field"><label>This phone</label><button type="button" class="link" id="s-signout" style="text-align:left">Forget the household key on this phone</button></div>
    <div class="actions"><div></div><div class="right"><button type="button" class="secondary" id="s-cancel">Cancel</button><button type="button" class="primary" id="s-save">Save</button></div></div>
  </div>`, root=>{
    wireChips(root); $('s-cancel').onclick=closeSheet;
    root.querySelectorAll('.seg[data-paid] button').forEach(b=>b.addEventListener('click',()=>{ b.parentElement.querySelectorAll('button').forEach(x=>x.classList.toggle('on',x===b)); }));
    root.querySelectorAll('[data-chip="who"]').forEach(b=>b.addEventListener('click',()=>{ $('s-siriurl').textContent=siriURL(b.dataset.val); $('s-payurl').textContent=payURL(b.dataset.val); $('s-smsurl').textContent=smsURL(b.dataset.val); }));
    $('s-copy3').onclick=()=>{ const t=$('s-smsurl').textContent; try{ navigator.clipboard.writeText(t).then(()=>{ $('s-copy3').textContent='Copied'; }, ()=>selectText($('s-smsurl'))); }catch(e){ selectText($('s-smsurl')); } };
    $('s-copy2').onclick=()=>{ const t=$('s-payurl').textContent; try{ navigator.clipboard.writeText(t).then(()=>{ $('s-copy2').textContent='Copied'; }, ()=>selectText($('s-payurl'))); }catch(e){ selectText($('s-payurl')); } };
    $('s-copy').onclick=()=>{ const t=$('s-siriurl').textContent; const done=()=>{ $('s-copy').textContent='Copied'; }; try{ navigator.clipboard.writeText(t).then(done, ()=>{ selectText($('s-siriurl')); }); }catch(e){ selectText($('s-siriurl')); } };
    $('s-signout').onclick=()=>{ closeSheet(); signOut(); };
    $('s-save').onclick=async()=>{ const who=chipVal(root,'who'); if(who){ S.who=who; lsSet('who',who); }
      const members=$('s-members').value.split(',').map(x=>x.trim()).filter(Boolean);
      const people=$('s-people').value.split(',').map(x=>x.trim()).filter(Boolean);
      const cashRules=$('s-cash').value.split(',').map(x=>x.trim()).filter(Boolean); const defaultPaid={}; root.querySelectorAll('.seg[data-paid]').forEach(sg=>{ const on=sg.querySelector('button.on'); if(on) defaultPaid[sg.dataset.paid]=on.dataset.v; });
      const settings={ members: members.length?members:DEFAULT_SETTINGS.members, people, base:$('s-base').value, rates:{USD:1, LBP:Number($('s-lbp').value)||89500, EUR:Number($('s-eur').value)||0.92, AED:Number($('s-aed').value)||3.6725}, budget:Number($('s-budget').value)||null, timezone:$('s-tz').value, goldPrice:Number($('s-gold').value)||null, cashRules, defaultPaid };
      $('s-save').disabled=true; try{ const d=await api('settings',{method:'PUT',body:{settings}}); S.settings={...DEFAULT_SETTINGS,...d.settings}; closeSheet(); render(); toast('Settings saved'); }catch(err){ toast(errMsg(err)); $('s-save').disabled=false; } };
  });
}
function selectText(el){ try{ const r=document.createRange(); r.selectNodeContents(el); const s=window.getSelection(); s.removeAllRanges(); s.addRange(r); }catch(e){} }
function openWhoSheet(){ const members=S.settings.members||[]; openSheet(`<div class="grab"></div><h3>Who is using this phone?</h3><div class="muted" style="font-size:14px">Expenses added from this phone are marked as theirs. Saying "Aya paid…" overrides it.</div><div class="chips" style="gap:10px">${members.map(m=>`<button type="button" class="chip ${m===S.who?'on':''}" data-chip="who" data-val="${esc(m)}" style="padding:12px 20px;font-size:16px"><i class="dot" style="background:${memberColor(m)}"></i>${esc(m)}</button>`).join('')}</div><div style="display:flex;justify-content:flex-end"><button type="button" class="primary" id="w2-save">That's me</button></div>`, root=>{ wireChips(root); $('w2-save').onclick=()=>{ const v=chipVal(root,'who'); if(!v) return; S.who=v; lsSet('who',v); closeSheet(); render(); }; }); }

// ---------- toast ----------
function toast(msg, opts){ const t=$('toast'); $('toastMsg').textContent=msg; $('toastEdit').classList.toggle('hide', !(opts&&opts.edit)); $('toastUndo').classList.toggle('hide', !(opts&&opts.undo)); t.classList.add('show'); clearTimeout(S.toastTimer); S.toastTimer=setTimeout(()=>t.classList.remove('show'), opts&&opts.undo? 9000 : 3000); S.toastActions=opts||{}; }
$('toastUndo').onclick=async()=>{ if(S.toastActions.undo) await S.toastActions.undo(); $('toast').classList.remove('show'); };
$('toastEdit').onclick=()=>{ if(S.toastActions.edit) S.toastActions.edit(); $('toast').classList.remove('show'); };

// ---------- capture ----------
const note=$('note');
function autosize(){ note.style.height='auto'; note.style.height=Math.min(120,note.scrollHeight)+'px'; }
note.addEventListener('input',()=>{ autosize(); lsSet('draft',note.value); });
note.addEventListener('keydown',e=>{ if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); submitNote('text'); } });
if(ls('draft')){ note.value=ls('draft'); autosize(); }
$('addBtn').onclick=()=>submitNote('text');
$('manualBtn').onclick=()=>openExpenseSheet(null);
let busy=false;
async function submitNote(source){
  const text=note.value.trim(); if(!text||busy) return;
  busy=true; const btn=$('addBtn'); btn.disabled=true; btn.textContent='Reading…';
  try{
    const r=await api('expense',{method:'POST',body:{text, by:S.who||'', source}});
    note.value=''; lsSet('draft',null); autosize();
    if(r.draft && r.draft.kind==='transfer'){ note.value=text; lsSet('draft',text); autosize(); toast("Couldn't find the amount to move. Add it and send again."); }
    else if(r.draft){ openExpenseSheet({...r.draft, desc:r.draft.description}); toast("Couldn't find the amount. Fill it in."); }
    else if((r.moves||[]).length && !(r.saved||[]).length){ const m=r.moves[0]; toast(`Moved ${fmtBase(m.usd)} · ${m.desc}`); load(); }
    else{ const saved=r.saved||[]; saved.forEach(addLocal); const total=saved.reduce((a,s)=>a+s.usd,0);
      toast(saved.length===1 ? `Added ${fmtBase(saved[0].usd)} · ${saved[0].desc}` : `Added ${saved.length} expenses · ${fmtBase(total)}`, { undo: async()=>{ for(const s of saved){ try{ await api('expense',{method:'DELETE',body:{id:s.id,month:s.month}}); removeLocal(s.id,s.month); }catch(e){} } toast('Undone'); }, edit: saved.length===1 ? ()=>openExpenseSheet(saved[0]) : null });
      load(); }
  }catch(err){ toast(errMsg(err)); }
  btn.disabled=false; btn.textContent='Add'; busy=false;
}

// ---------- AI analysis ----------
$('aiBtn').onclick=async()=>{
  const out=$('aiOut'); out.textContent='Thinking…'; $('aiStatus').textContent=''; S.aiCtl=new AbortController(); renderInsights();
  try{
    const res=await fetch('/api/analyze',{method:'POST',headers:{'content-type':'application/json','x-ledger-key':S.key},body:JSON.stringify({months:S.range, today:todayKey()}),signal:S.aiCtl.signal});
    if(!res.ok){ const d=await res.json().catch(()=>({})); throw new Error(d.error||('Request failed ('+res.status+')')); }
    const reader=res.body.getReader(); const dec=new TextDecoder(); let txt='';
    while(true){ const {value,done}=await reader.read(); if(done) break; txt+=dec.decode(value,{stream:true}); out.textContent=txt; }
    S.aiDone=true; $('aiStatus').textContent='Based on what is logged so far.';
  }catch(e){ if(e.name==='AbortError'){ $('aiStatus').textContent='Stopped.'; } else { out.textContent=''; $('aiStatus').textContent=e.message||'Something went wrong. Try again.'; } }
  finally{ S.aiCtl=null; renderInsights(); }
};
$('aiStop').onclick=()=>{ if(S.aiCtl) S.aiCtl.abort(); };

// ---------- navigation & events ----------
document.querySelectorAll('nav.tabs button').forEach(b=>b.addEventListener('click',()=>setTab(b.dataset.tab)));
function setTab(t){ S.tab=t; document.querySelectorAll('nav.tabs button').forEach(b=>b.classList.toggle('on',b.dataset.tab===t)); ['add','history','plan','wealth','insights'].forEach(x=>$('s-'+x).classList.toggle('hide',x!==t)); $('scroller').scrollTo(0,0); render(); }
function findItem(id, mk){ return monthItems(mk).find(x=>x.id===id); }
document.addEventListener('click',e=>{
  const li=e.target.closest('li[data-id]');
  if(li){ if(S.selectMode && li.closest('#histList')){ const id=li.dataset.id; if(S.selected.has(id)) S.selected.delete(id); else S.selected.add(id); renderHistory(); return; } const ex=findItem(li.dataset.id, li.dataset.month); if(ex) openExpenseSheet(ex); }
  const lr=e.target.closest('li[data-rec]'); if(lr){ const r=S.recurring.find(x=>x.id===lr.dataset.rec); if(r) openRecurringSheet(r); }
  const lin=e.target.closest('li[data-inc]'); if(lin){ const r=S.income.find(x=>x.id===lin.dataset.inc); if(r) openIncomeSheet(r); }
  const la=e.target.closest('li[data-acc]'); if(la){ const r=S.accounts.find(x=>x.id===la.dataset.acc); if(r) openAccountSheet(r); }
  const lm=e.target.closest('li[data-move]'); if(lm){ const m=(S.moves[lm.dataset.month]||[]).find(x=>x.id===lm.dataset.move); if(m) openMoveSheet(m); }
});
$('transferBtn').onclick=openTransferSheet;
$('addAccBtn').onclick=()=>openAccountSheet(null,false,false); $('addSavedBtn').onclick=()=>openAccountSheet(null,false,true); $('addDebtBtn').onclick=()=>openAccountSheet(null,true,false);
$('hSelect').onclick=()=>{ S.selectMode=true; S.selected=new Set(); renderHistory(); };
$('selCancel').onclick=()=>{ S.selectMode=false; S.selected=new Set(); renderHistory(); };
$('selAll').onclick=()=>{ const vis=S.visibleIds||[]; const allOn = vis.length && vis.every(id=>S.selected.has(id)); S.selected = allOn? new Set() : new Set(vis); renderHistory(); };
$('selDel').onclick=async()=>{ const btn=$('selDel'); const ids=[...S.selected].filter(id=>(S.visibleIds||[]).includes(id)); if(!ids.length) return;
  if(!btn.dataset.arm){ btn.dataset.arm='1'; btn.textContent='Tap again to delete '+ids.length; setTimeout(()=>{ delete btn.dataset.arm; if(S.selectMode) renderHistory(); },4000); return; }
  delete btn.dataset.arm; btn.disabled=true; btn.textContent='Deleting…';
  const items=ids.map(id=>{ const e=monthItems(S.hMonth).find(x=>x.id===id); return e? {id:e.id, month:e.month} : null; }).filter(Boolean);
  try{ const d=await api('expenses/delete',{method:'POST',body:{items}}); items.forEach(x=>{ if(S.months[x.month]) S.months[x.month]=S.months[x.month].filter(e=>e.id!==x.id); }); S.selected=new Set(); S.selectMode=false; toast('Deleted '+(d.removed??items.length)+' expenses'); render(); load(); }
  catch(err){ toast(errMsg(err)); renderHistory(); } };
$('addIncBtn').onclick=()=>openIncomeSheet(null);
$('hFilters').addEventListener('click',e=>{ const b=e.target.closest('button'); if(!b) return; if(b.dataset.by){ S.hFilter.by = S.hFilter.by===b.dataset.by? null : b.dataset.by; } if(b.dataset.tag){ S.hFilter.tag = S.hFilter.tag===b.dataset.tag? null : b.dataset.tag; } renderHistory(); });
$('hPrev').onclick=()=>{ S.hMonth=shiftMonth(S.hMonth,-1); S.selected=new Set(); renderHistory(); }; $('hNext').onclick=()=>{ if(!$('hNext').disabled){ S.hMonth=shiftMonth(S.hMonth,1); S.selected=new Set(); renderHistory(); } };
$('addRecBtn').onclick=()=>openRecurringSheet(null);
$('settingsBtn').onclick=openSettingsSheet;
$('whoBtn').onclick=openWhoSheet;
let rt; window.addEventListener('resize',()=>{ clearTimeout(rt); rt=setTimeout(()=>{ if(S.tab==='insights') renderInsights(); },150); });
function startPolling(){ clearInterval(S.pollTimer); S.pollTimer=setInterval(()=>{ if(document.visibilityState==='visible') load(); }, 30000); }
document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='visible') load(); });
window.addEventListener('focus',()=>load());
if(!isStandalone() && /iPhone|iPad/.test(navigator.userAgent) && !ls('installDismissed')) $('installBanner').classList.remove('hide');
$('installClose').onclick=()=>{ $('installBanner').classList.add('hide'); lsSet('installDismissed','1'); };
if('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(()=>{});

// ---------- boot ----------
render();
if(!S.key){ showWelcome(); }
else { load().then(()=>{ if(S.loaded && !S.who) openWhoSheet(); }); startPolling(); }
