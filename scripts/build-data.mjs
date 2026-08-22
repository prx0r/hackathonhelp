// HackathonHelp engine v2 — pipeline per docs: gates → prize normalization →
// field estimation (family priors) → score v0.1 → mega detection
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const seed = JSON.parse(fs.readFileSync(path.join(ROOT,'data/seed.json'),'utf8'));
const OV = JSON.parse(fs.readFileSync(path.join(ROOT,'data/overrides.json'),'utf8'));
const now = Date.now();

function findOverride(o){
  const hay = `${o.slug} ${o.title}`.toLowerCase().replace(/[^a-z0-9]+/g,'-');
  return {
    patch: OV.patches.find(p => hay.includes(p.match)) ?? null,
    exclusion: OV.exclusions.find(e => hay.includes(e.match)) ?? null,
  };
}

// ---------- stage 1: rule verification / hard gates ----------
function applyGates(o){
  const {patch, exclusion} = findOverride(o);
  const dl = o.ends_at ? Math.ceil((new Date(o.ends_at)-now)/86400000) : null;
  const gates = {
    registration_open: dl==null ? null : dl>=0,
    deadline_future: dl==null ? null : dl>0,
    remote_ok: o.location_type==='online' ? true : null,
    age_confirmed: exclusion ? false
      : (patch?.eligibility_unverified ? null
      : (patch && patch.note ? true : null)),  // UNKNOWN until rules verified
    student_only: false,
    country_restricted: null,
  };
  let eligible = true; const failed = [];
  if (exclusion){ eligible=false; failed.push(exclusion.reason); }
  if (gates.deadline_future === false) eligible=false, failed.push('deadline passed');
  // Audience gate: online-only (builder cannot attend physical venues)
  if (o.location_type !== 'online'){ eligible=false; failed.push(`in-person event (${o.location||'venue-based'})`); }
  if (!o.prize_usd && !patch) {/* no prize data yet — not disqualifying */}
  return {...o, days_left:dl, gates,
    eligibility:{ eligible, failed, confidence: exclusion?'official_rules':(patch?'official_rules':'platform_metadata_unverified'),
      notes: patch?.note ?? exclusion?.reason ?? null }};
}

// ---------- stage 2: prize normalization ----------
function normalizePrize(o){
  const p = OV.patches.find(x=>`${o.slug} ${o.title}`.toLowerCase().includes(x.match));
  let cash = p?.prize_cash !== undefined ? p.prize_cash : (o.prize_usd ?? null);
  if (p?.headline_caution && p.prize_cash === undefined) cash = null; // API prize treated as cash unless overridden
  const credits = p?.prize_credits ?? null;
  const advertised = p?.prize_advertised ?? cash ?? credits;
  const M = OV.multipliers;
  const normalized = cash!=null || credits!=null
    ? Math.round((cash??0)*M.cash + (credits??0)*M.compute_api_credits) : null;
  return {advertised_value:advertised, cash_value:cash, credits_value:credits,
    hardware_value:null, normalized_value:normalized,
    headline_inflation: advertised&&normalized ? +(100*(1-normalized/advertised)).toFixed(0) : null};
}

// ---------- stage 3: field estimation ----------
function estimateField(o){
  const p = OV.patches.find(x=>`${o.slug} ${o.title}`.toLowerCase().includes(x.match));
  const prior = p?.family_prior ?? OV.default_family_prior;
  const regs = o.registrants ?? null;
  // Registration counts grow toward the deadline. A tiny count on an event
  // that's weeks from closing is NOT a real field — mark it unreliable
  // instead of extrapolating a fake denominator (the AMD ACT III case).
  const forming = o.days_left!=null && o.days_left>45 && regs!=null && regs<500;
  const unreliable = forming || regs==null || regs<25;
  const rate = regs>=1000 ? prior.submissions_per_registration
    : regs>=500 ? Math.max(prior.submissions_per_registration,0.08)
    : regs>=200 ? 0.12 : regs>=75 ? 0.20 : 0.35;
  const p50 = (!unreliable && regs!=null) ? Math.max(1, Math.round(regs * rate)) : null;
  return {
    registrations: regs,
    family_prior: prior,
    field_status: unreliable ? 'forming' : 'usable',
    estimated_serious_field: p50,
    field_p10: p50!=null? Math.max(1,Math.round(p50*0.65)) : null,
    field_p50: p50,
    field_p90: p50!=null? Math.round(p50*1.55) : null,
    funnel: null,
  };
}

