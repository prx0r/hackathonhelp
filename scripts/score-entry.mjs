#!/usr/bin/env node
// score-entry.mjs — clone a GitHub repo entry and score it against a sponsor rubric
// Usage: node scripts/score-entry.mjs --entry proofdesk --track foxit
//        node scripts/score-entry.mjs --entry agentseolab --track namecom --repo https://github.com/you/agentseolab
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENTRIES_DIR = path.join(ROOT, 'data/entries');
const RUBRICS_DIR = path.join(ROOT, 'data/rubrics');

function loadJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }

function parseArgs() {
  const a = process.argv;
  const get = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i+1] : null; };
  return {
    entry: get('--entry'),
    track: get('--track'),
    repo: get('--repo'),
    commit: get('--commit'),
  };
}

function cloneRepo(repoUrl, dest) {
  if (fs.existsSync(dest)) execSync(`rm -rf "${dest}"`);
  execSync(`git clone --depth 1 "${repoUrl}" "${dest}" 2>&1 | head -20`, { stdio: 'pipe' });
  return dest;
}

function grepRepo(dir, pattern) {
  try {
    const out = execSync(`grep -ri -E "${pattern}" "${dir}" 2>/dev/null | head -20`, { encoding: 'utf8' });
    return out.trim().split('\n').filter(Boolean);
  } catch { return []; }
}

function fileExists(dir, rel) { return fs.existsSync(path.join(dir, rel)); }

function autoScore(entry, rubric, dir) {
  const results = [];
  let total = 0;
  let max = 0;
  for (const row of rubric.rubric) {
    const weight = row.weight;
    max += 100 * weight;
    let score = 0;
    let evidence = [];
    // Heuristic checks per rubric.check
    const pat = row.check.match(/grep -ri '([^']+)'/);
    if (pat) {
      const hits = grepRepo(dir, pat[1]);
      evidence = hits.slice(0, 3);
      score = hits.length >= 3 ? 85 : hits.length >= 1 ? 65 : 25;
    } else if (row.check.includes('README has')) {
      const readme = fileExists(dir, 'README.md') ? fs.readFileSync(path.join(dir, 'README.md'), 'utf8') : '';
      const hasVideo = /youtu\.be|youtube\.com|loom\.com|video/i.test(readme);
      const hasSection = /Boundary choice|Where Doctavian|heavy lifting/i.test(readme);
      score = (hasVideo ? 50 : 0) + (hasSection ? 35 : 0) + (readme.length > 500 ? 15 : 0);
      evidence = [hasVideo ? 'demo video link found' : 'no video link', hasSection ? 'required section found' : 'no section'];
    } else if (row.check.includes('tests pass')) {
      const hasTests = fileExists(dir, 'package.json') || fs.existsSync(path.join(dir, 'tests')) || fs.existsSync(path.join(dir, 'test'));
      score = hasTests ? 75 : 45;
      evidence = [hasTests ? 'tests dir found' : 'no tests'];
    } else {
      score = 60; // default
    }
    score = Math.min(100, score);
    total += score * weight;
    results.push({ criterion: row.criterion, weight, score, evidence: evidence.slice(0, 2) });
  }
  // Must-have gates
  const mustHaveFails = [];
  for (const m of (rubric.must_have || [])) {
    const pat = m.match(/Call (\w+)/);
    if (pat) {
      const hits = grepRepo(dir, pat[1].toLowerCase());
      if (!hits.length) mustHaveFails.push(m);
    }
  }
  if (mustHaveFails.length) {
    total = Math.min(total, 55); // cap if must-have missing
  }
  return { total: Math.round(total), max: 100, details: results, mustHaveFails };
}

function peerTemplate(entry, rubric, auto) {
  return `
## Peer Review — ${entry.id} vs ${rubric.track} (${rubric.sponsor})
**Repo:** ${entry.repo} @ ${entry.commit}
**Auto:** ${auto.total}/100 ${auto.mustHaveFails.length ? `⚠️ must-have missing: ${auto.mustHaveFails.join('; ')}` : '✅ must-have present'}

**5-min checklist (each peer scores 0-20, avg → 0-100):**
${rubric.rubric.map((r, i) => `- [ ] **${r.criterion}** (${Math.round(r.weight*100)}%) — ${r.check} → auto ${auto.details[i].score}/100`).join('\n')}

**Quick peer Qs:**
- Would you pay to use this? (real-world viability)
- Is the API central or throwaway?
- Demo shows it end-to-end or just slides?

**Scorecard:**
| Criterion | Auto | Peer1 (0-20) | Peer2 (0-20) | Final |
|-----------|------|--------------|--------------|-------|
${rubric.rubric.map(r => `| ${r.criterion.slice(0, 30)} | ${auto.details.find(d=>d.criterion===r.criterion).score} |  |  |  |`).join('\n')}

**One-line where ${rubric.sponsor} did real work:** ______________________
`;
}

