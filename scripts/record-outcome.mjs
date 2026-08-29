#!/usr/bin/env node
/**
 * Outcome tracking: record hackathon results for calibration.
 * 
 * Usage:
 *   node scripts/record-outcome.mjs <slug> --won|--lost --hours 35 --field 120 --prize 5000 --placement 3
 *   node scripts/record-outcome.mjs <slug> --status submitted
 *   node scripts/record-outcome.mjs <slug> --calibrate   # show calibration stats
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUTCOMES_PATH = path.join(ROOT, 'data/outcomes.json');
const ACTIVE_DIR = path.join(ROOT, 'data/active');

function loadOutcomes() {
  if (!fs.existsSync(OUTCOMES_PATH)) return [];
  return JSON.parse(fs.readFileSync(OUTCOMES_PATH, 'utf8'));
}

function saveOutcomes(data) {
  fs.writeFileSync(OUTCOMES_PATH, JSON.stringify(data, null, 2));
}

const args = process.argv.slice(2);
const slug = args[0];

if (!slug || slug === '--help') {
  console.log('Usage:');
  console.log('  node scripts/record-outcome.mjs <slug> --won --hours 35 --field 120 --prize 5000 --placement 3');
  console.log('  node scripts/record-outcome.mjs <slug> --lost --hours 20 --field 80');
  console.log('  node scripts/record-outcome.mjs <slug> --status submitted');
  console.log('  node scripts/record-outcome.mjs --calibrate');
  process.exit(0);
}

if (slug === '--calibrate') {
  const outcomes = loadOutcomes();
  console.log(`\nCalibration: ${outcomes.length} recorded outcomes`);
  
  const byAction = {};
  for (const o of outcomes) {
    const action = o.predicted_action || 'unknown';
    byAction[action] = byAction[action] || { won: 0, lost: 0, total_hours: 0 };
    if (o.won) byAction[action].won++;
    else byAction[action].lost++;
    byAction[action].total_hours += o.actual_hours || 0;
  }
  
  console.log('\nWin rate by predicted action:');
  for (const [action, stats] of Object.entries(byAction)) {
    const total = stats.won + stats.lost;
    const winRate = total > 0 ? (stats.won / total * 100).toFixed(0) : 'N/A';
    const avgHours = total > 0 ? (stats.total_hours / total).toFixed(0) : 'N/A';
    console.log(`  ${action}: ${winRate}% win rate (${stats.won}/${total}), avg ${avgHours}h`);
  }
  
  // Score accuracy
  const scored = outcomes.filter(o => o.predicted_score != null && o.placement != null);
  if (scored.length > 0) {
    const errors = scored.map(o => Math.abs(o.predicted_score - (100 - o.placement * 5)));
    const mae = errors.reduce((a, b) => a + b, 0) / errors.length;
    console.log(`\nScore accuracy: MAE=${mae.toFixed(1)} (predicted vs placement-based)`);
  }
  process.exit(0);
}

// Record outcome
const outcome = { slug, recorded_at: new Date().toISOString() };

for (let i = 1; i < args.length; i += 2) {
  const flag = args[i];
  const val = args[i + 1];
  switch (flag) {
    case '--won': outcome.won = true; break;
    case '--lost': outcome.won = false; break;
    case '--hours': outcome.actual_hours = parseFloat(val); break;
    case '--field': outcome.actual_field = parseInt(val); break;
    case '--prize': outcome.actual_prize = parseFloat(val); break;
    case '--placement': outcome.placement = parseInt(val); break;
    case '--status': outcome.status = val; break;
  }
}

// Pull prediction from active hackathon data
const activeFile = path.join(ACTIVE_DIR, `${slug}.json`);
if (fs.existsSync(activeFile)) {
  const data = JSON.parse(fs.readFileSync(activeFile, 'utf8'));
  outcome.predicted_score = data.score_v01?.opportunity_score;
  outcome.predicted_action = data.decision?.action;
  outcome.predicted_field = data.field?.estimated_serious_field;
}

// Load existing, append, save
const outcomes = loadOutcomes();
outcomes.push(outcome);
saveOutcomes(outcomes);

console.log(`Recorded outcome for ${slug}:`);
console.log(JSON.stringify(outcome, null, 2));
console.log(`\nTotal outcomes: ${outcomes.length}`);
