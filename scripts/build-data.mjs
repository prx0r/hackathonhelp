import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const seed = JSON.parse(fs.readFileSync(path.join(ROOT,'data/seed.json'),'utf8'));
const now = Date.now();

// ---------- deterministic metrics ----------
const regs = seed.opportunities.map(o=>o.registrants).filter(x=>x>0).sort((a,b)=>a-b);
const medianReg = regs.length ? regs[Math.floor(regs.length/2)] : 100;

function daysLeft(o){ return o.ends_at ? Math.ceil((new Date(o.ends_at) - now)/86400000) : null; }

function oddsScore(o){
  const ppr = equalShare(o);
  if (ppr == null) return null;
  if (ppr >= 50) return 100; if (ppr >= 20) return 85; if (ppr >= 10) return 70;
  if (ppr >= 5) return 55; if (ppr >= 2) return 40; if (ppr >= 0.5) return 25;
  return 10;
}
function valueScore(o){
  if (!o.prize_usd) return null;
  return Math.min(100, Math.round(Math.log10(o.prize_usd+1)/Math.log10(1000000)*100));
}
function equalShare(o){
  if (!o.prize_usd || !o.registrants) return null;
  return +(o.prize_usd / Math.max(1,o.registrants)).toFixed(2);
}

function megaDetect(o, m){
  const reasons=[]; let score=0;
  if (m.equal_share != null && m.equal_share >= 20){ reasons.push(`$${m.equal_share} fair-share per entrant`); score+=35; }
  else if (m.equal_share >= 8){ reasons.push(`$${m.equal_share} fair-share per entrant`); score += 22; }
  if (o.prize_usd >= 100000 && o.registrants < medianReg){ reasons.push(`$${Math.round(o.prize_usd/1000)}K prize with below-median competition`); score += 30; }
  if (m.days_left != null && m.days_left >= 3 && m.days_left <= 14 && m.odds_score >= 55){ reasons.push('closing soon with good odds'); score += 15; }
  if (!reasons.length || score < 30) return null;
  return { score: Math.min(100, Math.round(score)), reasons,
    category: reasons.some(r=>r.includes('closing')) ? 'deadline_edge' :
              reasons.some(r=>r.includes('below-median')) ? 'value_competition_gap' : 'high_fair_share' };
}

const rows = seed.opportunities.map(o => {
  const dl = daysLeft(o);
  const m = {
    days_left: dl, equal_share: equalShare(o),
    value_score: valueScore(o), odds_score: oddsScore(o),
    registrant_percentile: o.registrants ? Math.round(100 * regs.filter(r=>r<=o.registrants).length / regs.length) : null,
  };
  // composite: value 40 / odds 35 / urgency+access 25
  const urgency = m.days_left==null ? 0.5 : m.days_left<0 ? 0 : m.days_left<=7 ? 1 : m.days_left<=21 ? 0.8 : m.days_left<=60 ? 0.6 : 0.4;
  const access = o.location_type==='online' ? 1 : 0.7;
  m.opportunity_score = Math.round(
    ((m.value_score??0)*0.40 + (m.odds_score??0)*0.35 + urgency*12 + access*13));
  row = { ...o, metrics:m, mega: megaDetect(o,m), status: dl==null?'unknown':dl<0?'ended':dl<=7?'closing_soon':'open' };
  return row;
});

const top = rows.filter(r=>r.status!=='ended')
  .sort((a,b)=> b.metrics.opportunity_score - a.metrics.opportunity_score)
  .filter((r,i,arr)=> arr.findIndex(x=>x.organizer===r.organizer)===i || true)
  .slice(0,5);

// ---------- change tracking ----------
const histDir = path.join(ROOT,'data/history'); fs.mkdirSync(histDir,{recursive:true});
const latestPath = path.join(histDir,'latest.json');
const prev = fs.existsSync(latestPath)? JSON.parse(fs.readFileSync(latestPath,'utf8')) : null;
const changes=[];
if (prev){
  const byId = Object.fromEntries(prev.opportunities.map(o=>[o.id,o]));
  for (const o of seed.opportunities){
    const b=byId[o.id];
    if(!b){changes.push({id:o.id,type:'added',detected_at:new Date().toISOString()});continue;}
    for(const k of ['prize_usd','registrants','ends_at','time_left']){
      if(JSON.stringify(b[k])!==JSON.stringify(o[k]))
        changes.push({id:o.id,type:'changed',field:k,old:b[k],new:o[k],detected_at:new Date().toISOString()});
    }
  }
}
fs.writeFileSync(latestPath, JSON.stringify(seed,null,2));
const dated = path.join(histDir, `${new Date().toISOString().slice(0,10)}-seed.json`);
if(!fs.existsSync(dated)) fs.writeFileSync(dated, JSON.stringify(seed,null,2));

fs.mkdirSync(path.join(ROOT,'web/src/data'),{recursive:true});
fs.mkdirSync(path.join(ROOT,'web/public/api/v1'),{recursive:true});
const payload = {generated_at:new Date().toISOString(), schema_version:'hackathonhelp.api.v1',
  counts:{opportunities:rows.length, open:rows.filter(r=>r.status!=='ended').length, mega:rows.filter(r=>r.mega).length},
  top, opportunities:rows, changes};
for (const [f,obj] of [['top',{deals:top}],['opportunities',payload],['changes',{changes}]])
  fs.writeFileSync(path.join(ROOT,`web/public/api/v1/${f}.json`), JSON.stringify({generated_at:payload.generated_at, schema_version:payload.schema_version, ...obj},null,2));
fs.writeFileSync(path.join(ROOT,'web/src/data/derived.json'), JSON.stringify(payload,null,2));
console.log(`build-data: ${rows.length} opps, ${payload.counts.mega} mega, ${changes.length} changes`);
var row; // hoisted usage above
