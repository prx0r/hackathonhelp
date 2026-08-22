// Multi-source discovery: Devpost official API + Brabble API (key).
// Audience filter: online, individual-friendly, non-student, English/global.
import fs from 'node:fs';
import path from 'node:path';
import 'dotenv/config';

const ROOT = path.resolve(import.meta.dirname, '..');
const PAGES = parseInt(process.env.PAGES || '8');
const KEY = process.env.BRABBLE_API_KEY;

function parsePrize(html){ if(!html) return null; const m=String(html).match(/data-currency-value>([\d,.]+)</); const n=m?m[1]:(String(html).match(/([\d,.]+)/)?.[1]); return n?parseFloat(n.replace(/,/g,''))||null:null; }
function parseDates(str){ const m=str?.match(/(\w{3}) (\d+) - (\w{3}) (\d+), (\d+)/); if(!m) return {}; const M={Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11}; return { starts_at:new Date(Date.UTC(+m[5],M[m[1]],+m[2])).toISOString(), ends_at:new Date(Date.UTC(+m[5],M[m[3]],+m[4],23,59)).toISOString() }; }
function slugify(u){
  try{
    const url=new URL(u);
    const parts=url.pathname.split('/').filter(Boolean);
    const tail=parts[parts.length-1]||'';
    const host=url.hostname.replace(/^www\./,'').split('.')[0];
    const base=(tail&&tail.length>3?tail:host)||'event';
    return `${host}-${base}`.toLowerCase().replace(/[^a-z0-9-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,60)||'event';
  }catch{ return 'ev-'+Math.abs([...u].reduce((a,c)=>a*31+c.charCodeAt(0)|0,7)).toString(36); }
}

const seen=new Set(); const opportunities=[];

// ---- source 1: Devpost (official platform API) ----
for(let p=1;p<=PAGES;p++){
  const d=await (await fetch(`https://devpost.com/api/hackathons?page=${p}`)).json();
  for(const h of d.hackathons??[]){
    if(!h.url||seen.has(h.url)) continue;
    const dkey='dp|'+(h.title||'').toLowerCase().replace(/[^a-z0-9]+/g,'').slice(0,40);
    if(seen.has(dkey)) continue; seen.add(h.url); seen.add(dkey);
    const dates=parseDates(h.submission_period_dates);
    opportunities.push({
      id:'dp-'+slugify(h.url), slug:slugify(h.url),
      title:h.title, organizer:h.organization||h.title.split(' ')[0],
      prize_usd:parsePrize(h.prize_amount), prize_raw:(v=>v==='$0'?'':v)((h.prize_amount||'').replace(/<[^>]*>/g,'').trim()),
      registrants:h.registrations_count??null,
      starts_at:dates.starts_at??null, ends_at:dates.ends_at??null,
      time_left:h.time_left_to_submission||null,
      location_type:/online/i.test(h.displayed_location?.location||'')?'online':'in-person',
      location:h.displayed_location?.location||'Unknown',
      themes:(h.themes||[]).map(t=>t.name), open_to_all:!h.private,
      source_url:h.url, source:'devpost', source_authority:'official_platform_api',
      observed_at:new Date().toISOString(),
    });
  }
}
const devpostCount = opportunities.length;

// ---- source 2: Brabble (key) → global-online-non-student filter ----
let brabbleKept=0, brabbleSkippedStudent=0, brabbleSkippedOffline=0;
if(KEY){
  for(let offset=0; offset<700; offset+=100){
    let d;
    try{
      const r=await fetch(`https://brabble.ai/api/listings?limit=100&offset=${offset}`,
        {headers:{'Authorization':`Bearer ${KEY}`}});
      if(!r.ok){ console.error('brabble',r.status); break; }
      d=await r.json();
    }catch(e){ console.error('brabble fail',e.message); break; }
    for(const l of (d.listings??[])){
      if(l.type!=='HACKATHON') continue;
      if(seen.has(l.url)) continue;
      const bkey='br|'+(l.title||'').toLowerCase().replace(/[^a-z0-9]+/g,'').slice(0,40);
      if(seen.has(bkey)||seen.has('dp|'+(l.title||'').toLowerCase().replace(/[^a-z0-9]+/g,'').slice(0,40))) continue;
      seen.add(bkey);
      if(l.mode!=='ONLINE'){ brabbleSkippedOffline++; continue; }          // audience: online
      const el=l.eligibility??[];
      if(el.includes('Education')){ brabbleSkippedStudent++; continue; }   // audience: non-student
      if(/india|indian/i.test(`${l.title} ${l.organiser} ${el.join(' ')}`)&&!el.includes('Open to all')){ brabbleSkippedStudent++; continue; }
      seen.add(l.url);
      const prizeNum = l.prize?.label ? parseFloat(String(l.prize.label).replace(/[^0-9.]/g,''))||null : null;
      opportunities.push({
        id:'br-'+slugify(l.url), slug:'br-'+slugify(l.url),
        title:l.title, organizer:(l.organiser&&l.organiser!=='null'&&l.organiser!=='—')?l.organiser:null,
        prize_usd: prizeNum, prize_raw:(v=>/^(\$0|see listing|null|tba)$/i.test(v||'')?null:v)((l.prize?.label||'').trim()),
        registrants:l.registered??null,
        starts_at:null, ends_at:l.deadline||null,
        time_left:l.deadline?Math.ceil((new Date(l.deadline)-Date.now())/86400000)+' days left':null,
        location_type:'online', location:'Online',
        themes:[], open_to_all:true,
        source_url:l.url, source:'brabble',
        source_authority: el.length? 'platform_metadata_unverified':'unverified',
        observed_at:new Date().toISOString(),
        eligibility_flags: el,
      });
      brabbleKept++;
    }
    if((d.offset??0)+(d.count??0)>=d.total) break;
  }
}

opportunities.sort((a,b)=>(b.prize_usd||0)-(a.prize_usd||0));
fs.mkdirSync(path.join(ROOT,'data'),{recursive:true});
fs.writeFileSync(path.join(ROOT,'data/seed.json'), JSON.stringify({
  schema_version:'hackathonhelp.seed.v2',
  generated_at:new Date().toISOString(),
  sources:{devpost:devpostCount, brabble_kept:brabbleKept},
  count:opportunities.length,
  opportunities
},null,2));
console.log(`fetch: devpost=${devpostCount} + brabble=${brabbleKept} (skipped student:${brabbleSkippedStudent}, offline:${brabbleSkippedOffline}) = ${opportunities.length}`);
