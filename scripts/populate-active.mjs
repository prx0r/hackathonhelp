#!/usr/bin/env node
// populate-active.mjs — Orchestrate populating a new active hackathon entry
// Usage:
//   node scripts/populate-active.mjs <slug> <url>           — create skeleton + clone repos + add tasks
//   node scripts/populate-active.mjs <slug> --refresh       — re-crawl existing entry
//   node scripts/populate-active.mjs --from-seed <slug>     — pull what we can from seed.json first
//
// This script does the deterministic scaffolding. The LLM agent fills in
// the rest by following POPULATE-PROMPT.md.

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const ACTIVE_DIR = path.join(ROOT, 'data/active');
const SEED_PATH = path.join(ROOT, 'data/seed.json');
const HUB_PATH = path.join(ROOT, 'data/coordination/hub.json');
const NOW = new Date().toISOString();

// ---- helpers ----
function slugify(u) {
  try {
    const url = new URL(u);
    const parts = url.pathname.split('/').filter(Boolean);
    const tail = parts[parts.length - 1 || ''] || '';
    const host = url.hostname.replace(/^www\./, '').split('.')[0];
    const base = (tail && tail.length > 3 ? tail : host) || 'event';
    return `${host}-${base}`.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'event';
  } catch { return null; }
}

function findInSeed(slug) {
  if (!fs.existsSync(SEED_PATH)) return null;
  const seed = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));
  return seed.opportunities.find(o => o.slug === slug || o.id === `dp-${slug}` || o.id === `br-${slug}`) || null;
}

function detectRepoHints(url, title) {
  // Common repo patterns to try
  const hints = [];
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  // GitHub search fallback
  hints.push({ search: `${title} hackathon github`, type: 'search' });
  return hints;
}

function guessDeadline(seed) {
  if (!seed) return null;
  if (seed.ends_at) return seed.ends_at;
  if (seed.time_left) {
    // Parse "X days left" relative to observed_at
    const m = seed.time_left.match(/(\d+)\s*day/);
    if (m) {
      const observed = new Date(seed.observed_at || Date.now());
      observed.setDate(observed.getDate() + parseInt(m[1]));
      return observed.toISOString();
    }
  }
  return null;
}

function buildTimeline(seed) {
  const deadline = guessDeadline(seed);
  return {
    opens: seed?.starts_at || null,
    build_deadline: deadline,
    measurement_window: null,
    finals: null,
    finals_location: null,
  };
}

function buildPrizes(seed) {
  if (!seed) return { total_usd: null, breakdown: [], leaderboard_pool: null };
  return {
    total_usd: seed.prize_usd || null,
    breakdown: [],
    leaderboard_pool: null,
  };
}

function buildJudging(seed) {
  return {
    criteria: seed?.manual?.judging?.criteria || [],
    how_to_win: seed?.manual?.judging?.how_to_win || [],
    leaderboard_formula: seed?.manual?.judging?.leaderboard_formula || null,
  };
}

function buildSources(seed, url) {
  const sources = [{ url, quote: '' }];
  if (seed?.source_url && seed.source_url !== url) {
    sources.push({ url: seed.source_url, quote: `Platform listing: ${seed.time_left || ''}` });
  }
  return sources;
}

