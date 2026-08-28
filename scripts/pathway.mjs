#!/usr/bin/env node
// pathway.mjs — Auditable hackathon pathway recommendation
// Usage:
//   node scripts/pathway.mjs                    — full auditable pathway
//   node scripts/pathway.mjs --json             — machine-readable
//   node scripts/pathway.mjs --detail <slug>    — deep dive on one hackathon
//
// Every number is traceable. Hover over any score to see the formula.

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const ACTIVE_DIR = path.join(ROOT, 'data/active');
const HUB_PATH = path.join(ROOT, 'data/coordination/hub.json');
const PROFILE = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/builder-profile.json'), 'utf8'));
const SEED = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/seed.json'), 'utf8'));
const NOW = Date.now();

function loadActive(slug) {
  const f = path.join(ACTIVE_DIR, `${slug}.json`);
  if (!fs.existsSync(f)) return null;
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}

// ---- AUDITABLE skill match ----
function skillMatch(data) {
  const tags = [
    ...(data.themes || []),
    ...(data.tracks || []).map(t => `${t.name} ${t.description}`),
    data.strategy_notes?.key_insight || '',
    data.strategy_notes?.our_endpoint || '',
    ...(data.rubric?.criteria || []).map(c => `${c.name} ${c.description} ${c.what_we_need}`),
    ...(data.judging?.criteria || []).map(c => `${c.name} ${c.description || c.quote}`),
  ].join(' ').toLowerCase();

  // Thesis tag hits
  const thesisHits = PROFILE.thesis_tags.filter(t => tags.includes(t));
  const thesisScore = thesisHits.length * 12; // 12 pts per hit, no cap until final

  // Asset overlaps — which repos can we reuse?
  const assetHits = PROFILE.assets.filter(a => a.tags.some(t => tags.includes(t)));
  const assetScore = assetHits.length * 8; // 8 pts per reusable asset

  // Reuse factor from profile
  const reuse = PROFILE.reuse_by_event[data.slug] || PROFILE.reuse_by_event._default || 0;
  const reuseScore = reuse * 40;

  const raw = thesisScore + assetScore + reuseScore;
  const capped = Math.min(100, Math.round(raw));

  return {
    total: capped,
    raw,
    thesis_hits: thesisHits,
    thesis_score: thesisScore,
    asset_hits: assetHits.map(a => a.name),
    asset_score: assetScore,
    reuse_factor: reuse,
    reuse_score: Math.round(reuseScore),
  };
}

// ---- AUDITABLE urgency ----
function urgencyScore(deadline) {
  if (!deadline) return { total: 20, days_left: null, label: 'no deadline', tier: 'unknown' };
  const dl = new Date(deadline);
  const daysLeft = Math.ceil((dl - NOW) / 86400000);
  if (daysLeft < 0) return { total: 0, days_left: daysLeft, label: 'ENDED', tier: 'ended' };

  // Feasibility prior from DEVPLAN.md
  let tier, label;
  if (daysLeft <= 1) { tier = '<1d'; label = 'last chance'; }
  else if (daysLeft <= 2) { tier = '1-2d'; label = 'extremely tight'; }
  else if (daysLeft <= 3) { tier = '2-3d'; label = 'very tight'; }
  else if (daysLeft <= 5) { tier = '3-5d'; label = 'tight'; }
  else if (daysLeft <= 7) { tier = '5-7d'; label = 'one week'; }
  else if (daysLeft <= 10) { tier = '7-10d'; label = 'comfortable'; }
  else if (daysLeft <= 14) { tier = '10-14d'; label = 'relaxed'; }
  else { tier = '14d+'; label = 'plenty of time'; }

  const score = daysLeft <= 1 ? 100 : daysLeft <= 2 ? 85 : daysLeft <= 3 ? 70 :
    daysLeft <= 5 ? 55 : daysLeft <= 7 ? 45 : daysLeft <= 14 ? 30 : 15;

  return { total: score, days_left: daysLeft, label, tier };
}

// ---- AUDITABLE prize ----
function prizeScore(prizes) {
  const total = prizes?.total_usd || 0;
  const algo = prizes?.total_algo || 0;
  // Normalize ALGO to ~$0.15/ALGO
  const normalized = total + (algo * 0.15);

  let tier;
  if (normalized >= 100000) tier = 'mega';
  else if (normalized >= 50000) tier = 'large';
  else if (normalized >= 20000) tier = 'solid';
  else if (normalized >= 10000) tier = 'decent';
  else if (normalized >= 5000) tier = 'modest';
  else if (normalized >= 1000) tier = 'small';
  else tier = 'micro';

  const score = normalized >= 100000 ? 100 : normalized >= 50000 ? 85 :
    normalized >= 20000 ? 70 : normalized >= 10000 ? 55 :
    normalized >= 5000 ? 45 : normalized >= 1000 ? 30 : 15;

  return { total: Math.round(normalized), raw_usd: total, algo, tier, score };
}

