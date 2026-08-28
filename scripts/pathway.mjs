#!/usr/bin/env node
// pathway.mjs — Time-first hackathon pathway with live dates
// Usage: node scripts/pathway.mjs [--json] [--profile easy|risk|balanced]

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const ACTIVE_DIR = path.join(ROOT, 'data/active');
const HUB_PATH = path.join(ROOT, 'data/coordination/hub.json');
const PROFILE = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/builder-profile.json'), 'utf8'));
const NOW = Date.now();

const profileArg = process.argv.includes('--profile') ? process.argv[process.argv.indexOf('--profile') + 1] : 'balanced';

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

function fmtDate(d) {
  if (!d) return null;
  try {
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return null; }
}

function fmtDateShort(d) {
  if (!d) return '?';
  try {
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch { return '?'; }
}

function daysLeft(deadline) {
  if (!deadline) return null;
  return Math.ceil((new Date(deadline) - NOW) / 86400000);
}

function getDeadlines(data) {
  const t = data.timeline || {};
  const dl = [];
  if (t.track_1_2_deadline) dl.push({ date: t.track_1_2_deadline, label: 'Track 1&2 close' });
  if (t.registration_closes) dl.push({ date: t.registration_closes, label: 'Registration closes' });
  if (t.build_deadline) dl.push({ date: t.build_deadline, label: 'Submission deadline' });
  if (t.finals) dl.push({ date: t.finals, label: 'Finals' });
  // From human queue
  for (const hq of (data.human_queue || [])) {
    if (hq.deadline && !hq.done) {
      dl.push({ date: hq.deadline, label: hq.task });
    }
  }
  return dl.sort((a, b) => new Date(a.date) - new Date(b.date));
}

function deadlineColor(days) {
  if (days == null) return 'gray';
  if (days <= 2) return 'red';
  if (days <= 5) return 'orange';
  if (days <= 10) return 'yellow';
  if (days <= 21) return 'green';
  return 'dim';
}

// ---- Profile weights ----
const PROFILES = {
  balanced: { skill: 0.4, urgency: 0.3, prize: 0.2, existing: 0.1, label: 'Balanced' },
  easy:     { skill: 0.6, urgency: 0.1, prize: 0.1, existing: 0.2, label: 'Easiest Path (skill-first)' },
  risk:     { skill: 0.2, urgency: 0.4, prize: 0.3, existing: 0.1, label: 'High Risk / High Reward' },
  prize:    { skill: 0.2, urgency: 0.1, prize: 0.6, existing: 0.1, label: 'Prize Maximizer' },
};

const weights = PROFILES[profileArg] || PROFILES.balanced;

// ---- Main ----
const hub = JSON.parse(fs.readFileSync(HUB_PATH, 'utf8'));
const asJson = process.argv.includes('--json');

const entries = [];
for (const h of hub.active_hackathons) {
  const data = loadActive(h.slug);
  if (!data) continue;

  const deadlines = getDeadlines(data);
  const primaryDl = data.timeline?.build_deadline || data.timeline?.registration_closes || data.timeline?.track_1_2_deadline;
  const days = daysLeft(primaryDl);
  const skill = skillMatch(data);
  const prize = data.prizes?.total_usd || 0;
  const hasProject = !!data.project?.repo_url;
  const hasRubric = data.rubric?.our_total_score != null;
  const existing = (hasProject ? 15 : 0) + (hasRubric ? 5 : 0);
  const total = Math.round(skill * weights.skill + Math.min(100, Math.max(0, (100 - (days || 99) * 3))) * weights.urgency + Math.min(100, prize / 500) * weights.prize + existing * weights.existing);

  entries.push({
    slug: h.slug,
    title: data.title,
    days_left: days,
    primary_deadline: primaryDl ? fmtDate(primaryDl) : 'TBA',
    primary_deadline_raw: primaryDl,
    deadlines: deadlines.map(d => ({ ...d, formatted: fmtDate(d.date), days: daysLeft(d.date) })),
    color: deadlineColor(days),
    skill,
    prize,
    total,
    has_project: hasProject,
    has_rubric: hasRubric,
    tasks_done: data.tasks?.filter(t => t.status === 'done').length || 0,
    tasks_total: data.tasks?.length || 0,
    hq_pending: data.human_queue?.filter(t => !t.done).length || 0,
    hq_total: (data.human_queue || []).length,
  });
}

entries.sort((a, b) => {
  const da = a.days_left ?? 999;
  const db = b.days_left ?? 999;
  if (da !== db) return da - db;
  return b.total - a.total;
});

if (asJson) {
  console.log(JSON.stringify({ generated_at: new Date().toISOString(), profile: profileArg, weights, entries }, null, 2));
} else {
  console.log(`\n═══════════════════════════════════════════════════════════════════════════════`);
  console.log(`  PATHWAY — ${weights.label}`);
  console.log(`  Sorted by deadline. Score: skill×${weights.skill} + urgency×${weights.urgency} + prize×${weights.prize} + existing×${weights.existing}`);
  console.log(`═══════════════════════════════════════════════════════════════════════════════\n`);

  for (const e of entries) {
    const colorIcon = { red: '🔴', orange: '🟠', yellow: '🟡', green: '🟢', dim: '⚪', gray: '⚪' }[e.color];
    const scoreBar = '█'.repeat(Math.floor(e.total / 10)) + '░'.repeat(10 - Math.floor(e.total / 10));
    const proj = e.has_project ? '📁' : '  ';
    const rubric = e.has_rubric ? '📊' : '  ';
    const daysStr = e.days_left != null ? (e.days_left <= 0 ? 'ENDED' : `${e.days_left}d`) : '?';
    const hqStr = e.hq_pending > 0 ? ` 🧑${e.hq_pending}` : '';

    console.log(`  ${colorIcon} ${String(e.total).padStart(3)}/100 ${scoreBar}  ${proj}${rubric} ${e.title}`);
    console.log(`     Deadline: ${e.primary_deadline} (${daysStr})${hqStr}`);

    // Show intermediate deadlines
    const importantDl = e.deadlines.filter(d => d.days != null && d.days >= 0 && d.days <= 14);
    if (importantDl.length > 0) {
      for (const d of importantDl) {
        const urgent = d.days <= 2 ? ' ← URGENT' : d.days <= 5 ? ' ← SOON' : '';
        console.log(`       ${d.formatted} — ${d.label}${urgent}`);
      }
    }
    console.log();
  }

  // Summary
  const red = entries.filter(e => e.color === 'red');
  const orange = entries.filter(e => e.color === 'orange');
  console.log(`  ─────────────────────────────────────────────────────────`);
  if (red.length) console.log(`  🔴 URGENT: ${red.map(e => `${e.title} — ${e.primary_deadline}`).join(' | ')}`);
  if (orange.length) console.log(`  🟠 SOON:   ${orange.map(e => `${e.title} — ${e.primary_deadline}`).join(' | ')}`);
  console.log();
}
