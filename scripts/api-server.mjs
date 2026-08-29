#!/usr/bin/env node
// api-server.mjs — Agent-native API for HackathonHelp
// Usage: node scripts/api-server.mjs [--port 3847]
//
// This is the write layer. Reads are served by the static site.
// Agents authenticate via X-Agent-Key header.
// No human signup needed — self-service API key registration.

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = parseInt(process.argv.find((a, i, arr) => arr[i-1] === '--port') || '3847');
const AGENTS_PATH = path.join(ROOT, 'data/agents.json');
const ACTIVE_DIR = path.join(ROOT, 'data/active');
const HUB_PATH = path.join(ROOT, 'data/coordination/hub.json');

// ---- persistence ----
// Single source of truth: profiles/registry.json
const PROFILES_PATH = path.join(ROOT, 'profiles/registry.json');

function loadProfiles() {
  if (!fs.existsSync(PROFILES_PATH)) return { agents: {} };
  return JSON.parse(fs.readFileSync(PROFILES_PATH, 'utf8'));
}
function saveProfiles(d) {
  fs.mkdirSync(path.dirname(PROFILES_PATH), { recursive: true });
  fs.writeFileSync(PROFILES_PATH, JSON.stringify(d, null, 2));
}

// Backward-compat: loadAgents reads from profiles registry
function loadAgents() {
  const reg = loadProfiles();
  // Convert profile format to agents.json format for API key lookup
  const agents = { agents: {}, keys: {} };
  for (const [id, profile] of Object.entries(reg.agents || {})) {
    agents.agents[id] = {
      capabilities: profile.capabilities || [],
      registered_at: profile.created_at || new Date().toISOString(),
      last_seen: profile.last_active || new Date().toISOString(),
      tasks_completed: profile.total_tasks_completed || 0,
    };
    // Restore API key if stored
    if (profile._api_key) {
      agents.keys[profile._api_key] = id;
    }
  }
  return agents;
}
function saveAgents(data) {
  const reg = loadProfiles();
  for (const [id, agentData] of Object.entries(data.agents || {})) {
    if (!reg.agents[id]) reg.agents[id] = { agent_id: id };
    reg.agents[id].capabilities = agentData.capabilities || reg.agents[id].capabilities || [];
    reg.agents[id].created_at = agentData.registered_at || reg.agents[id].created_at;
    reg.agents[id].last_active = agentData.last_seen || reg.agents[id].last_active;
    reg.agents[id].total_tasks_completed = agentData.tasks_completed || reg.agents[id].total_tasks_completed || 0;
  }
  // Store API keys in profile
  for (const [key, id] of Object.entries(data.keys || {})) {
    if (reg.agents[id]) reg.agents[id]._api_key = key;
  }
  saveProfiles(reg);
}

