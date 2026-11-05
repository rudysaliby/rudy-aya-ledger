// Siri Shortcut endpoint: GET or POST /siri?key=…&by=Rudy&text=forty five groceries
// Replies with one plain sentence Siri can read out. Books exactly like the app: expenses leave cash in hand
// (or the member's default account), "moved 2000 to cash" is a transfer.
import { HttpError, checkAuth, text, getSettings, parseNote, todayIn, fmt, memberName } from "../lib/ledger.mjs";
import { bookItems } from "../lib/book.mjs";


export default async (req) => {
  try{
    checkAuth(req);
    const url = new URL(req.url);
    let note = url.searchParams.get('text') || '';
    let by = url.searchParams.get('by') || '';
    if(req.method==='POST'){
      const ct = req.headers.get('content-type')||'';
      if(ct.includes('json')){ const b=await req.json().catch(()=>({})); note=b.text||note; by=b.by||by; }
      else if(ct.includes('form')){ const f=await req.formData().catch(()=>null); if(f){ note=f.get('text')||note; by=f.get('by')||by; } }
      else { const t=await req.text().catch(()=>''); if(t && !note) note=t; }
    }
    note=String(note).trim().slice(0,500);
    if(!note) return text("I didn't catch an expense. Say the amount and what it was for.");
    const settings = await getSettings();
    const who = memberName(settings, by) || String(by||'').slice(0,40);
    const today = todayIn(settings.timezone);
    const {items} = await parseNote(settings, note, today);
    const r = await bookItems(settings, items, {by: who, source:'siri', today});
    if(r.draft) return text(`I heard "${note}" but couldn't find an amount. Try again with the number first.`);
    const parts=[];
    for(const m of r.moves) parts.push(`Moved ${fmt(settings, m.usd)}, ${m.desc}.`);
    if(r.saved.length===1){ const s=r.saved[0]; parts.push(`Added ${fmt(settings, s.usd)}, ${s.desc}, ${s.tag}${s.by?' for '+s.by:''}.`); }
    else if(r.saved.length>1){ const total=r.saved.reduce((a,s)=>a+s.usd,0); parts.push(`Added ${r.saved.length} expenses, ${fmt(settings,total)} in total: `+r.saved.map(s=>`${fmt(settings,s.usd)} ${s.desc}`).join(', ')+'.'); }
    return text(parts.join(' ') || 'Nothing to add.');
  }catch(e){
    const status = e instanceof HttpError ? e.status : 500;
    return text(status===401 ? 'The household key in the shortcut is wrong.' : ('Could not save: '+(e.message||'server error')), status);
  }
};
