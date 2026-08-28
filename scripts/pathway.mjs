#!/usr/bin/env node
// pathway.mjs — Time-first hackathon pathway
// Sorted by deadline urgency. High scores near deadline = red. Long runway = fading color.
// Usage: node scripts/pathway.mjs [--json]

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const ACTIVE_DIR = path.join(ROOT, 'data/active');
const HUB_PATH = path.join(ROOT, 'data/coordination/hub.json');
const PROFILE = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/builder-profile.json'), 'utf8'));
const NOW = Date.now();

function loadActive(slug) {
  const f = path.join(ACTIVE_DIR, `${slug}.json`);
  if (!fs.existsSync(f)) return null;
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}

function skillMatch(data) {
  const tags = [
    ...(data.themes || []),
    ...(data.tracks || []).map(t => `${t.name} ${t.description}`),
    data.strategy_notes?.key_insight || '',
    data.strategy_notes?.our_endpoint || '',
    ...(data.rubric?.criteria || []).map(c => `${c.name} ${c.description} ${c.what_we_need}`),
    ...(data.judging?.criteria || []).map(c => `${c.name} ${c.description || c.quote}`),
  ].join(' ').toLowerCase();

  const thesisHits = PROFILE.thesis_tags.filter(t => tags.includes(t));
  const assetHits = PROFILE.assets.filter(a => a.tags.some(t => tags.includes(t)));
  const reuse = PROFILE.reuse_by_event[data.slug] || PROFILE.reuse_by_event._default || 0;

  return Math.min(100, Math.round(thesisHits.length * 12 + assetHits.length * 8 + reuse * 40));
}

function daysLeft(deadline) {
  if (!deadline) return null;
  const dl = new Date(deadline);
  return Math.ceil((dl - NOW) / 86400000);
}

function deadlineColor(days) {
  if (days == null) return 'gray';
  if (days <= 2) return 'red';
  if (days <= 5) return 'orange';
  if (days <= 10) return 'yellow';
  if (days <= 21) return 'green';
  return 'dim';
}

function deadlineBar(days) {
  if (days == null) return '░░░░░░░░░░';
  if (days <= 2) return '██████████';
  if (days <= 5) return '████████░░';
  if (days <= 10) return '██████░░░░';
  if (days <= 21) return '████░░░░░░';
  return '██░░░░░░░░';
}

// ---- Main ----
const hub = JSON.parse(fs.readFileSync(HUB_PATH, 'utf8'));
const asJson = process.argv.includes('--json');

const entries = [];
for (const h of hub.active_hackathons) {
  const data = loadActive(h.slug);
  if (!data) continue;
  
  const dl = data.timeline?.build_deadline || data.timeline?.registration_closes || data.timeline?.track_1_2_deadline;
  const days = daysLeft(dl);
  const skill = skillMatch(data);
  const prize = data.prizes?.total_usd || 0;
  const hasProject = !!data.project?.repo_url;
  const hasRubric = data.rubric?.our_total_score != null;
  const existing = (hasProject ? 15 : 0) + (hasRubric ? 5 : 0);
  
  // Score: skill matters, but time is king
  // High skill + deadline approaching = CRITICAL
  // Low skill + deadline far = low priority
  const total = Math.round(skill * 0.5 + Math.min(100, Math.max(0, (100 - (days || 99) * 3))) * 0.3 + Math.min(100, prize / 500) * 0.1 + existing * 0.1);
  
  entries.push({
    slug: h.slug,
    title: data.title,
    days_left: days,
    deadline: dl,
    color: deadlineColor(days),
    skill,
    prize,
    total,
    has_project: hasProject,
    has_rubric: hasRubric,
    tasks_done: data.tasks?.filter(t => t.status === 'done').length || 0,
    tasks_total: data.tasks?.length || 0,
    hq_pending: data.human_queue?.filter(t => !t.done).length || 0,
  });
}

// Sort by deadline (soonest first), then by score
entries.sort((a, b) => {
  const da = a.days_left ?? 999;
  const db = b.days_left ?? 999;
  if (da !== db) return da - db;
  return b.total - a.total;
});

if (asJson) {
  console.log(JSON.stringify({ generated_at: new Date().toISOString(), entries }, null, 2));
} else {
  console.log(`\n═══════════════════════════════════════════════════════════════`);
  console.log(`  PATHWAY — sorted by deadline (soonest first)`);
  console.log(`  █ = urgent   ░ = plenty of time   Score = skill×0.5 + urgency×0.3 + prize×0.1`);
  console.log(`═══════════════════════════════════════════════════════════════\n`);

  for (const e of entries) {
    const bar = deadlineBar(e.days_left);
    const daysStr = e.days_left != null ? `${e.days_left}d` : '?';
    const colorIcon = {red:'🔴',orange:'🟠',yellow:'🟡',green:'🟢',dim:'⚪',gray:'⚪'}[e.color];
    const scoreBar = '█'.repeat(Math.floor(e.total / 10)) + '░'.repeat(10 - Math.floor(e.total / 10));
    const proj = e.has_project ? '📁' : '  ';
    const rubric = e.has_rubric ? '📊' : '  ';
    
    console.log(`  ${colorIcon} ${bar} ${daysStr.padStart(4)}  ${scoreBar} ${String(e.total).padStart(3)}/100  ${proj}${rubric} ${e.slug}`);
    console.log(`     skill=${e.skill}  prize=$${e.prize.toLocaleString()}  tasks=${e.tasks_done}/${e.tasks_total}  human=${e.hq_pending}`);
    console.log();
  }

  // Quick summary
  const red = entries.filter(e => e.color === 'red');
  const orange = entries.filter(e => e.color === 'orange');
  const highScore = entries.filter(e => e.total >= 80);
  
  console.log(`  ─────────────────────────────────────────────────────`);
  if (red.length) console.log(`  🔴 URGENT (${red.length}): ${red.map(e => `${e.slug} (${e.total})`).join(', ')}`);
  if (orange.length) console.log(`  🟠 SOON (${orange.length}): ${orange.map(e => `${e.slug} (${e.total})`).join(', ')}`);
  if (highScore.length) console.log(`  ⭐ HIGH SCORE (≥80): ${highScore.map(e => `${e.slug} (${e.total})`).join(', ')}`);
  console.log();
}
