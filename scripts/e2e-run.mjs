#!/usr/bin/env node
/**
 * Full logged E2E run: API server + MCP + live stream + agent workflow.
 * Captures everything to a log file.
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const LOG_PATH = path.join(ROOT, 'data', 'e2e-run.log');
const log = (msg) => {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_PATH, line + '\n');
};

// Clear log
fs.writeFileSync(LOG_PATH, '');

// ── Start API Server ───────────────────────────────────────────────────────
log('=== STARTING API SERVER ===');
const server = spawn('node', ['scripts/api-server.mjs'], {
  stdio: ['ignore', 'pipe', 'pipe'],
  cwd: ROOT,
});
server.stdout.on('data', d => log(`[server] ${d.toString().trim()}`));
server.stderr.on('data', d => log(`[server:err] ${d.toString().trim()}`));

function waitForServer(timeout = 8000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      http.get('http://127.0.0.1:3847/health', res => {
        let d = ''; res.on('data', c => d += c);
        res.on('end', () => { log('Server health: ' + d); resolve(); });
      }).on('error', () => {
        if (Date.now() - start > timeout) reject(new Error('timeout'));
        else setTimeout(check, 200);
      });
    };
    check();
  });
}

function api(method, ep, body, key) {
  return new Promise((resolve, reject) => {
    const url = new URL(ep, 'http://127.0.0.1:3847');
    const opts = { method, hostname: '127.0.0.1', port: 3847, path: url.pathname, headers: { 'Content-Type': 'application/json' } };
    if (key) opts.headers['X-Agent-Key'] = key;
    const req = http.request(opts, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({ raw: d }); } });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ── Main Flow ──────────────────────────────────────────────────────────────
async function main() {
  try {
    await waitForServer();
    log('=== SERVER READY ===\n');

    // Step 1: Register agent
    log('--- Step 1: Register Agent ---');
    const agentId = `runner-${Date.now().toString(36)}`;
    const reg = await api('POST', '/api/v2/agents/register', {
      agent_id: agentId,
      capabilities: ['research', 'build', 'crawl', 'submit']
    });
    log(`Registered: ${reg.agent_id}`);
    log(`API Key: ${reg.api_key}`);
    const KEY = reg.api_key;

    // Step 2: Create profile
    log('\n--- Step 2: Create Profile ---');
    const profPath = path.join(ROOT, 'profiles/registry.json');
    const profs = JSON.parse(fs.readFileSync(profPath));
    profs.agents[agentId] = {
      agent_id: 'arena-runner',
      capabilities: ['research', 'build', 'crawl', 'submit'],
      skills: {
        python: 0.92, typescript: 0.85, rust: 0.6,
        agent_architecture: 0.9, evolution_optimization: 0.85,
        web_research: 0.8, api_design: 0.8, data_pipeline: 0.8
      },
      thesis_tags: ['agents', 'evaluation', 'evolution', 'verification', 'research', 'automation'],
      assets: [
        { name: 'cge1', tags: ['evolution', 'optimization'], lang: 'Python' },
        { name: 'hackathonhelp', tags: ['hackathons', 'intelligence'], lang: 'JavaScript' },
        { name: 'get-me-money', tags: ['agents', 'earning'], lang: 'Python' }
      ],
      hackathons_entered: [],
      total_tasks_completed: 0,
      total_earnings_usd: 0,
      shadow_hour_value_usd: 25,
      created_at: new Date().toISOString(),
      last_active: new Date().toISOString(),
    };
    fs.writeFileSync(profPath, JSON.stringify(profs, null, 2));
    log(`Profile: ${Object.keys(profs.agents[agentId].skills).length} skills, ${profs.agents[agentId].thesis_tags.length} tags`);

    // Step 3: Discover opportunities
    log('\n--- Step 3: Discover Opportunities ---');
    const discover = await api('GET', '/api/v2/hackathons', null, KEY);
    log(`Active: ${discover.active?.length || 0}, Fresh: ${discover.fresh?.length || 0}`);
    if (discover.fresh?.length) {
      for (const f of discover.fresh.slice(0, 5)) {
        log(`  [${f.score}] ${f.action} ${f.title?.slice(0, 40)} (${f.days_left}d left)`);
      }
    }

    // Step 4: Enter a hackathon with judging criteria
    log('\n--- Step 4: Enter Hackathon ---');
    const act = await api('POST', '/api/v2/hackathons/activate', {
      slug: `e2e-${agentId}`,
      url: 'https://arena.e2e.test',
      judging_criteria: ['Innovation', 'Technical Execution', 'Design Quality', 'Impact', 'Presentation']
    }, KEY);
    log(`Activated: ${act.slug}`);
    log(`Tasks created: ${act.tasks}`);
    log(`Rubric generated: ${act.has_rubric} (${act.rubric_criteria} criteria)`);

    // Step 5: View tasks
    log('\n--- Step 5: View Tasks ---');
    const tasks = await api('GET', '/api/v2/tasks', null, KEY);
    const myTasks = tasks.tasks.filter(t => t._slug === '${agentId}');
    log(`Tasks for ${agentId}: ${myTasks.length}`);
    for (const t of myTasks) {
      log(`  [${t.priority}] ${t.type}: ${t.title}`);
    }

    // Step 6: Score rubric
    log('\n--- Step 6: Score Rubric ---');
    const scores = {
      'Innovation': 87,
      'Technical Execution': 82,
      'Design Quality': 75,
      'Impact': 80,
      'Presentation': 78
    };
    for (const [criterion, score] of Object.entries(scores)) {
      await api('POST', '/api/v2/hackathons/${agentId}/score', {
        criterion, score, notes: `Auto-assessed: strong ${criterion.toLowerCase()}`
      }, KEY);
      log(`  ${criterion}: ${score}/100`);
    }
    const rubric = await api('GET', '/api/v2/rubric/${agentId}', null, KEY);
    log(`Total rubric score: ${rubric.rubric?.our_total_score}/100 (${rubric.rubric?.our_confidence})`);

    // Step 7: Claim and complete tasks
    log('\n--- Step 7: Claim + Complete Tasks ---');
    for (const t of myTasks.slice(0, 3)) {
      await api('POST', '/api/v2/tasks/claim', { task_id: t.id }, KEY);
      log(`  Claimed: ${t.id}`);

      const output = t.type === 'research'
        ? { findings: `Researched ${t.title}. Key insights extracted.`, sources: 5 }
        : { files: [`${t.id}/main.py`, `${t.id}/README.md`], tests_passed: true };

      await api('POST', '/api/v2/tasks/complete', { task_id: t.id, output }, KEY);
      log(`  Completed: ${t.id}`);
    }

    // Step 8: Check progress
    log('\n--- Step 8: Check Progress ---');
    const check = await api('GET', '/api/v2/checklist/${agentId}', null, KEY);
    log(`Readiness: ${check.pct}% (${check.passed}/${check.total})`);
    for (const c of check.checks || []) {
      log(`  ${c.done ? '✓' : '○'} ${c.item}${c.score ? ' (' + c.score + ')' : ''}`);
    }

    // Step 9: Verify profile updated
    log('\n--- Step 9: Verify Profile ---');
    const profs2 = JSON.parse(fs.readFileSync(profPath));
    const agent = profs2.agents[agentId];
    log(`Tasks completed: ${agent.total_tasks_completed}`);
    log(`Hackathons entered: ${agent.hackathons_entered.length}`);

    // Step 10: Check hub state
    log('\n--- Step 10: Hub State ---');
    const hub = await api('GET', '/api/v2/hackathons', null, KEY);
    log(`Total active: ${hub.active?.length || 0}`);
    log(`Total fresh: ${hub.fresh?.length || 0}`);

    log('\n=== FULL E2E RUN COMPLETE ===');
    log(`Log saved to: ${LOG_PATH}`);

  } catch (e) {
    log(`ERROR: ${e.message}`);
    log(e.stack);
  } finally {
    server.kill();
    process.exit(0);
  }
}

main();
