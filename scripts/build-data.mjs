// HackathonHelp engine v2 — pipeline per docs: gates → prize normalization →
// field estimation (family priors) → score v0.1 → mega detection
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const seed = JSON.parse(fs.readFileSync(path.join(ROOT,'data/seed.json'),'utf8'));
const OV = JSON.parse(fs.readFileSync(path.join(ROOT,'data/overrides.json'),'utf8'));
const now = Date.now();

// --profile argument: use per-agent profile instead of default
const profileArg = process.argv.find((a, i, arr) => arr[i-1] === '--profile');
const PROFILE_PATH = profileArg || path.join(ROOT, 'data/builder-profile.json');
const PROFILE = JSON.parse(fs.readFileSync(PROFILE_PATH, 'utf8'));

function findOverride(o){
  // manual entries carry their own verified metadata
  if(o.source==='manual' && o.manual){
    const m=o.manual;
    return { patch:{
      match:o.slug,
      organizer_quality:m.organizer_quality,
      family_prior:m.family_prior_override,
      note:m.eligibility_note||m.judging||null,
      prize_cash:m.prize_breakdown.cash ?? undefined,
      prize_credits:m.prize_breakdown.credits ?? undefined,
      prize_advertised:m.prize_breakdown.advertised ?? undefined,
      eligibility_unverified: o.source_authority!=='official_rules'
    }, exclusion:null };
  }
  const hay = `${o.slug} ${o.title}`.toLowerCase().replace(/[^a-z0-9]+/g,'-');
  return {
    patch: OV.patches.find(p => hay.includes(p.match)) ?? null,
    exclusion: OV.exclusions.find(e => hay.includes(e.match)) ?? null,
  };
}

