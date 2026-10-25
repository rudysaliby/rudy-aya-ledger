// Siri Shortcut endpoint: GET or POST /siri?key=…&by=Rudy&text=forty five groceries
// Replies with one plain sentence Siri can read out.
import { HttpError, checkAuth, text, getSettings, parseNote, saveExpenses, todayIn, fmt, memberName } from "../lib/ledger.mjs";

export const config = { path: "/siri" };

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
    if(items.length===1 && !(items[0].amount>0)) return text(`I heard "${note}" but couldn't find an amount. Try again with the number first.`);
    const saved = await saveExpenses(settings, items, {by: who, source:'siri'});
    if(saved.length===1){ const s=saved[0]; const whoTxt = s.by ? ` for ${s.by}` : ''; return text(`Added ${fmt(settings, s.usd)}, ${s.desc}, ${s.tag}${whoTxt}.`); }
    const total=saved.reduce((a,s)=>a+s.usd,0);
    return text(`Added ${saved.length} expenses, ${fmt(settings,total)} in total: `+saved.map(s=>`${fmt(settings,s.usd)} ${s.desc}`).join(', ')+'.');
  }catch(e){
    const status = e instanceof HttpError ? e.status : 500;
    return text(status===401 ? 'The household key in the shortcut is wrong.' : ('Could not save: '+(e.message||'server error')), status);
  }
};