// ---------- stage 4: score v0.1 ----------
function valueScore(prize){
  if (prize==null) return null;
  return Math.min(100, Math.round(Math.log10(prize+1)/Math.log10(1000000)*100));
}
function expectedPrizeValueScore(norm, field){
  if (norm==null || field==null) return null;
  const perSubmission = norm/field;
  if (perSubmission >= 500) return 100; if (perSubmission >= 200) return 85;
  if (perSubmission >= 80) return 70;   if (perSubmission >= 30) return 55;
  if (perSubmission >= 10) return 40;   return 20;
}
// Winnability answers ONLY: "if I submit a competitive entry, what are my odds?"
// Deadline is handled separately by the feasibility/decision layer.
function winnability(fieldP50, payingSlots){
  if (fieldP50==null || fieldP50<=0) return null;
  const K = payingSlots ?? 6;               // default slot assumption when ladder unknown
  const baseline = Math.min(0.9, K / fieldP50);
  const logit = Math.log(baseline/(1-baseline));
  const pPaid = 1/(1+Math.exp(-(logit + 0)));  // skill_edge = 0 until builder profile exists
  return Math.round(pPaid*100);
}
const WEIGHTS = [ // user spec v0.1; null components are renormalized away
  ['expected_prize_value', .25], ['winnability', .15], ['organizer_quality', .10],
];
function computeScore(o, np, field){
  const p = OV.patches.find(x=>`${o.slug} ${o.title}`.toLowerCase().includes(x.match));
  const comps = {};
  comps.expected_prize_value = expectedPrizeValueScore(np.normalized_value, field.estimated_serious_field);
  comps.winnability = winnability(field.estimated_serious_field, o.days_left);
  comps.organizer_quality = p?.organizer_quality != null ? Math.round(p.organizer_quality*100) : null;
  // fit/judging/winner-quality/portfolio: require builder profile or richer data — v0.2
  const avail = WEIGHTS.filter(([k])=>comps[k]!=null);
  const tw = avail.reduce((s,[,w])=>s+w,0);
  const score = avail.reduce((s,[k,w])=>s+comps[k]*w/tw, 0);
  const CONF_MULT = { official_rules:1.00, platform_metadata_verified:0.95, platform_metadata_unverified:0.80, inferred:0.65 };
  const confMul = CONF_MULT[o.eligibility.confidence] ?? 0.60;
  const known = Object.values(comps).filter(v=>v!=null).length;
  const completeness_bonus = Math.round((known/7)*8); // up to +8 for fully-characterized opps
  return {components:comps, known_components:known,
    opportunity_score: Math.round(score*confMul)+completeness_bonus};
}

// ---------- run pipeline in order ----------
let rows = seed.opportunities.map(o => applyGates(o))
  .map(o => ({...o, prize:normalizePrize(o)}))
  .map(o => ({...o, field:estimateField(o)}));

// ---- CONFIG: build model (replaced by reference-class history later) ----
const BUILD = { p50_hours:25, p80_hours:40, hours_per_day:4, buffer_days:2, reuse_fraction:0 };
const SLOTS_DEFAULT = { p10:3, p50:6, p90:12 };

function feasibilityPrior(d){
  if (d==null) return 0.35;
  if (d<1) return 0.10;
  if (d<=2) return 0.25;
  if (d<=3) return 0.45;
  if (d<=5) return 0.65;
  if (d<=7) return 0.80;
  if (d<=10) return 0.90;
  if (d<=14) return 0.97;
  return 1.00;                       // 14+d and 30+ never penalized
}
const FEAS_LABEL={0.1:'<1d',0.25:'1-2d',0.45:'2-3d',0.65:'3-5d',0.8:'5-7d',0.9:'7-10d',0.97:'10-14d',1:'14d+'};

