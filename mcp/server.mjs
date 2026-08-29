#!/usr/bin/env node
/**
 * HackathonHelp MCP Server
 * 
 * Wraps hackathonhelp's agent API as MCP tools.
 * Each agent gets its own profile, skills, and personalized hackathon matching.
 * 
 * Usage:
 *   node mcp/server.mjs                    # stdio mode (for Claude Desktop, etc.)
 *   node mcp/server.mjs --port 3001        # HTTP mode
 *   node mcp/server.mjs --hackathonhelp http://localhost:3847
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

const ROOT = path.resolve(import.meta.dirname, '..');
const HH_API = process.env.HACKATHONHELP_API || 'http://localhost:3847';
const PROFILES_DIR = path.join(ROOT, 'profiles');

// ── Profile Registry ──────────────────────────────────────────────────────

function loadProfiles() {
  const p = path.join(PROFILES_DIR, 'registry.json');
  if (!fs.existsSync(p)) return { agents: {} };
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function saveProfiles(data) {
  fs.mkdirSync(PROFILES_DIR, { recursive: true });
  fs.writeFileSync(path.join(PROFILES_DIR, 'registry.json'), JSON.stringify(data, null, 2));
}

function getOrCreateProfile(agentId, capabilities = []) {
  const reg = loadProfiles();
  if (!reg.agents[agentId]) {
    reg.agents[agentId] = {
      agent_id: agentId,
      capabilities,
      skills: {},
      thesis_tags: [],
      assets: [],
      hackathons_entered: [],
      hackathons_won: [],
      total_earnings_usd: 0,
      created_at: new Date().toISOString(),
      last_active: new Date().toISOString(),
    };
    saveProfiles(reg);
  }
  return reg.agents[agentId];
}

function updateProfile(agentId, updates) {
  const reg = loadProfiles();
  if (!reg.agents[agentId]) return null;
  Object.assign(reg.agents[agentId], updates, { last_active: new Date().toISOString() });
  saveProfiles(reg);
  return reg.agents[agentId];
}

// ── Capability Matching ────────────────────────────────────────────────────

function computeFit(agentProfile, hackathon) {
  const agentTags = new Set(agentProfile.thesis_tags || []);
  const hackThemes = new Set(hackathon.themes || []);
  const agentSkills = Object.keys(agentProfile.skills || {});
  
  // Tag overlap
  const tagOverlap = [...hackThemes].filter(t => agentTags.has(t)).length;
  const tagScore = hackThemes.size > 0 ? tagOverlap / hackThemes.size : 0;
  
  // Skill match
  const requiredSkills = hackathon.required_tech || hackathon.themes || [];
  const skillMatch = requiredSkills.filter(s => 
    agentSkills.some(a => a.toLowerCase().includes(s.toLowerCase()) || s.toLowerCase().includes(a.toLowerCase()))
  ).length;
  const skillScore = requiredSkills.length > 0 ? skillMatch / requiredSkills.length : 0.5;
  
  // Reuse potential
  const reuse = agentProfile.reuse_by_event?.[hackathon.slug] || agentProfile.reuse_by_event?._default || 0.15;
  
  // Composite fit
  const fit = (tagScore * 0.35 + skillScore * 0.35 + reuse * 0.30);
  return {
    fit_score: Math.round(fit * 100),
    tag_overlap: tagScore,
    skill_match: skillScore,
    reuse_potential: reuse,
    matched_tags: [...hackThemes].filter(t => agentTags.has(t)),
    matched_skills: requiredSkills.filter(s => agentSkills.some(a => a.toLowerCase().includes(s.toLowerCase()))),
  };
}

// ── HH API Wrapper ─────────────────────────────────────────────────────────

async function hhRequest(method, endpoint, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint, HH_API);
    const opts = {
      method,
      hostname: url.hostname,
      port: url.port || 3847,
      path: url.pathname + url.search,
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

// ── MCP Tool Definitions ───────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'hackathonhelp_register',
    description: 'Register as an agent with your capabilities and get an API key',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Unique agent identifier' },
        capabilities: { type: 'array', items: { type: 'string' }, description: 'e.g. ["research", "build", "crawl"]' },
      },
      required: ['agent_id'],
    },
  },
  {
    name: 'hackathonhelp_profile',
    description: 'Get or update your agent profile (skills, thesis tags, assets)',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Your agent ID' },
        skills: { type: 'object', description: 'Skill name → proficiency (0-1)' },
        thesis_tags: { type: 'array', items: { type: 'string' }, description: 'Topics you specialize in' },
        assets: { type: 'array', items: { type: 'object' }, description: 'Your repos/tools with tags' },
      },
      required: ['agent_id'],
    },
  },
  {
    name: 'hackathonhelp_discover',
    description: 'Find hackathons matching your skills and interests',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Your agent ID' },
        limit: { type: 'number', description: 'Max results (default 10)' },
        min_fit: { type: 'number', description: 'Minimum fit score 0-100 (default 50)' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Filter by theme tags' },
      },
      required: ['agent_id'],
    },
  },
  {
    name: 'hackathonhelp_enter',
    description: 'Activate a hackathon entry, generate tasks and rubric from judging criteria',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Your agent ID' },
        slug: { type: 'string', description: 'Hackathon slug from discover' },
        url: { type: 'string', description: 'Hackathon URL' },
        judging_criteria: {
          type: 'array',
          items: { type: 'string' },
          description: 'Judging criteria names to auto-generate rubric (e.g. ["Innovation","Technical Execution","Design"])'
        },
      },
      required: ['agent_id', 'slug', 'url'],
    },
  },
  {
    name: 'hackathonhelp_my_tasks',
    description: 'List tasks assigned to you across all active hackathons',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Your agent ID' },
        status: { type: 'string', description: 'Filter: queued, claimed, in_progress, done' },
      },
      required: ['agent_id'],
    },
  },
  {
    name: 'hackathonhelp_claim_task',
    description: 'Claim a task for yourself',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Your agent ID' },
        task_id: { type: 'string', description: 'Task ID to claim' },
      },
      required: ['agent_id', 'task_id'],
    },
  },
  {
    name: 'hackathonhelp_complete_task',
    description: 'Mark a task as done with your output',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Your agent ID' },
        task_id: { type: 'string', description: 'Task ID to complete' },
        output: { type: 'object', description: 'Your deliverable (findings, files, etc)' },
      },
      required: ['agent_id', 'task_id', 'output'],
    },
  },
  {
    name: 'hackathonhelp_score',
    description: 'Score a hackathon criterion with your assessment',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Your agent ID' },
        slug: { type: 'string', description: 'Hackathon slug' },
        criterion: { type: 'string', description: 'Criterion name' },
        score: { type: 'number', description: 'Score 0-100' },
        notes: { type: 'string', description: 'Why this score' },
      },
      required: ['agent_id', 'slug', 'criterion', 'score'],
    },
  },
  {
    name: 'hackathonhelp_rubric',
    description: 'Get the rubric/scoring criteria for a hackathon',
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: 'Hackathon slug' },
      },
      required: ['slug'],
    },
  },
  {
    name: 'hackathonhelp_checklist',
    description: 'Get submission readiness checklist for a hackathon',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Your agent ID' },
        slug: { type: 'string', description: 'Hackathon slug' },
      },
      required: ['agent_id', 'slug'],
    },
  },
  {
    name: 'hackathonhelp_hub',
    description: 'See overall state: active hackathons, agent activity, task queue',
    inputSchema: { type: 'object', properties: {} },
  },
];

// ── Tool Handlers ──────────────────────────────────────────────────────────

async function handleTool(name, args) {
  switch (name) {
    case 'hackathonhelp_register': {
      const hh = await hhRequest('POST', '/api/v2/agents/register', {
        agent_id: args.agent_id,
        capabilities: args.capabilities || [],
      });
      if (hh.error) return { content: [{ type: 'text', text: `Error: ${hh.error}` }] };
      // Also create local profile
      getOrCreateProfile(args.agent_id, args.capabilities || []);
      return { content: [{ type: 'text', text: JSON.stringify({
        message: 'Registered on HackathonHelp and created local profile',
        agent_id: hh.agent_id,
        api_key: hh.api_key,
        capabilities: hh.capabilities,
      }, null, 2) }] };
    }

    case 'hackathonhelp_profile': {
      const profile = getOrCreateProfile(args.agent_id);
      if (args.skills) profile.skills = { ...profile.skills, ...args.skills };
      if (args.thesis_tags) profile.thesis_tags = [...new Set([...profile.thesis_tags, ...args.thesis_tags])];
      if (args.assets) profile.assets = [...profile.assets, ...args.assets];
      // Save updated profile
      const reg = loadProfiles();
      reg.agents[args.agent_id] = profile;
      saveProfiles(reg);
      return { content: [{ type: 'text', text: JSON.stringify(profile, null, 2) }] };
    }

    case 'hackathonhelp_discover': {
      const profile = getOrCreateProfile(args.agent_id);
      const hh = await hhRequest('GET', '/api/v1/opportunities.json');
      // API returns {generated_at, opportunities:[...]} not a bare array
      const opps = Array.isArray(hh) ? hh : (hh?.opportunities || []);
      if (!opps.length) return { content: [{ type: 'text', text: 'No opportunities found' }] };
        .filter(o => o.decision?.action !== 'SKIP' && o.decision?.action !== 'ENDED')
        .filter(o => {
          const daysLeft = o.metrics?.days_left || 0;
          return daysLeft > 0;
        });

      // Filter by tags if provided
      if (args.tags?.length) {
        opps = opps.filter(o => o.themes?.some(t => args.tags.includes(t)));
      }

      // Compute fit for each and sort
      opps = opps.map(o => ({
        slug: o.slug,
        title: o.title,
        opportunity_score: o.score_v01?.opportunity_score || 0,
        action: o.decision?.action || 'WATCH',
        days_left: o.metrics?.days_left || 0,
        prize: o.prize?.headline_inflation || o.prize?.normalized_value || 0,
        themes: o.themes || [],
        ...computeFit(profile, o),
      }));

      opps.sort((a, b) => b.fit_score - a.fit_score);
      opps = opps.slice(0, args.limit || 10);

      // Filter by min_fit
      const minFit = args.min_fit || 0;
      const filtered = opps.filter(o => o.fit_score >= minFit);

      return { content: [{ type: 'text', text: JSON.stringify({
        count: filtered.length,
        opportunities: filtered.map(o => ({
          slug: o.slug,
          title: o.title,
          fit: o.fit_score,
          action: o.action,
          days_left: o.days_left,
          prize: o.prize,
          matched_tags: o.matched_tags,
          matched_skills: o.matched_skills,
        })),
      }, null, 2) }] };
    }

    case 'hackathonhelp_enter': {
      const hh = await hhRequest('POST', '/api/v2/hackathons/activate', {
        slug: args.slug,
        url: args.url,
        judging_criteria: args.judging_criteria,
      });
      if (hh.error) return { content: [{ type: 'text', text: `Error: ${hh.error}` }] };
      
      // Track in profile
      const profile = getOrCreateProfile(args.agent_id);
      profile.hackathons_entered.push({ slug: args.slug, entered_at: new Date().toISOString() });
      const reg = loadProfiles();
      reg.agents[args.agent_id] = profile;
      saveProfiles(reg);

      return { content: [{ type: 'text', text: JSON.stringify({
        message: hh.message || `Activated ${args.slug}`,
        slug: args.slug,
        tasks: hh.tasks || 0,
        has_rubric: hh.has_rubric || false,
        rubric_criteria: hh.rubric_criteria || 0,
        next: hh.has_rubric
          ? `Score with hackathonhelp_score, then claim tasks`
          : `Add judging_criteria to generate rubric, or create manually`,
      }, null, 2) }] };
    }

    case 'hackathonhelp_my_tasks': {
      const hh = await hhRequest('GET', '/api/v2/tasks', null);
      if (!hh?.tasks) return { content: [{ type: 'text', text: 'No tasks found' }] };
      
      let tasks = hh.tasks.filter(t => t.assigned_to === args.agent_id);
      if (args.status) tasks = tasks.filter(t => t.status === args.status);

      return { content: [{ type: 'text', text: JSON.stringify({
        count: tasks.length,
        tasks: tasks.map(t => ({
          id: t.id,
          slug: t._slug,
          type: t.type,
          description: t.description,
          status: t.status,
          assigned_to: t.assigned_to,
        })),
      }, null, 2) }] };
    }

    case 'hackathonhelp_claim_task': {
      const hh = await hhRequest('POST', '/api/v2/tasks/claim', { task_id: args.task_id });
      if (hh.error) return { content: [{ type: 'text', text: `Error: ${hh.error}` }] };
      return { content: [{ type: 'text', text: JSON.stringify(hh, null, 2) }] };
    }

    case 'hackathonhelp_complete_task': {
      const hh = await hhRequest('POST', '/api/v2/tasks/complete', {
        task_id: args.task_id,
        output: args.output,
      });
      if (hh.error) return { content: [{ type: 'text', text: `Error: ${hh.error}` }] };
      
      // Update profile stats
      const profile = getOrCreateProfile(args.agent_id);
      profile.total_tasks_completed = (profile.total_tasks_completed || 0) + 1;
      const reg = loadProfiles();
      reg.agents[args.agent_id] = profile;
      saveProfiles(reg);

      return { content: [{ type: 'text', text: JSON.stringify({
        ...hh,
        tasks_completed: profile.total_tasks_completed,
      }, null, 2) }] };
    }

    case 'hackathonhelp_score': {
      const hh = await hhRequest('POST', `/api/v2/hackathons/${args.slug}/score`, {
        criterion: args.criterion,
        score: args.score,
        notes: args.notes,
      });
      if (hh.error) return { content: [{ type: 'text', text: `Error: ${hh.error}` }] };
      return { content: [{ type: 'text', text: JSON.stringify(hh, null, 2) }] };
    }

    case 'hackathonhelp_rubric': {
      const hh = await hhRequest('GET', `/api/v2/rubric/${args.slug}`);
      if (hh.error) return { content: [{ type: 'text', text: `Error: ${hh.error}` }] };
      return { content: [{ type: 'text', text: JSON.stringify(hh, null, 2) }] };
    }

    case 'hackathonhelp_checklist': {
      const hh = await hhRequest('GET', `/api/v2/checklist/${args.slug}`);
      if (hh.error) return { content: [{ type: 'text', text: `Error: ${hh.error}` }] };
      return { content: [{ type: 'text', text: JSON.stringify(hh, null, 2) }] };
    }

    case 'hackathonhelp_hub': {
      const hh = await hhRequest('GET', '/api/v1/coordination/hub.json');
      return { content: [{ type: 'text', text: JSON.stringify(hh, null, 2) }] };
    }

    default:
      return { content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
  }
}

// ── MCP Protocol (stdio) ───────────────────────────────────────────────────

function parseMessage(input) {
  try { return JSON.parse(input); }
  catch { return null; }
}

function sendResponse(id, result) {
  const msg = JSON.stringify({ jsonrpc: '2.0', id, result });
  process.stdout.write(`Content-Length: ${Buffer.byteLength(msg)}\r\n\r\n${msg}`);
}

function sendError(id, code, message) {
  const msg = JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } });
  process.stdout.write(`Content-Length: ${Buffer.byteLength(msg)}\r\n\r\n${msg}`);
}

let buffer = '';
process.stdin.on('data', async (chunk) => {
  buffer += chunk.toString();
  while (true) {
    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd === -1) break;
    const header = buffer.slice(0, headerEnd);
    const match = header.match(/Content-Length: (\d+)/);
    if (!match) { buffer = buffer.slice(headerEnd + 4); continue; }
    const len = parseInt(match[1]);
    const start = headerEnd + 4;
    if (buffer.length < start + len) break;
    const body = buffer.slice(start, start + len);
    buffer = buffer.slice(start + len);

    const msg = parseMessage(body);
    if (!msg) continue;

    const { id, method, params } = msg;

    if (method === 'initialize') {
      sendResponse(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'hackathonhelp', version: '1.0.0' },
      });
    } else if (method === 'tools/list') {
      sendResponse(id, { tools: TOOLS });
    } else if (method === 'tools/call') {
      const { name, arguments: args } = params;
      try {
        const result = await handleTool(name, args || {});
        sendResponse(id, result);
      } catch (e) {
        sendError(id, -1, e.message);
      }
    } else if (method === 'ping') {
      sendResponse(id, {});
    } else {
      sendError(id, -32601, `Method not found: ${method}`);
    }
  }
});

process.stderr.write(`HackathonHelp MCP server running (stdio)\n`);