// ---- scoring config ----
function loadScoringConfig() {
  const p = path.join(ROOT, 'data/scoring-config.json');
  if (!fs.existsSync(p)) return {};
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// ---- rubric generation ----
function generateRubric(criteria, template) {
  const defaults = template?.criteria_defaults || { weight: 20, levels: { "0": "Not attempted", "25": "Basic", "50": "Functional", "75": "Polished", "100": "Exceptional" } };
  const totalWeight = criteria.length * defaults.weight;
  return {
    criteria: criteria.map(c => ({
      name: typeof c === 'string' ? c : c.name || c,
      weight: typeof c === 'object' ? (c.weight || defaults.weight) : defaults.weight,
      description: typeof c === 'object' ? (c.description || '') : '',
      levels: typeof c === 'object' && c.levels ? c.levels : { ...defaults.levels },
      what_we_need: typeof c === 'object' ? (c.what_we_need || '') : '',
      our_score: null,
      our_notes: null,
    })),
    disqualifiers: [],
    our_total_score: null,
    our_confidence: 'unscored',
  };
}
function loadActive(slug) {
  const f = path.join(ACTIVE_DIR, `${slug}.json`);
  if (!fs.existsSync(f)) return null;
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}
function saveActive(slug, d) {
  const filePath = path.join(ACTIVE_DIR, `${slug}.json`);
  // Optimistic concurrency: check version before write
  if (d._version !== undefined) {
    try {
      const existing = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (existing._version && existing._version !== d._version) {
        throw new Error(`Conflict: file was modified (version ${existing._version} != ${d._version})`);
      }
    } catch (e) {
      if (e.message.includes('Conflict')) throw e;
    }
    d._version = (d._version || 0) + 1;
  }
  fs.writeFileSync(filePath, JSON.stringify(d, null, 2));
}
function loadHub() {
  if (!fs.existsSync(HUB_PATH)) return { active_hackathons: [], agents: {} };
  return JSON.parse(fs.readFileSync(HUB_PATH, 'utf8'));
}
function saveHub(h) { fs.writeFileSync(HUB_PATH, JSON.stringify(h, null, 2)); }
function genKey() { return `hh_${crypto.randomBytes(24).toString('hex')}`; }
function now() { return new Date().toISOString(); }

// ---- auth ----
function authenticate(req) {
  const key = req.headers['x-agent-key'];
  if (!key) return null;
  const agents = loadAgents();
  const agentId = agents.keys[key];
  if (!agentId) return null;
  // Update last_seen
  if (agents.agents[agentId]) agents.agents[agentId].last_seen = now();
  saveAgents(agents);
  return { id: agentId, ...agents.agents[agentId] };
}

// ---- router ----
async function handleRequest(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const method = req.method;
  const path = url.pathname;

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Agent-Key');
  if (method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const json = (code, data) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data, null, 2));
  };

  try {
    // ---- Discovery (no auth) ----
    if (path === '/api/v2' || path === '/api/v2/') {
      return json(200, {
        api: 'hackathonhelp', version: 'v2',
        description: 'Agent-native hackathon coordination. No human signup needed.',
        auth: { register: 'POST /api/v2/agents/register', header: 'X-Agent-Key' },
        docs: 'https://hackathonhelp.pages.dev/AGENT-PROTOCOL.md',
        capabilities: ['hackathon.activate', 'hackathon.score', 'task.claim', 'task.complete', 'rubric.score', 'project.link'],
      });
    }

    // ---- Register (no auth) ----
    if (path === '/api/v2/agents/register' && method === 'POST') {
      const body = await readBody(req);
      const agentId = body.agent_id || body.id || `agent-${Date.now().toString(36)}`;
      const caps = body.capabilities || body.caps || [];
      const key = genKey();
      const agents = loadAgents();
      if (agents.agents[agentId]) {
        return json(409, { error: 'Agent already exists', agent_id: agentId, hint: 'Use a different agent_id or GET /api/v2/agents/<id>/key to rotate' });
      }
      agents.agents[agentId] = { capabilities: caps, registered_at: now(), last_seen: now(), tasks_completed: 0 };
      agents.keys[key] = agentId;
      saveAgents(agents);
      return json(201, { agent_id: agentId, api_key: key, capabilities: caps, message: 'Store this key — it cannot be retrieved.' });
    }

    // ---- All other routes require auth ----
    const agent = authenticate(req);
    if (!agent) return json(401, { error: 'Invalid or missing X-Agent-Key', hint: 'Register: POST /api/v2/agents/register' });

    // ---- List hackathons ----
    if (path === '/api/v2/hackathons' && method === 'GET') {
      const hub = loadHub();
      const hackathons = [];
      for (const h of hub.active_hackathons) {
        const data = loadActive(h.slug);
        const hq = data?.human_queue || [];
        hackathons.push({
          slug: h.slug, title: h.title || data?.title, deadline: h.deadline || data?.timeline?.build_deadline,
          days_left: h.days_left, priority: h.priority,
          rubric_total: data?.rubric?.our_total_score,
          project_repo: data?.project?.repo_url,
          tasks_total: data?.tasks?.length || 0,
          tasks_done: data?.tasks?.filter(t => t.status === 'done').length || 0,
          progress_pct: data?.progress?.pct_complete || 0,
          human_pending: hq.filter(t => !t.done).length,
          human_total: hq.length,
        });
      }
      return json(200, { count: hackathons.length, hackathons, _agent: agent.id });
    }

    // ---- Get single hackathon ----
    const hackMatch = path.match(/^\/api\/v2\/hackathons\/([^/]+)$/);
    if (hackMatch && method === 'GET') {
      const data = loadActive(hackMatch[1]);
      if (!data) return json(404, { error: 'Hackathon not found' });
      return json(200, { hackathon: data, _agent: agent.id });
    }

    // ---- Activate hackathon ----
    if (path === '/api/v2/hackathons/activate' && method === 'POST') {
      const body = await readBody(req);
      const { slug, url: hackUrl, judging_criteria } = body;
      if (!slug || !hackUrl) return json(400, { error: 'Required: slug, url' });
      const existing = loadActive(slug);
      if (existing) return json(409, { error: 'Already active', slug });

      // Use populate-active script logic inline
      const { execSync } = await import('node:child_process');
      try {
        execSync(`node "${path.join(ROOT, 'scripts/populate-active.mjs')}" "${slug}" "${hackUrl}"`, { cwd: ROOT, timeout: 10000 });
      } catch (e) {
        return json(500, { error: 'Failed to create entry', detail: e.message });
      }

      const data = loadActive(slug);

      // Auto-generate rubric from judging criteria (provided or from seed data)
      const criteria = judging_criteria || data?.judging?.criteria || [];
      if (criteria.length > 0 && !data.rubric) {
        const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/scoring-config.json'), 'utf8'));
        data.rubric = generateRubric(criteria, config.default_rubric_template);
        saveActive(slug, data);
      }

      return json(201, {
        slug,
        message: data.rubric
          ? 'Activated with rubric generated from judging criteria.'
          : 'Activated. Add judging_criteria to generate rubric, or create manually.',
        tasks: data?.tasks?.length || 0,
        has_rubric: !!data.rubric,
        rubric_criteria: data.rubric?.criteria?.length || 0,
      });
    }

    // ---- Score against rubric ----
    const scoreMatch = path.match(/^\/api\/v2\/hackathons\/([^/]+)\/score$/);
    if (scoreMatch && method === 'POST') {
      const body = await readBody(req);
      const data = loadActive(scoreMatch[1]);
      if (!data) return json(404, { error: 'Hackathon not found' });
      if (!data.rubric) return json(400, { error: 'No rubric yet — generate one first' });

      const { criterion, score, notes } = body;
      if (!criterion || score === undefined) return json(400, { error: 'Required: criterion, score' });

      const c = data.rubric.criteria.find(c => c.name.toLowerCase() === criterion.toLowerCase());
      if (!c) return json(404, { error: `Criterion not found: ${criterion}`, available: data.rubric.criteria.map(c => c.name) });

      c.our_score = Math.max(0, Math.min(100, parseInt(score)));
      c.our_notes = notes || null;

      // Recalculate total
      const totalWeight = data.rubric.criteria.reduce((s, c) => s + c.weight, 0);
      data.rubric.our_total_score = Math.round(
        data.rubric.criteria.reduce((s, c) => s + (c.our_score ?? 0) * (c.weight / totalWeight), 0)
      );
      data.rubric.our_confidence = data.rubric.criteria.every(c => c.our_score != null) ? 'scored' : 'partial';

      saveActive(scoreMatch[1], data);
      return json(200, { criterion: c.name, score: c.our_score, total: data.rubric.our_total_score, _agent: agent.id });
    }

    // ---- Link project ----
    const projectMatch = path.match(/^\/api\/v2\/hackathons\/([^/]+)\/project$/);
    if (projectMatch && method === 'POST') {
      const body = await readBody(req);
      const data = loadActive(projectMatch[1]);
      if (!data) return json(404, { error: 'Hackathon not found' });

      if (!data.project) data.project = {};
      if (body.repo_url) data.project.repo_url = body.repo_url;
      if (body.intent) data.project.intent = body.intent;
      if (body.what_it_does) data.project.what_it_does = body.what_it_does;
      if (body.tech_stack) data.project.tech_stack = body.tech_stack;
      if (body.demo_url) data.project.demo_url = body.demo_url;

      saveActive(projectMatch[1], data);
      return json(200, { project: data.project, _agent: agent.id });
    }

    // ---- List tasks ----
    if (path === '/api/v2/tasks' && method === 'GET') {
      const hub = loadHub();
      const allTasks = [];
      for (const h of hub.active_hackathons) {
        const data = loadActive(h.slug);
        if (data?.tasks) {
          for (const t of data.tasks) allTasks.push({ ...t, _slug: h.slug });
        }
      }
      return json(200, { count: allTasks.length, tasks: allTasks, _agent: agent.id });
    }

    // ---- Claim task ----
    if (path === '/api/v2/tasks/claim' && method === 'POST') {
      const body = await readBody(req);
      const { task_id } = body;
      if (!task_id) return json(400, { error: 'Required: task_id' });

      const hub = loadHub();
      for (const h of hub.active_hackathons) {
        const data = loadActive(h.slug);
        if (!data?.tasks) continue;
        const task = data.tasks.find(t => t.id === task_id);
        if (!task) continue;
        if (task.status !== 'queued') return json(409, { error: `Task is ${task.status}`, assigned_to: task.assigned_to });
        task.status = 'claimed';
        task.assigned_to = agent.id;
        task.claimed_at = now();
        saveActive(h.slug, data);
        return json(200, { task_id, status: 'claimed', assigned_to: agent.id, _agent: agent.id });
      }
      return json(404, { error: 'Task not found' });
    }

    // ---- Update task ----
    if (path === '/api/v2/tasks/update' && method === 'POST') {
      const body = await readBody(req);
      const { task_id, status, notes } = body;
      if (!task_id) return json(400, { error: 'Required: task_id' });

      const hub = loadHub();
      for (const h of hub.active_hackathons) {
        const data = loadActive(h.slug);
        if (!data?.tasks) continue;
        const task = data.tasks.find(t => t.id === task_id);
        if (!task) continue;
        if (task.assigned_to !== agent.id) return json(403, { error: `Not your task (assigned to ${task.assigned_to})` });
        if (status) task.status = status;
        if (notes) task.notes = task.notes ? `${task.notes}\n[${now()}] ${notes}` : notes;
        saveActive(h.slug, data);
        return json(200, { task_id, status: task.status, _agent: agent.id });
      }
      return json(404, { error: 'Task not found' });
    }

    // ---- Complete task ----
    if (path === '/api/v2/tasks/complete' && method === 'POST') {
      const body = await readBody(req);
      const { task_id, output } = body;
      if (!task_id) return json(400, { error: 'Required: task_id' });

      const hub = loadHub();
      for (const h of hub.active_hackathons) {
        const data = loadActive(h.slug);
        if (!data?.tasks) continue;
        const task = data.tasks.find(t => t.id === task_id);
        if (!task) continue;
        if (task.assigned_to !== agent.id) return json(403, { error: `Not your task (assigned to ${task.assigned_to})` });
        task.status = 'done';
        task.completed_at = now();
        if (output) task.output = output;
        // Update progress
        if (data.progress) {
          const total = data.tasks.length;
          const done = data.tasks.filter(t => t.status === 'done').length;
          data.progress.pct_complete = Math.round((done / total) * 100);
          data.progress.last_update = now();
          data.progress.updated_by = agent.id;
        }
        saveActive(h.slug, data);
        return json(200, { task_id, status: 'done', _agent: agent.id });
      }
      return json(404, { error: 'Task not found' });
    }

    // ---- Rubric ----
    const rubricMatch = path.match(/^\/api\/v2\/rubric\/([^/]+)$/);
    if (rubricMatch && method === 'GET') {
      const data = loadActive(rubricMatch[1]);
      if (!data?.rubric) return json(404, { error: 'No rubric' });
      return json(200, { slug: rubricMatch[1], rubric: data.rubric, _agent: agent.id });
    }

    // ---- Checklist ----
    const checkMatch = path.match(/^\/api\/v2\/checklist\/([^/]+)$/);
    if (checkMatch && method === 'GET') {
      const data = loadActive(checkMatch[1]);
      if (!data) return json(404, { error: 'Hackathon not found' });
      const checks = [];
      const p = data.project || {};
      checks.push({ item: 'GitHub repo linked', done: !!p.repo_url });
      checks.push({ item: 'Intent chosen', done: !!p.intent });
      checks.push({ item: 'What it does documented', done: !!p.what_it_does });
      for (const c of (data.rubric?.criteria || [])) {
        checks.push({ item: `Rubric: ${c.name} (${c.weight}%)`, done: c.our_score != null, score: c.our_score });
      }
      checks.push({ item: 'Submission URL known', done: !!(data.submission?.submission_url) });
      const passed = checks.filter(c => c.done).length;
      return json(200, { slug: checkMatch[1], checks, passed, total: checks.length, pct: Math.round(passed / checks.length * 100), _agent: agent.id });
    }

    // ---- 404 ----
    return json(404, { error: 'Not found', docs: 'https://hackathonhelp.pages.dev/AGENT-PROTOCOL.md' });

  } catch (e) {
    return json(500, { error: e.message });
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(handleRequest);
server.listen(PORT, () => {
  console.log(`HackathonHelp API running on http://localhost:${PORT}`);
  console.log(`Discovery: http://localhost:${PORT}/api/v2`);
  console.log(`Register:  POST http://localhost:${PORT}/api/v2/agents/register`);
});