function main() {
  const { entry: entryId, track, repo: repoOverride } = parseArgs();
  if (!entryId || !track) {
    console.error('Usage: node scripts/score-entry.mjs --entry <id> --track <track> [--repo <url>]');
    console.error('Tracks: foxit, doctavian, nutrient, serpapi, namecom');
    console.error('Entries: proofdesk, llmdeals, agentseolab');
    process.exit(1);
  }
  const entryPath = path.join(ENTRIES_DIR, `${entryId}.json`);
  if (!fs.existsSync(entryPath)) { console.error(`Entry not found: ${entryPath}`); process.exit(1); }
  const entry = loadJson(entryPath);
  const repoUrl = repoOverride || entry.repo;

  // Try rubrics with devnetwork- prefix, then bare
  let rubricPath = path.join(RUBRICS_DIR, `devnetwork-${track}.json`);
  if (!fs.existsSync(rubricPath)) rubricPath = path.join(RUBRICS_DIR, `${track}.json`);
  if (!fs.existsSync(rubricPath)) { console.error(`Rubric not found for track: ${track}`); process.exit(1); }
  const rubric = loadJson(rubricPath);

  console.log(`\nScoring ${entryId} (${repoUrl}) vs ${track} (${rubric.sponsor}) — ${rubric.prize.cash ? `$${rubric.prize.cash}` : ''}\n`);

  // Clone to /tmp if repo looks real, else use local dir if entry is local path
  let dir = repoUrl;
  let tmpDir = null;
  if (repoUrl.startsWith('https://')) {
    // Check if it's a placeholder like https://github.com/you/...
    if (repoUrl.includes('/you/')) {
      console.log(`⚠️  Placeholder repo ${repoUrl} — scoring against local stub (no clone).`);
      // Use the actual local repo if exists, else score 0
      const localMap = { proofdesk: '/root/hackathonhelp', llmdeals: '/root/llmdeals', agentseolab: '/root/agentseolab' };
      dir = localMap[entryId] || ROOT;
      if (!fs.existsSync(dir)) dir = ROOT;
    } else {
      tmpDir = `/tmp/score-${entryId}-${Date.now()}`;
      console.log(`Cloning ${repoUrl} → ${tmpDir} ...`);
      try { cloneRepo(repoUrl, tmpDir); dir = tmpDir; } catch (e) {
        console.error(`Clone failed: ${e.message.slice(0, 200)}`);
        process.exit(1);
      }
    }
  }

  const auto = autoScore(entry, rubric, dir);
  console.log(`Auto: ${auto.total}/100`);
  if (auto.mustHaveFails.length) console.log(`  ⚠️ must-have missing:\n    - ${auto.mustHaveFails.join('\n    - ')}`);
  console.log(`\nDetails:`);
  for (const d of auto.details) {
    console.log(`  ${d.score.toString().padStart(3)} ${d.criterion} (${Math.round(d.weight*100)}%)`);
    if (d.evidence.length) console.log(`      → ${d.evidence[0]}`);
  }

  const peerMd = peerTemplate(entry, rubric, auto);
  const outDir = path.join(ROOT, 'data/scores');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${entryId}-${track}.md`);
  fs.writeFileSync(outPath, peerMd);
  console.log(`\nPeer template written → ${outPath}`);

  // Also write machine-readable score
  const machinePath = path.join(outDir, `${entryId}-${track}.json`);
  fs.writeFileSync(machinePath, JSON.stringify({
    entry: entryId, track, repo: repoUrl, scored_at: new Date().toISOString(),
    rubric: rubric.track, sponsor: rubric.sponsor,
    auto_score: auto.total, must_have_fails: auto.mustHaveFails, details: auto.details,
  }, null, 2));
  console.log(`Machine score → ${machinePath}`);

  // Matrix
  console.log(`\nMatrix: proofdesk → foxit/doctavian/nutrient, llmdeals → serpapi, agentseolab → namecom`);
  console.log(`Run all: for t in foxit doctavian nutrient; do node scripts/score-entry.mjs --entry proofdesk --track \$t; done`);

  if (tmpDir) execSync(`rm -rf "${tmpDir}"`);
}

main();