for (const r of rows){
  const slotsKnown = false;          // ladder data not yet collected from pages
  r.slots = slotsKnown ? null : SLOTS_DEFAULT;
  r.score_v01 = r.eligibility.eligible ? computeScore(r, r.prize, r.field) : {opportunity_score:null};
  // fair-shares
  r.metrics = {
    equal_share_naive: r.prize.advertised_value!=null && r.field.registrations ? +((r.prize.advertised_value)/r.field.registrations).toFixed(2) : null,
    fair_share_serious: r.prize.normalized_value!=null && r.field.estimated_serious_field ? +((r.prize.normalized_value)/r.field.estimated_serious_field).toFixed(2) : null,
    days_left: r.days_left,
  };
  // ---------- mega detection on serious numbers ----------
  const reasons=[]; let ms=0;
  const fs2 = r.field.field_status==='usable' ? r.metrics.fair_share_serious : null;
  if (fs2!=null && fs2>=100){reasons.push(`$${fs2} normalized prize per estimated submission`);ms+=35;}
  else if (fs2!=null && fs2>=40){reasons.push(`$${fs2} normalized prize per estimated submission`);ms+=22;}
  if (r.prize.cash_value>=25000 && r.field.registrations<medianReg(rows)){reasons.push(`$${Math.round(r.prize.cash_value/1000)}K cash with below-median registration`);ms+=30;}
  if (r.days_left!=null && r.days_left>=3 && r.days_left<=14 && ((r.score_v01.components&&r.score_v01.components.winnability)??0)>=60){reasons.push('closing soon with good odds');ms+=15;}
  if (r.prize.headline_inflation>=50) reasons.push(`⚠ ${r.prize.headline_inflation}% of headline is non-cash`);
  // Legitimacy sanity: extraordinary per-submission value on thin fields warrants verification
  const cautions = r.cautions || [];
  if ((r.prize_raw??'')==='' || /^(see listing|null|tba)$/i.test(r.prize_raw??'')){
    cautions.push('prize not published on platform card — see official page');
  }
  if (r.metrics.fair_share_serious!=null && r.metrics.fair_share_serious>2500) cautions.push('extraordinary per-submission value — verify payout history');
  if ((r.prize.advertised_value??0)>=50000 && (r.field.registrations??999)<150) cautions.push('large pool, very early/small field — confirm organizer track record');
  if (r.prize.headline_inflation>=50) cautions.push(`${r.prize.headline_inflation}% of headline is non-cash`);
  r.cautions=cautions;
  if (cautions.length && r.score_v01.opportunity_score!=null) r.score_v01.opportunity_score=Math.max(0,r.score_v01.opportunity_score-10);
  // ---- payout probability + cash EV heuristic ----
  const fieldN = r.field.field_status==='usable' ? r.field.field_p50 : null;
  const K = r.slots.p50;
  const baseP = fieldN ? Math.min(0.9, K/fieldN) : null;
  r.payout = {
    paying_slots: r.slots,
    baseline_any_payout: baseP!=null? +(baseP).toFixed(3) : null,
    p_paid: baseP!=null? +(1/(1+Math.exp(-Math.log(baseP/(1-baseP))))).toFixed(3) : null,
    ev_cash_heuristic: (baseP!=null && r.prize.normalized_value!=null)
      ? Math.round(r.prize.normalized_value * (1/(1+Math.exp(-Math.log(baseP/(1-baseP)))))) : null,
    note: 'slot count assumed until prize ladders are verified on official pages',
  };

  // ---- DECISION LAYER (v0.2): feasibility + latest safe start + state ----
  const dl=r.days_left;
  const feas=feasibilityPrior(dl);
  const p80Days=Math.ceil((BUILD.p80_hours*(1-BUILD.reuse_fraction))/BUILD.hours_per_day);
  const latestSafeStart = (dl!=null && r.ends_at)
    ? new Date(new Date(r.ends_at).getTime() - (p80Days+BUILD.buffer_days)*86400000).toISOString().slice(0,10)
    : null;
  const daysUntilMustStart = (dl!=null)? dl-(p80Days+BUILD.buffer_days) : null;

  let action='WATCH'; let action_reason='';
  if(!r.eligibility.eligible){action='SKIP'; action_reason='eligibility gate failed';}
  else if(dl!=null && dl<0){action='ENDED'; action_reason='submission window closed';}
  else if(r.score_v01.opportunity_score==null){action='SKIP'; action_reason='unscoreable';}
  else{
    const opp=r.score_v01.opportunity_score;
    if(dl==null){action='WATCH'; action_reason='deadline not published';}
    else if(feas>=0.65 && dl<=14){
      if(opp>=80){action='ENTER NOW'; action_reason=`strong opportunity (${opp}) inside comfortable build window`;}
      else if(opp>=65){action='SPRINT'; action_reason=`tight but real (${FEAS_LABEL[feas]} finish prior ${(feas*100)|0}%)`;}
      else {action='SKIP'; action_reason='weak opportunity for remaining time';}
    } else if(daysUntilMustStart<=0){
      action = opp>=65 ? 'ENTER NOW' : 'SKIP';
      action_reason = opp>=65?'latest-safe-start reached — commit now or skip':'window reached, opportunity weak';
    } else if(daysUntilMustStart<=21){
      action = opp>=62 ? 'PREP' : 'WATCH';
      action_reason = opp>=62?`commit by ${latestSafeStart}`:'marginal — recheck as field matures';
    } else {
      action = (opp>=68 && r.prize.normalized_value!=null) ? 'PREP' : 'WATCH';
      action_reason = r.prize.normalized_value==null ? 'prize unconfirmed — waiting reveals tracks/prizes' : `far out; latest safe start ${latestSafeStart}`;
    }
    if(confidenceCapApplied) action_reason += ' · capped: prize unconfirmed';
  }
  r.decision={action, reason:action_reason, feasibility:+feas.toFixed(2),
    feasibility_label:FEAS_LABEL[feas]||String(feas), latest_safe_start:latestSafeStart,
    p_finish_proxy:+feas.toFixed(2), build_model:BUILD};

  // Unconfirmed prizes rank below verified ones regardless of other factors
  // (user spec: 'Real cash known now' column matters; ETHGlobal reputation is the exception via organizer quality)
  var confidenceCapApplied=false;
  if (r.prize.normalized_value==null && r.score_v01.opportunity_score!=null){
    r.score_v01.opportunity_score=Math.min(r.score_v01.opportunity_score,85);
    r.cautions.push('prize pool not yet announced — rescore when tracks land');
    confidenceCapApplied=true;
  }
  r.cautions=[...new Set(r.cautions)];
  r.mega = (r.eligibility.eligible && reasons.length && ms>=30)
    ? {score:Math.min(100,Math.round(ms)), reasons, category: fs2!=null&&fs2>=40?'value_competition_gap': reasons.some(x=>x.includes('closing'))?'deadline_edge':'high_fair_share'}
    : null;
}
function medianReg(rows){const a=rows.map(r=>r.field.registrations).filter(x=>x>0).sort((x,y)=>x-y);return a.length?a[Math.floor(a.length/2)]:500;}

