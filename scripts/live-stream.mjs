#!/usr/bin/env node
/**
 * Live data stream: fetch → score → expose via API.
 * 
 * Runs as a daemon, polls Devpost + Brabble every hour.
 * New opportunities are auto-scored and added to the stream.
 * 
 * Usage:
 *   node scripts/live-stream.mjs              # run once
 *   node scripts/live-stream.mjs --daemon     # loop every hour
 *   node scripts/live-stream.mjs --status     # show stream state
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SEED_PATH = path.join(ROOT, 'data/seed.json');
const STREAM_PATH = path.join(ROOT, 'data/stream.json');
const INTERVAL_MS = parseInt(process.env.STREAM_INTERVAL || '3600000'); // 1 hour

// ── Load scoring config ────────────────────────────────────────────────────
function loadScoringConfig() {
  const p = path.join(ROOT, 'data/scoring-config.json');
  if (!fs.existsSync(p)) return {};
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// ── Load profile (for personalization) ─────────────────────────────────────
function loadProfile(agentId) {
  const p = path.join(ROOT, 'profiles/registry.json');
  if (!fs.existsSync(p)) return null;
  const reg = JSON.parse(fs.readFileSync(p, 'utf8'));
  return reg.agents?.[agentId] || null;
}

// ── Score a single opportunity ─────────────────────────────────────────────
function scoreOpportunity(opp, profile, config) {
  const scoring = config.scoring || {};
  const build = config.build || {};
  
  // Prize normalization
  const multipliers = config.prize_multipliers || {};
  const cash = opp.prize?.cash_value || opp.prize?.normalized_value || 0;
  const credits = opp.prize?.credits_value || 0;
  const normalizedPrize = cash * (multipliers.cash || 1) + credits * (multipliers.compute_credits || 0.25);
  
  // Field estimation
  const registrants = opp.field_size || opp.registrants || 100;
  const familyPrior = 0.05;
  const seriousField = Math.max(25, Math.round(registrants * familyPrior));
  
  // Fair share
  const fairShare = seriousField > 0 ? normalizedPrize / seriousField : 0;
  
  // Days left
  const deadline = opp.end_time || opp.deadline;
  const daysLeft = deadline ? Math.max(0, (new Date(deadline) - Date.now()) / 86400000) : 30;
  
  // Fit score (from profile)
  let fitScore = 50;
  if (profile) {
    const tags = new Set(profile.thesis_tags || []);
    const themes = new Set(opp.themes || []);
    const overlap = [...themes].filter(t => tags.has(t)).length;
    fitScore = themes.size > 0 ? Math.round((overlap / themes.size) * 100) : 50;
  }
  
  // Winnability (sigmoid on slot-to-field ratio)
  const slots = opp.paying_slots || Math.min(10, Math.round(seriousField * 0.05));
  const winProb = slots / Math.max(seriousField, 1);
  const winnability = Math.round(100 / (1 + Math.exp(-10 * (winProb - 0.3))));
  
  // Composite score (weights from config)
  const weights = scoring.score_weights || [0.25, 0.15, 0.15, 0.10, 0.10, 0.10, 0.15];
  const components = [
    Math.min(100, fairShare * 2),    // expected prize value
    winnability,                       // winnability
    75,                               // historical winner quality (default)
    80,                               // judging tractability (default)
    70,                               // organizer quality (default)
    30 + (profile?.reuse_by_event?.[opp.slug] || 0) * 70, // reusability
    fitScore,                         // personal fit
  ];
  
  const rawScore = components.reduce((sum, c, i) => sum + c * (weights[i] || 0), 0);
  
  // Feasibility
  const feasPrior = daysLeft < 1 ? 0.10 : daysLeft < 2 ? 0.25 : daysLeft < 3 ? 0.45 : daysLeft < 5 ? 0.65 : daysLeft < 7 ? 0.80 : daysLeft < 10 ? 0.90 : 0.97;
  
  // Decision
  let action = 'WATCH';
  if (rawScore >= 80 && daysLeft >= 3) action = 'ENTER NOW';
  else if (rawScore >= 65 && daysLeft >= 2) action = 'SPRINT';
  else if (rawScore >= 62 && daysLeft >= 1) action = 'PREP';
  else if (daysLeft <= 0) action = 'ENDED';
  else if (rawScore < 50 || daysLeft < 1) action = 'SKIP';
  
  return {
    slug: opp.slug || opp.id,
    title: opp.title || opp.name || opp.slug,
    deadline: deadline,
    days_left: Math.round(daysLeft),
    prize: { normalized: normalizedPrize, cash, credits },
    field: { registrants, serious_field: seriousField, fair_share: Math.round(fairShare) },
    score: Math.round(rawScore),
    components: {
      expected_prize: Math.round(components[0]),
      winnability: Math.round(components[1]),
      fit: Math.round(components[6]),
    },
    decision: { action, feasibility: feasPrior },
    themes: opp.themes || [],
    source: opp.source || 'unknown',
    scored_at: new Date().toISOString(),
  };
}

// ── Stream state ───────────────────────────────────────────────────────────
function loadStream() {
  if (!fs.existsSync(STREAM_PATH)) return { last_fetch: null, opportunities: [], stats: { total: 0, new: 0 } };
  return JSON.parse(fs.readFileSync(STREAM_PATH, 'utf8'));
}

function saveStream(data) {
  fs.writeFileSync(STREAM_PATH, JSON.stringify(data, null, 2));
}

// ── Main ───────────────────────────────────────────────────────────────────
async function runOnce(agentId) {
  const config = loadScoringConfig();
  const profile = agentId ? loadProfile(agentId) : null;
  const stream = loadStream();
  
  console.log(`[stream] Scoring ${stream.opportunities.length} existing opportunities...`);
  
  // Re-score all with current profile
  stream.opportunities = stream.opportunities.map(o => scoreOpportunity(o, profile, config));
  stream.opportunities.sort((a, b) => b.score - a.score);
  stream.last_scored = new Date().toISOString();
  
  // Stats
  const actions = {};
  for (const o of stream.opportunities) {
    actions[o.decision.action] = (actions[o.decision.action] || 0) + 1;
  }
  stream.stats = {
    total: stream.opportunities.length,
    actions,
    top_action: stream.opportunities[0]?.decision.action || 'none',
    avg_score: Math.round(stream.opportunities.reduce((s, o) => s + o.score, 0) / Math.max(stream.opportunities.length, 1)),
  };
  
  saveStream(stream);
  console.log(`[stream] Scored. Total: ${stream.stats.total}, Actions: ${JSON.stringify(stream.stats.actions)}`);
  console.log(`[stream] Top: ${stream.opportunities[0]?.title} (score ${stream.opportunities[0]?.score})`);
  
  return stream;
}

async function fetchAndScore(agentId) {
  console.log('[stream] Fetching fresh data...');
  
  // Import fetch dynamically
  const { default: fetch } = await import('node-fetch');
  
  const stream = loadStream();
  const existing = new Set(stream.opportunities.map(o => o.slug));
  let newCount = 0;
  
  // Fetch from Devpost
  try {
    for (let page = 1; page <= 3; page++) {
      const resp = await fetch(`https://devpost.com/api/hackathons?page=${page}`);
      const data = await resp.json();
      for (const h of (data.hackathons || [])) {
        const slug = (h.url || '').split('/').pop() || `dp-${Date.now()}`;
        if (existing.has(slug)) continue;
        existing.add(slug);
        stream.opportunities.push({
          slug,
          title: h.title || h.name,
          themes: h.themes || [],
          end_time: h.submission_page_url ? null : h.end_date_local,
          source: 'devpost',
          source_url: h.url,
          field_size: h.registrations_count || 100,
        });
        newCount++;
      }
    }
    console.log(`[stream] Fetched ${newCount} new from Devpost`);
  } catch (e) {
    console.log(`[stream] Devpost fetch failed: ${e.message}`);
  }
  
  // Score all
  const config = loadScoringConfig();
  const profile = agentId ? loadProfile(agentId) : null;
  stream.opportunities = stream.opportunities.map(o => scoreOpportunity(o, profile, config));
  stream.opportunities.sort((a, b) => b.score - a.score);
  stream.last_fetch = new Date().toISOString();
  stream.stats = {
    total: stream.opportunities.length,
    new_this_fetch: newCount,
  };
  
  saveStream(stream);
  console.log(`[stream] Total: ${stream.stats.total}, New: ${newCount}`);
  return stream;
}

// ── CLI ────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const agentId = args.find(a => a.startsWith('--agent='))?.split('=')[1];

if (args.includes('--status')) {
  const stream = loadStream();
  console.log('Stream status:');
  console.log('  Total:', stream.opportunities.length);
  console.log('  Last fetch:', stream.last_fetch || 'never');
  console.log('  Last scored:', stream.last_scored || 'never');
  if (stream.stats?.actions) console.log('  Actions:', JSON.stringify(stream.stats.actions));
  if (stream.opportunities.length > 0) {
    console.log('  Top 5:');
    stream.opportunities.slice(0, 5).forEach((o, i) => {
      console.log(`    ${i + 1}. [${o.score}] ${o.decision.action} ${o.title?.slice(0, 40)}`);
    });
  }
} else if (args.includes('--daemon')) {
  console.log(`[stream] Starting daemon, interval: ${INTERVAL_MS / 1000}s`);
  const loop = async () => {
    try { await fetchAndScore(agentId); }
    catch (e) { console.error('[stream] Error:', e.message); }
    setTimeout(loop, INTERVAL_MS);
  };
  loop();
} else {
  runOnce(agentId).catch(console.error);
}