// ---------- stage 1: rule verification / hard gates ----------
function applyGates(o){
  const {patch, exclusion} = findOverride(o);
  const effDeadline = (o.first_deadline && (!o.ends_at || o.first_deadline < o.ends_at)) ? o.first_deadline : o.ends_at;
  const dl = effDeadline ? Math.ceil((new Date(effDeadline)-now)/86400000) : null;
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
  const normalized = (cash!=null || credits!=null)
    ? Math.round((cash??0)*M.cash + (credits??0)*M.compute_api_credits)
    : (p?.prize_advertised!=null ? null : null);
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
// ---- Opportunity Score v0.1 (operator spec) — deadline-free ----
const EV_TIERS=[[200,100],[100,92],[50,84],[25,74],[10,60],[4,45]];
function evScore(normValue, fieldP50){
  if (normValue==null || !fieldP50) return null;
  const per=normValue/fieldP50;
  for(const [t,v] of EV_TIERS) if(per>=t) return v;
  return 25;
}
const FIELD_TIERS=[[50,95],[150,85],[400,70],[1000,50],[3000,35]];
function fieldTier(fieldP50){
  if (fieldP50==null) return null;
  for(const [t,v] of FIELD_TIERS) if(fieldP50<=t) return v;
  return 20;
}
function computeScore(o, np, field){
  const slotsFromApi = o.prizes_counts?.cash ?? null;
  const p = o.source==='manual' && o.manual ? {
    organizer_quality:o.manual.organizer_quality,
    technical_depth_prior:o.manual.technical_depth_prior,
    judging:o.manual.judging
  } : OV.patches.find(x=>`${o.slug} ${o.title}`.toLowerCase().replace(/[^a-z0-9]+/g,'-').includes(x.match)) ?? {};

  const comps = {};
  comps.expected_prize_value = evScore(np.normalized_value, field.field_p50);
  // Winnability blends field-size tier with payout-slot probability
  const ftier = fieldTier(field.field_p50);
  const K = slotsFromApi ?? r_slots_p50();
  const pPaid = (ftier!=null && field.field_p50) ?
    (1/(1+Math.exp(-(Math.log(Math.min(0.9,(K/field.field_p50))/(1-Math.min(0.9,K/field.field_p50)))) + SKILL_EDGE))) : null;
  comps.winnability = (ftier!=null&&pPaid!=null) ? Math.round(ftier*0.5+pPaid*100*0.5) : (ftier!=null? Math.round(ftier*0.75):null);
  const depthMap={high:85,medium:65};
  comps.historical_winner_quality = p?.technical_depth_prior ? depthMap[p.technical_depth_prior] : null;
  comps.judging_tractability = (p?.judging||p?.note&&/judg|rubric/i.test(p.note)) ? 82 : null;
  comps.organizer_quality = p?.organizer_quality != null ? Math.round(p.organizer_quality*100) : null;

  // Personal fit / reusability require a builder profile — v0.2 personalization
  const WEIGHTS=[['expected_prize_value',.25],['winnability',.15],
    ['historical_winner_quality',.15],['judging_tractability',.10],
    ['organizer_quality',.10],['reusability_portfolio',.10],['personal_fit',.15]];
  const avail=WEIGHTS.filter(([k])=>comps[k]!=null);
  if(!avail.length) return {components:comps, known_components:0, opportunity_score:null};
  const tw=avail.reduce((s,[,w])=>s+w,0);
  let score=avail.reduce((s,[k,w])=>s+comps[k]*w/tw,0);
  const CONF_MULT={official_rules:1.00,platform_metadata_verified:0.95,platform_metadata_unverified:0.80,inferred:0.65};
  const confMul=CONF_MULT[o.eligibility.confidence] ?? 0.60;
  const known=Object.values(comps).filter(v=>v!=null).length;
  const completeness_bonus=Math.round((known/WEIGHTS.length)*8);
  return {components:comps, known_components:known,
    opportunity_score:Math.round(score*confMul)+completeness_bonus};
}
function r_slots_p50(){ return SLOTS_DEFAULT.p50; }


// ---------- run pipeline in order ----------
let rows = seed.opportunities.map(o => applyGates(o))
  .map(o => ({...o, prize:normalizePrize(o)}))
  .map(o => ({...o, field:estimateField(o)}));

const SKILL_EDGE = 1.1;   // strong-builder prior until personal profile exists
const SLOTS_DEFAULT = { p10:3, p50:6, p90:12 };
const PROFILE = JSON.parse(fs.readFileSync(path.join(ROOT,'data/builder-profile.json'),'utf8'));

// ---- HackathonContracts (v0.3): extracted via hermes, deterministically validated ----
const CONTRACT_DIR=path.join(ROOT,'data/contracts');
function loadContract(r){
  try{
    const f=path.join(CONTRACT_DIR,`${r.slug}.json`);
    if(fs.existsSync(f)){
      const c=JSON.parse(fs.readFileSync(f,'utf8'));
      if(c.slug===r.slug && c.validated) return c;
    }
  }catch{}
  return null;
}
// ---- CONFIG: build model (replaced by reference-class history later) ----
const BUILD = { p50_hours:25, p80_hours:40, hours_per_day:4, buffer_days:2,
  shadow_hour_value_usd:PROFILE.shadow_hour_value_usd };

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

function eventReuse(r){
  const key=Object.keys(PROFILE.reuse_by_event).find(k=>k!=='_default' && (r.slug.includes(k)||r.title.toLowerCase().replace(/[^a-z0-9]+/g,'-').includes(k)));
  return PROFILE.reuse_by_event[key ?? '_default'] ?? PROFILE.reuse_by_event._default;
}
function strategicFit(r){
  const hay=(r.title+' '+(r.themes||[]).join(' ')).toLowerCase();
  let hits=0;
  for(const t of PROFILE.thesis_tags) if(hay.includes(t)) hits++;
  const assetHit=PROFILE.assets.some(a=>a.tags.some(t=>hay.includes(t)));
  return Math.min(1,(hits*0.22)+(assetHit?0.3:0));
}
for (const r of rows){
  const slotsKnown = false;          // ladder data not yet collected from pages
  r.slots = slotsKnown ? null : SLOTS_DEFAULT;
  const contract=loadContract(r);
  if(contract){
    // requirement-vector overlap with builder thesis tags (deterministic)
    const rv=contract.requirement_vector||{};
    const reqTags=Object.entries(rv).filter(([k,v])=>v==='REQUIRED'||v==='HIGH').map(([k])=>k);
    const thesisHits=reqTags.filter(k=>PROFILE.thesis_tags.some(t=>k.includes(t)||t.includes(k)));
    contract.fit_boost=Math.min(0.25, thesisHits.length*0.08);
    r.contract=contract;
  }
  r.fit={ strategic_fit:+Math.min(1,strategicFit(r)+(contract?.fit_boost??0)).toFixed(2),
    code_reuse:+eventReuse(r).toFixed(2),
    effective_p80_hours:Math.max(4,Math.round(BUILD.p80_hours*(1-eventReuse(r)))) };
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
  const K = r.prizes_counts?.cash ?? r.slots.p50;
  const baseP = fieldN ? Math.min(0.9, K/fieldN) : null;
  r.payout = {
    paying_slots: { p10: Math.max(1,Math.round(K*0.5)), p50: K, p90: Math.round(K*2) },
    paying_slots_source: r.prizes_counts?.cash ? 'platform_reported' : 'assumed',
    baseline_any_payout: baseP!=null? +(baseP).toFixed(3) : null,
    p_paid: baseP!=null? +(1/(1+Math.exp(-Math.log(baseP/(1-baseP))))).toFixed(3) : null,
    ev_cash_heuristic: (baseP!=null && r.prize.normalized_value!=null)
      ? Math.round(r.prize.normalized_value * (1/(1+Math.exp(-Math.log(baseP/(1-baseP)))))) : null,
    note: 'slot count assumed until prize ladders are verified on official pages',
  };

  // ---- DECISION LAYER (v0.2): feasibility + latest safe start + state ----
  const dl=r.days_left;
  const feas=feasibilityPrior(dl);
  const p80Days=Math.max(1,Math.ceil((r.fit?.effective_p80_hours ?? BUILD.p80_hours)/BUILD.hours_per_day));
  const endsOk = (r.ends_at&&!isNaN(Date.parse(r.ends_at))?r.ends_at:null) && !isNaN(Date.parse((r.ends_at&&!isNaN(Date.parse(r.ends_at))?r.ends_at:null)));
  const msEnd = Date.parse(r.ends_at||'');
  const latestSafeStart = (dl!=null && !isNaN(msEnd))
    ? new Date(msEnd - (p80Days+BUILD.buffer_days)*86400000).toISOString().slice(0,10)
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
    p_finish_proxy:+feas.toFixed(2), build_model:{...BUILD}, opportunity_cost_usd: Math.round((r.fit?.effective_p80_hours??BUILD.p80_hours)*PROFILE.shadow_hour_value_usd)};

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

// ---------- MACHINE-READABLE LAYER ----------
const FIELD_DOCS = {
  slug:{type:'string',desc:'stable URL id; /opps/<slug>'},
  title:{type:'string',desc:'event name from source platform'},
  organizer:{type:'string|null',desc:'hosting org; null when platform hides it'},
  prize_usd:{type:'number|null',desc:'raw USD parsed from platform card'},
  prize:{type:'object',desc:'advertised_value|cash_value|credits_value|normalized_value|headline_inflation (%)',unit:'USD'},
  registrants:{type:'int|null',desc:'platform registration count'},
  field:{type:'object',desc:'field_status(usable|forming), family_prior{submissions_per_registration,source}, estimated_serious_field P50, field_p10/p50/p90'},
  metrics:{type:'object',desc:'equal_share_naive $/registrant, fair_share_serious $/est.submission, days_left'},
  score_v01:{type:'object',desc:'components{expected_prize_value,winnability,organizer_quality} 0-100, known_components, opportunity_score'},
  payout:{type:'object',desc:'paying_slots assumption p10/p50/p90, baseline_any_payout, p_paid sigmoid, ev_cash_heuristic USD',unit:'USD/%'},
  decision:{type:'object',desc:'action ENTER NOW|SPRINT|PREP|WATCH|SKIP|ENDED, reason, feasibility 0-1, feasibility_label, latest_safe_start YYYY-MM-DD, p_finish_proxy, build_model{p50_hours,p80_hours,hours_per_day,buffer_days,reuse_fraction}'},
  mega:{type:'object|null',desc:'outlier flag {score,reasons[],category}; null = not unusual'},
  cautions:{type:'string[]',desc:'verification warnings (unconfirmed cash, thin-field outliers, TBA prizes)'},
  eligibility:{type:'object',desc:'eligible bool, failed[], confidence official_rules|platform_metadata_unverified, notes; gates{} incl age_confirmed UNKNOWN semantics'},
  themes:{type:'string[]',desc:'category tags from platform'},
  location_type:{type:'enum',desc:'online | in-person (in-person events are gated OUT of rankings)'},
  starts_at:{type:'ISO date|null',desc:'submission window open'},
  ends_at:{type:'ISO date|null',desc:'deadline; drives feasibility prior'},
  source_url:{type:'url',desc:'OFFICIAL event page - always verify before committing'},
  source:{type:'enum',desc:'devpost | brabble'},
  source_authority:{type:'enum',desc:'official_platform_api | platform_metadata_unverified'},
  observed_at:{type:'ISO datetime',desc:'when facts were captured'},
};

// per-opportunity endpoints
const oppDir = path.join(ROOT,'web/public/api/v1/opportunities');
fs.mkdirSync(oppDir,{recursive:true});
for(const o of rows){
  fs.writeFileSync(path.join(oppDir,`${o.slug}.json`), JSON.stringify({
    schema_version:'hackathonhelp.api.v2',
    generated_at:payload.generated_at,
    field_documentation:'see /api/v1/index.json',
    opportunity:o,
    links:{
      html:`/opps/${o.slug}`,
      official:o.source_url,
      changes:'/api/v1/changes.json'
    }
  },null,2));
}

// API index / self-description
fs.writeFileSync(path.join(ROOT,'web/public/api/v1/index.json'), JSON.stringify({
  api:'hackathonhelp', version:'v2', generated_at:payload.generated_at,
  description:'Opportunity intelligence for online individual builders. Deterministic pipeline; unknown=null; official sources override metadata.',
  endpoints:[
    {path:'/api/v1/top.json', desc:'current top by attention (decision-ranked)'},
    {path:'/api/v1/opportunities.json', desc:'all opportunities + full computed record'},
    {path:'/api/v1/opportunities/<slug>.json', desc:'single opportunity'},
    {path:'/api/v1/changes.json', desc:'diff since previous snapshot (added/changed fields)'},
    {path:'/rss.xml', desc:'feed: top actionable opportunities'},
    {path:'/sitemap.xml', desc:'all pages'}
  ],
  decision_states:['ENTER NOW','SPRINT','PREP','WATCH','SKIP','ENDED'],
  field_documentation:FIELD_DOCS
},null,2));

// RSS feed
const feedRows=[...rows].filter(r=>r.status!=='ended'&&r.eligibility.eligible).sort((a,b)=>b.order_key-a.order_key).slice(0,50);
const esc2=t=>String(t??'').replace(/&/g,'&amp;').replace(/</g,'&lt;');
const rssItems=feedRows.map(o=>`    <item>
      <title>[${o.decision.action}] ${esc2(o.title)}</title>
      <link>https://hackathonhelp.pages.dev/opps/${o.slug}</link>
      <guid isPermaLink="false">${o.slug}-${o.observed_at}</guid>
      <pubDate>${new Date(o.observed_at).toUTCString()}</pubDate>
      <description>${esc2('Prize(norm) '+(o.prize.normalized_value!=null?'$'+Math.round(o.prize.normalized_value):'TBA')+' | field ~'+(o.field.field_p50??'?')+' | '+o.decision.action+' - '+o.decision.reason)}</description>
    </item>`).join('\n');
fs.writeFileSync(path.join(ROOT,'web/public/rss.xml'),
`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>HackathonHelp - actionable AI-builder opportunities</title>
<link>https://hackathonhelp.pages.dev</link>
<description>Decision-ranked hackathon intelligence. Credit HackathonHelp.</description>
${rssItems}
</channel></rss>`);

// sitemap — written after active section (needs activeSlugs)

// ---------- PORTFOLIO PLANNER (v0.3) ----------
// Chain value: consecutive events with overlapping requirements make each next
// entry cheaper. Reuse% estimated from shared requirement vectors + thesis tags.
function reqTags(r){
  const fromContract=Object.entries(r.contract?.requirement_vector||{})
    .filter(([k,v])=>v==='REQUIRED'||v==='HIGH').map(([k])=>k);
  const themes=(r.themes||[]).map(t=>t.toLowerCase());
  return [...new Set([...fromContract,...themes,...PROFILE.thesis_tags.filter(t=>(r.title||'').toLowerCase().includes(t))])];
}
function pairReuse(a,b){
  const A=new Set(reqTags(a)), B=new Set(reqTags(b));
  if(!A.size||!B.size) return PROFILE.reuse_by_event._default+0.15;
  const inter=[...A].filter(x=>B.has(x)).length;
  return Math.min(0.85, +(0.25 + 0.6*inter/Math.max(A.size,B.size)).toFixed(2));
}
const chainEvents=rows.filter(r=>r.eligibility.eligible && r.status!=='ended'
    && ['ENTER NOW','SPRINT','PREP','WATCH'].includes(r.decision.action))
  .sort((a,b)=>{
    const da=a.metrics.days_left??999, db=b.metrics.days_left??999;
    // order by deadline, but rank strong-fit first within similar windows
    return da-db || b.order_key-a.order_key;
  })
  .filter(r=>r.fit.strategic_fit>=0.3 || r.decision.action==='ENTER NOW')
  .slice(0,8);

const portfolio={specialism:PROFILE.specialism,
  generated_at:payload.generated_at,
  path:chainEvents.map((r,i)=>({
    step:i+1, slug:r.slug, title:r.title, action:r.decision.action,
    deadline:r.ends_at, days_left:r.metrics.days_left,
    opportunity_score:r.score_v01.opportunity_score,
    strategic_fit:+r.fit.strategic_fit.toFixed(2),
    effective_p80_hours:r.fit.effective_p80_hours,
    unique_work_remaining: r.contract? Object.keys(r.contract.required_tech||{}).length+' hard requirements' : 'per official page',
  })),
  reuse_between:[]
};
for(let i=1;i<portfolio.path.length;i++){
  const a=rows.find(r=>r.slug===portfolio.path[i-1].slug);
  const b=rows.find(r=>r.slug===portfolio.path[i].slug);
  portfolio.reuse_between.push({from:portfolio.path[i-1].slug,to:portfolio.path[i].slug,reuse_pct:Math.round(pairReuse(a,b)*100)});
}
payload.portfolio=portfolio;
fs.writeFileSync(path.join(ROOT,'web/public/api/v1/portfolio.json'), JSON.stringify(portfolio,null,2));
fs.writeFileSync(path.join(ROOT,'web/src/data/derived.json'), JSON.stringify(payload,null,2)); // refresh with portfolio

// ---------- ACTIVE HACKATHONS ----------
const ACTIVE_DIR=path.join(ROOT,'data/active');
const activeSelected=JSON.parse(fs.readFileSync(path.join(ACTIVE_DIR,'selected.json'),'utf8'));
const activeSlugs=activeSelected.selected||[];
const activeHackathons=[];
for(const slug of activeSlugs){
  const f=path.join(ACTIVE_DIR,`${slug}.json`);
  if(fs.existsSync(f)){
    try{ activeHackathons.push(JSON.parse(fs.readFileSync(f,'utf8'))); }catch{}
  }
}
// Write active API endpoints
const activeApiDir=path.join(ROOT,'web/public/api/v1/active');
fs.mkdirSync(activeApiDir,{recursive:true});
fs.writeFileSync(path.join(activeApiDir,'index.json'),JSON.stringify({
  generated_at:payload.generated_at,
  schema_version:'hackathonhelp.active.v1',
  count:activeHackathons.length,
  selected:activeSlugs,
  oncoming:activeSelected.oncoming||[],
  hackathons:activeHackathons
},null,2));
for(const h of activeHackathons){
  fs.writeFileSync(path.join(activeApiDir,`${h.slug}.json`),JSON.stringify({
    schema_version:'hackathonhelp.active.v1',
    generated_at:payload.generated_at,
    hackathon:h
  },null,2));
}

// ---------- COORDINATION API ----------
const COORD_DIR=path.join(ROOT,'data/coordination');
const hubPath=path.join(COORD_DIR,'hub.json');
if(fs.existsSync(hubPath)){
  const hub=JSON.parse(fs.readFileSync(hubPath,'utf8'));
  // Enrich hub with live task data from active files
  const allTasks=[];
  const taskSummary={queued:0,claimed:0,in_progress:0,review:0,done:0,blocked:0};
  for(const h of activeHackathons){
    if(h.tasks){
      for(const t of h.tasks){
        allTasks.push({...t,_slug:h.slug,_hackathon_title:h.title});
        taskSummary[t.status]=(taskSummary[t.status]||0)+1;
      }
    }
  }
  const coordPayload={
    generated_at:payload.generated_at,
    schema_version:'hackathonhelp.coordination.v1',
    hub,
    all_tasks:allTasks,
    task_summary:taskSummary,
    agents:Object.entries(hub.agents||{}).map(([id,a])=>({id,...a})),
    conflicts:hub.conflicts||[],
    recent_completions:hub.recent_completions||[],
  };
  const coordApiDir=path.join(ROOT,'web/public/api/v1/coordination');
  fs.mkdirSync(coordApiDir,{recursive:true});
  fs.writeFileSync(path.join(coordApiDir,'index.json'),JSON.stringify(coordPayload,null,2));
  fs.writeFileSync(path.join(coordApiDir,'hub.json'),JSON.stringify({generated_at:payload.generated_at,...hub},null,2));
  fs.writeFileSync(path.join(coordApiDir,'tasks.json'),JSON.stringify({generated_at:payload.generated_at,tasks:allTasks,summary:taskSummary},null,2));
}

// sitemap (after active section for activeSlugs)
const activePages=['/active',...activeSlugs.map(s=>'/active/'+s)];
const urls=['/','/opps','/changes','/methodology','/api',...activePages,...rows.map(r=>'/opps/'+r.slug),'/active/coordination'];
fs.writeFileSync(path.join(ROOT,'web/public/sitemap.xml'),
`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u=>`<url><loc>https://hackathonhelp.pages.dev${u}</loc></url>`).join('\n')}
</urlset>`);

// api docs payload for /api page
fs.writeFileSync(path.join(ROOT,'web/src/data/apidocs.json'), JSON.stringify({generated_at:payload.generated_at,endpoints:[
  {path:'/api/v1/top.json'},{path:'/api/v1/opportunities.json'},{path:'/api/v1/opportunities/<slug>.json'},{path:'/api/v1/changes.json'},{path:'/api/v1/active/index.json'},{path:'/api/v1/active/<slug>.json'},{path:'/api/v1/coordination/index.json'},{path:'/api/v1/coordination/hub.json'},{path:'/api/v1/coordination/tasks.json'},{path:'/rss.xml'},{path:'/sitemap.xml'}
],fields:FIELD_DOCS},null,2));

rows.forEach(r=>{ if(r.metrics.days_left==null) r.cautions=[...(r.cautions||[]),'deadline not published']; });
console.log(`build-data v2: ${rows.length} opps | live-scored ${live.length} | excluded ${excluded.length} | mega ${payload.counts.mega}`);
console.log('TOP:');
for(const t of top.slice(0,10)) console.log(`  ${String(t.score_v01.opportunity_score).padStart(3)} ${t.title.slice(0,42).padEnd(42)} norm $${String(t.prize.normalized_value).padStart(7)} est.field ${String(t.field.estimated_serious_field).padStart(5)} share $${t.metrics.fair_share_serious}`);