// ---------- ORDERING derives from DECISION LAYER ----------
// ENTER NOW > SPRINT > PREP > WATCH > SKIP/ENDED; ties broken by opportunity.
const ACTION_RANK={'ENTER NOW':400,'SPRINT':350,'PREP':300,'WATCH':200,'SKIP':-1,'ENDED':-2};
for (const r of rows){
  const sc=r.score_v01.opportunity_score;
  r.order_key=(ACTION_RANK[r.decision.action]??0)*100 + (sc??0)*0.9 + (r.mega?15:0);
  r.attention=r.decision.action==='WATCH'||r.decision.action==='SKIP'?-1:r.order_key;
  r.attention_breakdown={action:r.decision.action, score:sc,
    formula:r.decision.action+' - '+r.decision.reason};
}
rows.sort((a,b)=>(b.order_key??-1)-(a.order_key??-1));

const live=rows.filter(r=>['ENTER NOW','SPRINT','PREP'].includes(r.decision.action));
const top=[...live].sort((a,b)=>b.order_key-a.order_key).slice(0,10);

// excluded-but-listed for transparency
const excluded = rows.filter(r=>!r.eligibility.eligible).map(r=>({slug:r.slug,title:r.title,reason:r.eligibility.failed.join('; ')}));

// history diff (unchanged)
const histDir=path.join(ROOT,'data/history'); fs.mkdirSync(histDir,{recursive:true});
const latestPath=path.join(histDir,'latest.json');
const prev=fs.existsSync(latestPath)?JSON.parse(fs.readFileSync(latestPath,'utf8')):null;
const changes=[];
if(prev){const byId=Object.fromEntries(prev.opportunities.map(o=>[o.id,o]));
for(const o of seed.opportunities){const b=byId[o.id];
if(!b){changes.push({id:o.id,type:'added',detected_at:new Date().toISOString()});continue;}
for(const k of ['registrants','ends_at']){if(JSON.stringify(b[k])!==JSON.stringify(o[k]))changes.push({id:o.id,type:'changed',field:k,old:b[k],new:o[k],detected_at:new Date().toISOString()});}}}
fs.writeFileSync(latestPath,JSON.stringify(seed,null,2));

const payload={generated_at:new Date().toISOString(),schema_version:'hackathonhelp.api.v2',
counts:{opportunities:rows.length,live:live.length,mega:rows.filter(r=>r.mega).length,excluded:excluded.length},
top,opportunities:rows,excluded,changes};
rows.sort((a,b)=>(b.attention??-1)-(a.attention??-1));
fs.mkdirSync(path.join(ROOT,'web/src/data'),{recursive:true});
fs.mkdirSync(path.join(ROOT,'web/public/api/v1'),{recursive:true});
for(const [f,obj] of [['top',{deals:top}],['opportunities',payload],['changes',{changes}]])
fs.writeFileSync(path.join(ROOT,`web/public/api/v1/${f}.json`),JSON.stringify({generated_at:payload.generated_at,schema_version:payload.schema_version,...obj},null,2));
fs.writeFileSync(path.join(ROOT,'web/src/data/derived.json'),JSON.stringify(payload,null,2));
rows.forEach(r=>{ if(r.metrics.days_left==null) r.cautions=[...(r.cautions||[]),'deadline not published']; });
console.log(`build-data v2: ${rows.length} opps | live-scored ${live.length} | excluded ${excluded.length} | mega ${payload.counts.mega}`);
console.log('TOP:');
for(const t of top.slice(0,10)) console.log(`  ${String(t.score_v01.opportunity_score).padStart(3)} ${t.title.slice(0,42).padEnd(42)} norm $${String(t.prize.normalized_value).padStart(7)} est.field ${String(t.field.estimated_serious_field).padStart(5)} share $${t.metrics.fair_share_serious}`);