function buildTasks(slug, deadline, hackathonData) {
  const tasks = [];
  const dl = deadline ? new Date(deadline) : null;
  const tracks = hackathonData?.tracks || [];
  const requiredTech = hackathonData?.required_tech || [];
  const themes = hackathonData?.themes || [];
  const judging = hackathonData?.judging || {};

  // Research tasks - always first
  tasks.push({
    id: `${slug}-research-rules`,
    type: 'research',
    title: 'Deep-read official rules and scoring',
    description: `Read every word of the official rules page. Extract scoring formula, submission requirements, disqualified behaviors, gotchas. Update data/active/${slug}.json.`,
    status: 'queued', assigned_to: null, claimed_at: null,
    priority: 'critical', depends_on: [], deliverables: [`data/active/${slug}.json (updated)`],
    notes: null,
    deadline: dl ? new Date(dl.getTime() - 7 * 86400000).toISOString() : null,
    estimated_hours: 1, completed_at: null, output: null,
  });

  // Tech research - include specific tech from hackathon requirements
  const techDetail = requiredTech.length > 0
    ? `Required: ${requiredTech.join(', ')}. ` : '';
  tasks.push({
    id: `${slug}-research-tech`,
    type: 'research',
    title: 'Document required tech/SDK/API',
    description: `${techDetail}Find official docs, SDKs, APIs. Document integration patterns, gotchas, requirements. Clone any official repos.`,
    status: 'queued', assigned_to: null, claimed_at: null,
    priority: 'high', depends_on: [], deliverables: ['tech docs', `data/active/${slug}-refs/`],
    notes: null,
    deadline: dl ? new Date(dl.getTime() - 5 * 86400000).toISOString() : null,
    estimated_hours: 2, completed_at: null, output: null,
  });

  // Competitor research - derived from themes
  if (themes.length > 0) {
    tasks.push({
      id: `${slug}-research-competitors`,
      type: 'research',
      title: `Research competitors and past winners for ${themes.join(', ')}`,
      description: `Analyze previous winners and current competitors in ${themes.join(', ')}. Find patterns in what judges reward.`,
      status: 'queued', assigned_to: null, claimed_at: null,
      priority: 'medium', depends_on: [`${slug}-research-rules`],
      deliverables: ['competitor analysis', 'winner patterns'],
      notes: null,
      deadline: dl ? new Date(dl.getTime() - 4 * 86400000).toISOString() : null,
      estimated_hours: 2, completed_at: null, output: null,
    });
  }

  // Build tasks
  tasks.push({
    id: `${slug}-build-setup`,
    type: 'build',
    title: 'Set up local dev environment',
    description: `Install ${requiredTech.length > 0 ? requiredTech.join(', ') + '. ' : ''}Get things running locally, verify connectivity.`,
    status: 'queued', assigned_to: null, claimed_at: null,
    priority: 'high', depends_on: [`${slug}-research-tech`],
    deliverables: ['running local env', 'smoke test passing'],
    notes: null,
    deadline: dl ? new Date(dl.getTime() - 4 * 86400000).toISOString() : null,
    estimated_hours: 3, completed_at: null, output: null,
  });

  // Track-specific build tasks
  for (const track of tracks) {
    tasks.push({
      id: `${slug}-build-${track.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      type: 'build',
      title: `Build for track: ${track}`,
      description: `Implement submission for track "${track}". Focus on what judges in this track reward.`,
      status: 'queued', assigned_to: null, claimed_at: null,
      priority: 'high', depends_on: [`${slug}-build-setup`, `${slug}-research-rules`],
      deliverables: [`working ${track} submission`],
      notes: null,
      deadline: dl ? new Date(dl.getTime() - 2 * 86400000).toISOString() : null,
      estimated_hours: 8, completed_at: null, output: null,
    });
  }

  // If no tracks, create a generic build task
  if (tracks.length === 0) {
    tasks.push({
      id: `${slug}-build-main`,
      type: 'build',
      title: 'Build submission',
      description: 'Implement the core submission. Focus on what the judging criteria reward.',
      status: 'queued', assigned_to: null, claimed_at: null,
      priority: 'high', depends_on: [`${slug}-build-setup`, `${slug}-research-rules`],
      deliverables: ['working code', 'demo'],
      notes: null,
      deadline: dl ? new Date(dl.getTime() - 2 * 86400000).toISOString() : null,
      estimated_hours: 12, completed_at: null, output: null,
    });
  }

  // Judging-criteria-specific tasks
  if (judging.criteria?.length > 0) {
    for (const c of judging.criteria.slice(0, 5)) {
      const name = typeof c === 'string' ? c : c.name;
      tasks.push({
        id: `${slug}-score-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        type: 'document',
        title: `Prepare evidence for: ${name}`,
        description: `Gather and document evidence that scores high on "${name}". Update rubric with self-assessment.`,
        status: 'queued', assigned_to: null, claimed_at: null,
        priority: 'medium', depends_on: [`${slug}-build-main`],
        deliverables: [`rubric score for ${name}`, 'supporting evidence'],
        notes: null,
        deadline: dl ? new Date(dl.getTime() - 1 * 86400000).toISOString() : null,
        estimated_hours: 1, completed_at: null, output: null,
      });
    }
  }

  // Social tasks - if hackathon requires social presence
  if (themes.some(t => ['social', 'community', 'outreach'].includes(t.toLowerCase()))) {
    tasks.push({
      id: `${slug}-social-announce`,
      type: 'social',
      title: 'Post announcement on X/Discord',
      description: 'Share progress, tag organizers, engage with community.',
      status: 'queued', assigned_to: null, claimed_at: null,
      priority: 'medium', depends_on: [`${slug}-build-main`],
      deliverables: ['post URL'],
      notes: null,
      deadline: dl ? new Date(dl.getTime() - 1 * 86400000).toISOString() : null,
      estimated_hours: 1, completed_at: null, output: null,
    });
  }

  // Submit
  tasks.push({
    id: `${slug}-submit-final`,
    type: 'submit',
    title: 'Final submission',
    description: 'Submit before deadline. Verify all requirements met. Double-check.',
    status: 'queued', assigned_to: null, claimed_at: null,
    priority: 'critical', depends_on: [`${slug}-build-main`],
    deliverables: ['submission confirmation'],
    notes: null,
    deadline: dl ? new Date(dl.getTime() - 1 * 3600000).toISOString() : null,
    estimated_hours: 1, completed_at: null, output: null,
  });

  return tasks;
}

