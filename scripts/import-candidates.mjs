// Import ChatGPT-discovered candidates after validation.
// Usage: node scripts/import-candidates.mjs data/candidates/chatgpt-2026-09-01.json
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const file = process.argv[2];
if (!file) { console.error('usage: import-candidates.mjs <candidates.json>'); process.exit(2); }

const raw = JSON.parse(fs.readFileSync(file,'utf8'));
const arr = Array.isArray(raw) ? raw : raw.candidates ?? [];
const seed = JSON.parse(fs.readFileSync(path.join(ROOT,'data/seed.json'),'utf8'));

const knownUrls = new Set(seed.opportunities.map(o=>o.source_url));
const knownTitles = new Set(seed.opportunities.map(o=>o.title.toLowerCase().replace(/[^a-z0-9]/g,'').slice(0,32)));

let added=0, rejected=0;
for (const c of arr) {
  const errs=[];
  if (!c.title) errs.push('no title');
  if (!c.source_url?.startsWith('https://')) errs.push('source_url must be full https link');
  if (c.location_type && !['online','hybrid'].includes(c.location_type)) errs.push('not online/hybrid: '+c.location_type);
  if (c.eligibility?.student_only===true) errs.push('student-only rejected by audience filter');
  if ((c.prize?.advertised_value_usd??0) < 1000 && c.strategic_fit_agent_reliability==='NONE') errs.push('prize <$1k and no strategic fit');
  if (knownUrls.has(c.source_url)) { console.log('  skip (already tracked):', c.title); continue; }
  if (knownTitles.has(c.title.toLowerCase().replace(/[^a-z0-9]/g,'').slice(0,32))) { console.log('  skip (title match):', c.title); continue; }
  if (errs.length) { console.log('  REJECT', c.title, '::', errs.join('; ')); rejected++; continue; }

  seed.opportunities.push({
    id:'cand-'+c.source_url.replace(/https:\/\/([^./]+).*/,'$1')+'-'+(c.title.toLowerCase().replace(/[^a-z0-9]+/g,'-').slice(0,30)),
    slug:c.title.toLowerCase().replace(/[^a-z0-9]+/g,'-').slice(0,60),
    title:c.title, organizer:c.organizer||null,
    prize_usd:c.prize?.cash_value_usd ?? c.prize?.advertised_value_usd ?? null,
    prize_raw:c.prize?.advertised_value_usd!=null ? '$'+Math.round(c.prize.advertised_value_usd).toLocaleString() : null,
    registrants:c.registrants??null,
    starts_at:c.starts_at??null, ends_at:c.ends_at??null,
    time_left:c.time_left_summary??null,
    location_type:c.location_type==='in-person'?'in-person':'online',
    location:c.location_type==='online'?'Online':(c.location_type||'Unknown'),
    themes:c.themes??[], open_to_all:true,
    source_url:c.source_url, source:'chatgpt-research',
    source_authority:c.eligibility?.confidence ?? 'unverified',
    observed_at:new Date().toISOString(),
    candidate_metadata:{
      rules_url:c.rules_url??null,
      prize_breakdown:c.prize??null,
      judging:c.judging_summary??null,
      originality:c.originality??null,
      requirement_notes:c.requirement_notes??null,
      why_worth_entering:c.why_worth_entering??null,
      catch:c.catch??null,
      strategic_fit:c.strategic_fit_agent_reliability??null
    }
  });
  added++;
}
fs.writeFileSync(path.join(ROOT,'data/seed.json'), JSON.stringify(seed,null,2));
console.log(`import: ${added} added, ${rejected} rejected, seed now ${seed.opportunities.length}`);
