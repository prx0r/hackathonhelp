#!/usr/bin/env node
// score-project.mjs — Score our project against the hackathon rubric
// Usage:
//   node scripts/score-project.mjs <slug>                    — show rubric + current scores
//   node scripts/score-project.mjs <slug> --set <criterion> <score> <notes>  — set a score
//   node scripts/score-project.mjs <slug> --project <github-url> <intent>    — set project info
//   node scripts/score-project.mjs <slug> --checklist       — show what's missing
//
// This is the northstar. Every build decision should improve a rubric score.

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const ACTIVE_DIR = path.join(ROOT, 'data/active');

function load(slug) {
  const f = path.join(ACTIVE_DIR, `${slug}.json`);
  if (!fs.existsSync(f)) { console.error(`Not found: ${f}`); process.exit(1); }
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}
function save(slug, data) {
  fs.writeFileSync(path.join(ACTIVE_DIR, `${slug}.json`), JSON.stringify(data, null, 2));
}

const [, , slug, cmd, ...rest] = process.argv;
if (!slug) {
  console.error('Usage: score-project.mjs <slug> [--set <criterion> <score> <notes> | --project <repo> <intent> | --checklist]');
  process.exit(1);
}

const data = load(slug);
if (!data.rubric) { console.error(`No rubric for ${slug}. Generate one first.`); process.exit(1); }

switch (cmd) {
  case '--set': {
    const [criterion, scoreStr, ...notesParts] = rest;
    const notes = notesParts.join(' ') || null;
    const score = parseInt(scoreStr);
    if (!criterion || isNaN(score)) { console.error('Usage: --set <criterion-name> <0-100> [notes]'); process.exit(1); }

    const c = data.rubric.criteria.find(c => c.name.toLowerCase() === criterion.toLowerCase());
    if (!c) { console.error(`Criterion not found: ${criterion}. Available: ${data.rubric.criteria.map(c=>c.name).join(', ')}`); process.exit(1); }

    c.our_score = Math.max(0, Math.min(100, score));
    c.our_notes = notes;

    // Recalculate total
    const totalWeight = data.rubric.criteria.reduce((s, c) => s + c.weight, 0);
    data.rubric.our_total_score = Math.round(
      data.rubric.criteria.reduce((s, c) => s + (c.our_score ?? 0) * (c.weight / totalWeight), 0)
    );
    data.rubric.our_confidence = data.rubric.criteria.every(c => c.our_score != null) ? 'scored' : 'partial';

    save(slug, data);
    console.log(`${criterion}: ${score}/100 (weight: ${c.weight}%)`);
    console.log(`Total weighted score: ${data.rubric.our_total_score}/100`);
    break;
  }

  case '--project': {
    const [repoUrl, intent] = rest;
    if (!repoUrl) { console.error('Usage: --project <github-url> [intent]'); process.exit(1); }
    if (!data.project) data.project = {};
    data.project.repo_url = repoUrl;
    if (intent) data.project.intent = intent;
    save(slug, data);
    console.log(`Project set: ${repoUrl}`);
    if (intent) console.log(`Intent: ${intent}`);
    break;
  }

  case '--checklist': {
    const rubric = data.rubric;
    const project = data.project || {};
    const checks = [];

    // Project setup
    checks.push({ item: 'GitHub repo linked', done: !!project.repo_url, fix: 'score-project.mjs <slug> --project <url>' });
    checks.push({ item: 'Intent chosen', done: !!project.intent, fix: 'score-project.mjs <slug> --project <repo> <intent>' });
    checks.push({ item: 'What it does documented', done: !!project.what_it_does, fix: 'Add to data/active/<slug>.json → project.what_it_does' });

    // Rubric items
    for (const c of rubric.criteria) {
      checks.push({
        item: `Rubric: ${c.name} (${c.weight}%)`,
        done: c.our_score != null,
        fix: `score-project.mjs ${slug} --set "${c.name}" <score> <notes>`,
        score: c.our_score,
      });
    }

    // Submission readiness
    const sub = data.submission || {};
    checks.push({ item: 'Submission URL known', done: !!sub.submission_url, fix: 'Add submission_url to active JSON' });
    checks.push({ item: 'Checklist complete', done: (sub.checklist || []).length > 0, fix: 'Fill in submission.checklist from rules page' });

    // Disqualifiers
    console.log(`\n=== ${data.title} — Readiness Checklist ===\n`);
    for (const c of checks) {
      const icon = c.done ? '✓' : '✗';
      const scoreStr = c.score != null ? ` [${c.score}/100]` : '';
      console.log(`  ${icon} ${c.item}${scoreStr}`);
      if (!c.done) console.log(`    → ${c.fix}`);
    }

    // Disqualifiers
    if (rubric.disqualifiers?.length) {
      console.log(`\n  Disqualifiers (auto-fail):`);
      for (const d of rubric.disqualifiers) console.log(`    ⚠ ${d}`);
    }

    // Total
    if (rubric.our_total_score != null) {
      console.log(`\n  Current score: ${rubric.our_total_score}/100`);
      const grade = rubric.our_total_score >= 80 ? 'A — contender' :
        rubric.our_total_score >= 60 ? 'B — competitive' :
        rubric.our_total_score >= 40 ? 'C — needs work' : 'D — not ready';
      console.log(`  Grade: ${grade}`);
    } else {
      console.log(`\n  Score: not yet scored. Use --set to score each criterion.`);
    }
    break;
  }

  default: {
    // Show rubric
    const rubric = data.rubric;
    console.log(`\n=== ${data.title} — Rubric ===`);
    console.log(`Track: ${rubric.track} | Total: ${rubric.total_possible} points\n`);

    for (const c of rubric.criteria) {
      const scoreStr = c.our_score != null ? `${c.our_score}/100` : 'unscored';
      console.log(`  ${c.weight}% — ${c.name} [${scoreStr}]`);
      console.log(`    ${c.description}`);
      console.log(`    What we need: ${c.what_we_need}`);
      if (c.our_notes) console.log(`    Notes: ${c.our_notes}`);
      console.log(`    Levels:`);
      for (const [pct, desc] of Object.entries(c.levels)) {
        console.log(`      ${pct}%: ${desc}`);
      }
      console.log();
    }

    if (rubric.bonus_signals?.length) {
      console.log(`  Bonus signals (not scored but help):`);
      for (const b of rubric.bonus_signals) console.log(`    + ${b.name}: ${b.description}`);
      console.log();
    }

    if (rubric.our_total_score != null) {
      console.log(`  Our total: ${rubric.our_total_score}/100`);
    } else {
      console.log(`  Not yet scored. Run: score-project.mjs ${slug} --set "Normalized Performance" <score> <notes>`);
    }
    break;
  }
}
