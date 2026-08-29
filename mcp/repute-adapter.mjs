#!/usr/bin/env node
/**
 * HackathonHelp → Repute Oracle Integration
 * 
 * Connects hackathon demand signals to repute's worker marketplace.
 * When an agent enters a hackathon, it creates:
 * 1. A demand signal (job worth $50-500)
 * 2. Worker profile mapping (agent capabilities → repute worker)
 * 3. Evidence pathway (task completion → work receipts → capability profiles)
 * 
 * Usage:
 *   node mcp/repute-adapter.mjs --agent hermes-1 --hackathon telegraph-h1
 *   node mcp/repute-adapter.mjs --sync-demand   # sync all active hackathons as demand
 *   node mcp/repute-adapter.mjs --sync-profiles  # sync agent profiles to repute workers
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

const ROOT = path.resolve(import.meta.dirname, '..');
const REPUTE_API = process.env.REPUTE_API || 'http://localhost:8788';
const PROFILES_DIR = path.join(ROOT, 'profiles');
const ACTIVE_DIR = path.join(ROOT, 'data/active');

// ── Repute API wrapper ─────────────────────────────────────────────────────

async function reputeRequest(method, endpoint, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint, REPUTE_API);
    const opts = {
      method,
      hostname: url.hostname,
      port: url.port || 8788,
      path: url.pathname,
      headers: { 'Content-Type': 'application/json' },
    };
    const req = http.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({ raw: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ── Demand Signal → Repute Artifact ────────────────────────────────────────

async function createDemandArtifact(hackathon, agentId) {
  // A hackathon entry IS a job worth $50-500
  // Publish it as a repute artifact that workers can discover
  const artifact = {
    title: `[HACKATHON] ${hackathon.title || hackathon.slug}`,
    text: buildDemandText(hackathon),
    total_price: estimateJobValue(hackathon),
    currency: 'USD',
    worker_id: agentId,
    category: 'hackathon',
    tags: [...(hackathon.themes || []), 'hackathon', 'hackathon-' + hackathon.slug],
  };

  try {
    const result = await reputeRequest('POST', '/api/publish', artifact);
    console.log(`  Published demand artifact: ${result.id || result.asset_id}`);
    return result;
  } catch (e) {
    console.log(`  Failed to publish demand: ${e.message}`);
    return null;
  }
}

function buildDemandText(hackathon) {
  const parts = [];
  parts.push(`Hackathon: ${hackathon.title || hackathon.slug}`);
  parts.push(`Prize: $${hackathon.prize?.normalized_value || hackathon.prize?.headline_inflation || 'unknown'}`);
  parts.push(`Deadline: ${hackathon.deadline || 'unknown'}`);
  parts.push(`Themes: ${(hackathon.themes || []).join(', ')}`);
  if (hackathon.rubric) {
    parts.push(`\nRubric criteria:`);
    for (const c of hackathon.rubric.criteria || []) {
      parts.push(`  - ${c.name} (${c.weight}%): ${c.description || ''}`);
    }
  }
  if (hackathon.contract) {
    parts.push(`\nContract:`);
    parts.push(`  Eligibility: ${hackathon.contract.eligibility || 'open'}`);
    parts.push(`  Required tech: ${(hackathon.contract.required_tech || []).join(', ')}`);
  }
  return parts.join('\n');
}

function estimateJobValue(hackathon) {
  const prize = hackathon.prize?.normalized_value || hackathon.prize?.headline_inflation || 0;
  const field = hackathon.field?.estimated_serious_field || 100;
  // Fair share heuristic
  const fairShare = field > 0 ? prize / field : prize;
  // Agent opportunity cost (at $25/hr, 40h build = $1000)
  // But fair share is the expected payout, so cap at that
  return Math.min(fairShare, 500);
}

// ── Worker Profile → Repute Worker ─────────────────────────────────────────

async function syncWorkerProfile(agentId) {
  const reg = JSON.parse(fs.readFileSync(path.join(PROFILES_DIR, 'registry.json'), 'utf8'));
  const profile = reg.agents[agentId];
  if (!profile) {
    console.log(`No profile for ${agentId}`);
    return;
  }

  // Check if worker already exists in repute
  let existingWorker = null;
  try {
    const workers = await reputeRequest('GET', '/api/workers');
    existingWorker = workers?.workers?.find(w => w.name === agentId || w.worker_id === agentId);
  } catch {}

  if (!existingWorker) {
    // Create worker in repute
    try {
      const result = await reputeRequest('POST', '/api/workers', {
        name: agentId,
        specialties: profile.thesis_tags || [],
        bio: `Agent: ${agentId}. Capabilities: ${(profile.capabilities || []).join(', ')}. Skills: ${Object.keys(profile.skills || {}).join(', ')}`,
      });
      console.log(`  Created repute worker: ${result.worker_id}`);
      // Store mapping
      profile.repute_worker_id = result.worker_id;
      const reg2 = JSON.parse(fs.readFileSync(path.join(PROFILES_DIR, 'registry.json'), 'utf8'));
      reg2.agents[agentId] = profile;
      fs.writeFileSync(path.join(PROFILES_DIR, 'registry.json'), JSON.stringify(reg2, null, 2));
      return result.worker_id;
    } catch (e) {
      console.log(`  Failed to create worker: ${e.message}`);
      return null;
    }
  }

  console.log(`  Worker already exists: ${existingWorker.worker_id}`);
  return existingWorker.worker_id;
}

// ── Sync All Demand ────────────────────────────────────────────────────────

async function syncAllDemand(agentId) {
  console.log(`Syncing demand for ${agentId}...`);
  const activeDir = ACTIVE_DIR;
  if (!fs.existsSync(activeDir)) {
    console.log('  No active hackathons');
    return;
  }

  const files = fs.readdirSync(activeDir).filter(f => f.endsWith('.json') && !f.startsWith('_'));
  for (const file of files) {
    const slug = file.replace('.json', '');
    const hackathon = JSON.parse(fs.readFileSync(path.join(activeDir, file), 'utf8'));
    console.log(`  ${slug}: ${hackathon.title || slug}`);
    await createDemandArtifact(hackathon, agentId);
  }
  console.log(`Synced ${files.length} demand signals`);
}

// ── CLI ────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const agentId = args.find(a => a.startsWith('--agent='))?.split('=')[1];
if (!agentId) {
  console.log('Usage:');
  console.log('  node mcp/repute-adapter.mjs --agent <id> --sync-demand');
  console.log('  node mcp/repute-adapter.mjs --agent <id> --sync-profiles');
  process.exit(1);
}

if (args.includes('--sync-demand')) {
  syncAllDemand(agentId).catch(console.error);
} else if (args.includes('--sync-profiles')) {
  syncWorkerProfile(agentId).catch(console.error);
} else {
  console.log('Usage:');
  console.log('  node mcp/repute-adapter.mjs --sync-demand        # sync all active hackathons');
  console.log('  node mcp/repute-adapter.mjs --sync-profiles      # sync agent profiles');
  console.log('  node mcp/repute-adapter.mjs --agent <id> --sync-demand');
}