// ---- Final recommendation ----
function recommend(data) {
  const skill = skillMatch(data);
  const deadline = data.timeline?.build_deadline || data.timeline?.registration_closes;
  const urg = urgencyScore(deadline);
  const prize = prizeScore(data.prizes);

  const hasProject = !!data.project?.repo_url;
  const hasRubric = data.rubric?.our_total_score != null;
  const existingScore = (hasProject ? 15 : 0) + (hasRubric ? 5 : 0);

  // Weighted: skill 40%, urgency 30%, prize 20%, existing 10%
  const total = Math.round(skill.total * 0.4 + urg.total * 0.3 + prize.score * 0.2 + existingScore * 0.1);

  let action, reason;
  if (total >= 70) { action = 'ENTER NOW'; reason = 'strong fit + good timing + real prize'; }
  else if (total >= 55) { action = 'SPRINT'; reason = 'good fit but tight or moderate prize'; }
  else if (total >= 40) { action = 'PREP'; reason = 'decent fit, plan for it'; }
  else { action = 'WATCH'; reason = 'low fit or low urgency'; }

  return {
    total, action, reason,
    breakdown: {
      skill: { score: skill.total, weight: '40%', weighted: Math.round(skill.total * 0.4), ...skill },
      urgency: { score: urg.total, weight: '30%', weighted: Math.round(urg.total * 0.3), ...urg },
      prize: { score: prize.score, weight: '20%', weighted: Math.round(prize.score * 0.2), ...prize },
      existing: { score: existingScore, weight: '10%', weighted: Math.round(existingScore * 0.1), has_project: hasProject, has_rubric: hasRubric },
    },
  };
}

// ---- Main ----
const hub = JSON.parse(fs.readFileSync(HUB_PATH, 'utf8'));
const asJson = process.argv.includes('--json');
const detailSlug = process.argv.includes('--detail') ? process.argv[process.argv.indexOf('--detail') + 1] : null;

if (detailSlug) {
  // Deep dive on one hackathon
  const data = loadActive(detailSlug);
  if (!data) { console.error(`Not found: ${detailSlug}`); process.exit(1); }
  const rec = recommend(data);
  console.log(JSON.stringify({ slug: detailSlug, title: data.title, recommendation: rec }, null, 2));
  process.exit(0);
}

const entries = [];
for (const h of hub.active_hackathons) {
  const data = loadActive(h.slug);
  if (!data) continue;
  const rec = recommend(data);
  entries.push({ slug: h.slug, title: data.title, priority: h.priority, ...rec });
}

entries.sort((a, b) => b.total - a.total);

if (asJson) {
  console.log(JSON.stringify({
    generated_at: new Date().toISOString(),
    profile_github: PROFILE.github,
    profile_specialism: PROFILE.specialism,
    profile_thesis_tags: PROFILE.thesis_tags,
    profile_assets: PROFILE.assets.map(a => ({ name: a.name, tags: a.tags })),
    scoring_formula: 'total = skill×0.4 + urgency×0.3 + prize×0.2 + existing×0.1',
    entries,
  }, null, 2));
} else {
  console.log(`\n═══════════════════════════════════════════════════════════════`);
  console.log(`  HACKATHON PATHWAY — ${PROFILE.github}`);
  console.log(`  ${PROFILE.specialism}`);
  console.log(`═══════════════════════════════════════════════════════════════\n`);

  console.log(`  Profile: ${PROFILE.repo_count} repos | ${PROFILE.languages.join(', ')}`);
  console.log(`  Active projects: ${PROFILE.active_projects.join(', ')}\n`);

  console.log(`  Scoring: total = skill×0.4 + urgency×0.3 + prize×0.2 + existing×0.1`);
  console.log(`  Skill = thesis_tags(12pts each) + assets(8pts each) + reuse_factor(40pts)\n`);

  for (const e of entries) {
    const b = e.breakdown;
    console.log(`  ┌─ ${e.action.padEnd(10)} ${e.total}/100 — ${e.slug}`);
    console.log(`  │  ${e.reason}`);
    console.log(`  │  Skill: ${b.skill.score}/100 (${b.skill.thesis_hits.length} tags: ${b.skill.thesis_hits.slice(0,5).join(', ')}${b.skill.thesis_hits.length>5?'...':''}) + ${b.skill.asset_hits.length} assets (${b.skill.asset_hits.slice(0,3).join(', ')}${b.skill.asset_hits.length>3?'...':''}) + reuse ${b.skill.reuse_factor}`);
    console.log(`  │  Urgency: ${b.urgency.score}/100 — ${b.urgency.days_left}d left (${b.urgency.label})`);
    console.log(`  │  Prize: ${b.prize.score}/100 — $${b.prize.total.toLocaleString()} (${b.prize.tier})${b.prize.algo ? ` + ${b.prize.algo} ALGO` : ''}`);
    console.log(`  │  Existing: ${b.existing.score}/100 — project=${b.existing.has_project} rubric=${b.existing.has_rubric}`);
    console.log(`  └──────────────────────────────────────────────────────────\n`);
  }

  // Summary
  const enterNow = entries.filter(e => e.action === 'ENTER NOW');
  const sprint = entries.filter(e => e.action === 'SPRINT');
  const prep = entries.filter(e => e.action === 'PREP');
  console.log(`  RECOMMENDATION:`);
  if (enterNow.length) console.log(`    ENTER NOW: ${enterNow.map(e => `${e.slug} (${e.total}/100)`).join(', ')}`);
  if (sprint.length) console.log(`    SPRINT:    ${sprint.map(e => `${e.slug} (${e.total}/100)`).join(', ')}`);
  if (prep.length) console.log(`    PREP:      ${prep.map(e => `${e.slug} (${e.total}/100)`).join(', ')}`);
  console.log(`    WATCH:     ${entries.filter(e => e.action === 'WATCH').map(e => e.slug).join(', ')}`);
  console.log();
}