function buildProgress() {
  return {
    phase: 'research',
    pct_complete: 0,
    blocks: [],
    last_update: NOW,
    updated_by: null,
  };
}

function addToHub(slug, title, deadline, priority) {
  if (!fs.existsSync(HUB_PATH)) return;
  const hub = JSON.parse(fs.readFileSync(HUB_PATH, 'utf8'));
  if (!hub.active_hackathons.find(h => h.slug === slug)) {
    const daysLeft = deadline ? Math.ceil((new Date(deadline) - Date.now()) / 86400000) : null;
    hub.active_hackathons.push({
      slug, title, deadline, days_left: daysLeft,
      status: 'active', entry_type: null, priority,
      summary: 'Newly activated — details pending.',
    });
    fs.writeFileSync(HUB_PATH, JSON.stringify(hub, null, 2));
  }
}

// ---- main ----
const [, , cmd, ...rest] = process.argv;
const flags = {};
const positional = [];
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith('--')) { flags[rest[i].slice(2)] = rest[i + 1] || true; i++; }
  else positional.push(rest[i]);
}

if (cmd === '--from-seed') {
  // Pull data from seed.json and create enriched skeleton
  const slug = positional[0];
  if (!slug) { console.error('Usage: populate-active.mjs --from-seed <slug>'); process.exit(1); }
  const seed = findInSeed(slug);
  if (!seed) { console.error(`Slug not found in seed.json: ${slug}`); process.exit(1); }
  const url = seed.source_url;
  const outPath = path.join(ACTIVE_DIR, `${slug}.json`);
  if (fs.existsSync(outPath)) { console.log(`Already exists: ${outPath}`); process.exit(0); }

  const deadline = guessDeadline(seed);
  const data = {
    slug,
    title: seed.title,
    url,
    rules_url: null,
    status: 'active',
    added_at: NOW,
    timeline: buildTimeline(seed),
    prizes: buildPrizes(seed),
    judging: buildJudging(seed),
    submission: {
      types: [],
      checklist: [],
      required_tech: seed.themes || [],
      submission_url: url,
    },
    tracks: [],
    eligibility: {
      open_to_all: seed.open_to_all !== false,
      notes: seed.location_type !== 'online' ? `Location: ${seed.location}` : null,
    },
    strategy_notes: {
      our_entry_type: null,
      our_endpoint: null,
      key_insight: null,
    },
    sources: buildSources(seed, url),
    last_crawled: NOW,
    crawl_version: 0,
    progress: buildProgress(),
    tasks: buildTasks(slug, deadline, seed),
  };

  fs.mkdirSync(ACTIVE_DIR, { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(data, null, 2));

  // Add to selected.json
  const selPath = path.join(ACTIVE_DIR, 'selected.json');
  const sel = JSON.parse(fs.readFileSync(selPath, 'utf8'));
  if (!sel.selected.includes(slug)) sel.selected.push(slug);
  fs.writeFileSync(selPath, JSON.stringify(sel, null, 2));

  // Add to hub
  const daysLeft = deadline ? Math.ceil((new Date(deadline) - Date.now()) / 86400000) : null;
  const priority = daysLeft != null && daysLeft <= 7 ? 'HIGH' : daysLeft != null && daysLeft <= 14 ? 'MEDIUM' : 'LOW';
  addToHub(slug, seed.title, deadline, priority);

  console.log(`Created: ${outPath}`);
  console.log(`From seed: ${seed.title} | Prize: $${seed.prize_usd || '?'} | Deadline: ${deadline || '?'}`);
  console.log(`Tasks: ${data.tasks.length} | Priority: ${priority}`);
  console.log(`Next: agent follows POPULATE-PROMPT.md to fill in rules, judging, strategy`);

} else if (cmd === '--refresh') {
  const slug = positional[0];
  if (!slug) { console.error('Usage: populate-active.mjs <slug> --refresh'); process.exit(1); }
  const outPath = path.join(ACTIVE_DIR, `${slug}.json`);
  if (!fs.existsSync(outPath)) { console.error(`Not found: ${outPath}`); process.exit(1); }
  const data = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  data.last_crawled = NOW;
  data.crawl_version = (data.crawl_version || 0) + 1;
  fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
  console.log(`Refreshed: ${slug} → crawl_version ${data.crawl_version}`);
  console.log(`Next: agent re-crawls official page and updates fields`);

} else {
  // Default: create from URL — cmd is slug, positional[0] is URL
  const slug = cmd;
  const url = positional[0];
  if (!slug || !url) { console.error('Usage: populate-active.mjs <slug> <url>'); process.exit(1); }
  const outPath = path.join(ACTIVE_DIR, `${slug}.json`);
  if (fs.existsSync(outPath)) { console.log(`Already exists: ${outPath}`); process.exit(0); }

  // Try seed first
  const seed = findInSeed(slug);
  const deadline = seed ? guessDeadline(seed) : null;

  const data = {
    slug,
    title: seed?.title || slug,
    url,
    rules_url: null,
    status: 'active',
    added_at: NOW,
    timeline: buildTimeline(seed || null),
    prizes: buildPrizes(seed || null),
    judging: { criteria: [], how_to_win: [], leaderboard_formula: null },
    submission: { types: [], checklist: [], required_tech: [], submission_url: url },
    tracks: [],
    eligibility: { open_to_all: true },
    strategy_notes: { our_entry_type: null, our_endpoint: null, key_insight: null },
    sources: [{ url, quote: '' }],
    last_crawled: NOW,
    crawl_version: 0,
    progress: buildProgress(),
    tasks: buildTasks(slug, deadline, { tracks: [], required_tech: [], themes: [], judging: {} }),
  };

  fs.mkdirSync(ACTIVE_DIR, { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(data, null, 2));

  // Add to selected.json
  const selPath = path.join(ACTIVE_DIR, 'selected.json');
  if (fs.existsSync(selPath)) {
    const sel = JSON.parse(fs.readFileSync(selPath, 'utf8'));
    if (!sel.selected.includes(slug)) sel.selected.push(slug);
    fs.writeFileSync(selPath, JSON.stringify(sel, null, 2));
  }

  // Add to hub
  const priority = deadline && (new Date(deadline) - Date.now()) / 86400000 <= 7 ? 'HIGH' : 'MEDIUM';
  addToHub(slug, data.title, deadline, priority);

  console.log(`Created: ${outPath}`);
  console.log(`Title: ${data.title} | Source: ${seed ? 'seed.json' : 'needs manual entry'}`);
  console.log(`Tasks: ${data.tasks.length}`);
  console.log(`Next: agent follows POPULATE-PROMPT.md to crawl site and fill details`);
}
