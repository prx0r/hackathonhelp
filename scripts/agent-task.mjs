#!/usr/bin/env node
// agent-task.mjs — Agent coordination interface for HackathonHelp
// Usage:
//   node scripts/agent-task.mjs list [slug]           — show tasks (all or per hackathon)
//   node scripts/agent-task.mjs claim <task-id> <agent-id>  — claim a queued task
//   node scripts/agent-task.mjs update <task-id> <agent-id> --status <s> --notes "..."  — update progress
//   node scripts/agent-task.mjs complete <task-id> <agent-id> --output '{"file":"..."}'  — mark done
//   node scripts/agent-task.mjs add <slug> --type <t> --title "..." --priority <p>  — add a new task
//   node scripts/agent-task.mjs register <agent-id> --caps "research,build"  — register as available agent
//   node scripts/agent-task.mjs status                — show overall coordination status
//   node scripts/agent-task.mjs next <agent-id>       — get next available task for this agent

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const HUB_PATH = path.join(ROOT, 'data/coordination/hub.json');
const ACTIVE_DIR = path.join(ROOT, 'data/active');

function loadHub() {
  return JSON.parse(fs.readFileSync(HUB_PATH, 'utf8'));
}
function saveHub(hub) {
  hub.generated_at = new Date().toISOString();
  fs.writeFileSync(HUB_PATH, JSON.stringify(hub, null, 2));
}
function loadActive(slug) {
  const f = path.join(ACTIVE_DIR, `${slug}.json`);
  if (!fs.existsSync(f)) return null;
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}
function saveActive(slug, data) {
  fs.writeFileSync(path.join(ACTIVE_DIR, `${slug}.json`), JSON.stringify(data, null, 2));
}
function getAllTasks(hub) {
  const tasks = [];
  for (const h of hub.active_hackathons) {
    const active = loadActive(h.slug);
    if (active?.tasks) {
      for (const t of active.tasks) {
        tasks.push({ ...t, _slug: h.slug, _title: h.title });
      }
    }
  }
  return tasks;
}
function genId(slug, type, title) {
  const short = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30);
  return `${slug}-${type}-${short}`;
}

// ---- parse args ----
const [, , cmd, ...rest] = process.argv;
const args = rest.filter(a => !a.startsWith('--'));
const flags = {};
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith('--')) {
    const key = rest[i].slice(2);
    flags[key] = rest[i + 1] || true;
    i++;
  }
}

const hub = loadHub();

switch (cmd) {
  case 'status': {
    const allTasks = getAllTasks(hub);
    const byStatus = {};
    for (const t of allTasks) {
      byStatus[t.status] = (byStatus[t.status] || 0) + 1;
    }
    console.log(JSON.stringify({
      hackathons: hub.active_hackathons.length,
      agents: Object.keys(hub.agents).length,
      tasks: { total: allTasks.length, ...byStatus },
      conflicts: hub.conflicts.length,
      recent_completions: hub.recent_completions.length,
    }, null, 2));
    break;
  }

  case 'list': {
    const slugFilter = args[0];
    const allTasks = getAllTasks(hub);
    const filtered = slugFilter ? allTasks.filter(t => t._slug === slugFilter) : allTasks;
    // Sort: queued first, then by priority
    const prio = { critical: 0, high: 1, medium: 2, low: 3 };
    filtered.sort((a, b) => (prio[a.priority] ?? 9) - (prio[b.priority] ?? 9));
    for (const t of filtered) {
      const assignee = t.assigned_to ? ` [${t.assigned_to}]` : '';
      const statusIcon = { queued: '○', claimed: '◐', in_progress: '●', review: '◈', done: '✓', blocked: '✗' }[t.status] || '?';
      console.log(`${statusIcon} ${t.id} (${t.type}) — ${t.title}${assignee}`);
    }
    if (!filtered.length) console.log('No tasks found.');
    break;
  }

  case 'claim': {
    const [taskId, agentId] = args;
    if (!taskId || !agentId) { console.error('Usage: claim <task-id> <agent-id>'); process.exit(1); }
    let found = false;
    for (const h of hub.active_hackathons) {
      const active = loadActive(h.slug);
      if (!active?.tasks) continue;
      const task = active.tasks.find(t => t.id === taskId);
      if (!task) continue;
      if (task.status !== 'queued') {
        console.error(`Cannot claim: task is ${task.status}${task.assigned_to ? ` (assigned to ${task.assigned_to})` : ''}`);
        process.exit(1);
      }
      task.status = 'claimed';
      task.assigned_to = agentId;
      task.claimed_at = new Date().toISOString();
      saveActive(h.slug, active);
      // Also add to hub task_queue for visibility
      hub.task_queue = hub.task_queue.filter(id => id !== taskId);
      console.log(`Claimed: ${taskId} → ${agentId}`);
      found = true;
      break;
    }
    if (!found) { console.error(`Task not found: ${taskId}`); process.exit(1); }
    saveHub(hub);
    break;
  }

  case 'update': {
    const [taskId, agentId] = args;
    if (!taskId || !agentId) { console.error('Usage: update <task-id> <agent-id> --status <s> --notes "..."'); process.exit(1); }
    let found = false;
    for (const h of hub.active_hackathons) {
      const active = loadActive(h.slug);
      if (!active?.tasks) continue;
      const task = active.tasks.find(t => t.id === taskId);
      if (!task) continue;
      if (task.assigned_to !== agentId) {
        console.error(`Not your task: assigned to ${task.assigned_to}`);
        process.exit(1);
      }
      if (flags.status) task.status = flags.status;
      if (flags.notes) {
        task.notes = task.notes ? `${task.notes}\n[${new Date().toISOString()}] ${flags.notes}` : flags.notes;
      }
      if (flags.notes && active.progress) {
        active.progress.last_update = new Date().toISOString();
        active.progress.updated_by = agentId;
      }
      saveActive(h.slug, active);
      console.log(`Updated: ${taskId}`);
      found = true;
      break;
    }
    if (!found) { console.error(`Task not found: ${taskId}`); process.exit(1); }
    saveHub(hub);
    break;
  }

  case 'complete': {
    const [taskId, agentId] = args;
    if (!taskId || !agentId) { console.error('Usage: complete <task-id> <agent-id> --output \'{"key":"val"}\''); process.exit(1); }
    let found = false;
    for (const h of hub.active_hackathons) {
      const active = loadActive(h.slug);
      if (!active?.tasks) continue;
      const task = active.tasks.find(t => t.id === taskId);
      if (!task) continue;
      if (task.assigned_to !== agentId) {
        console.error(`Not your task: assigned to ${task.assigned_to}`);
        process.exit(1);
      }
      task.status = 'done';
      task.completed_at = new Date().toISOString();
      if (flags.output) {
        try { task.output = JSON.parse(flags.output); } catch { task.output = { raw: flags.output }; }
      }
      // Update hackathon progress
      if (active.progress) {
        const total = active.tasks.length;
        const done = active.tasks.filter(t => t.status === 'done').length;
        active.progress.pct_complete = Math.round((done / total) * 100);
        active.progress.last_update = new Date().toISOString();
        active.progress.updated_by = agentId;
      }
      saveActive(h.slug, active);
      hub.recent_completions.push({
        task_id: taskId, agent: agentId, completed_at: task.completed_at, slug: h.slug
      });
      // Keep only last 50 completions
      if (hub.recent_completions.length > 50) hub.recent_completions = hub.recent_completions.slice(-50);
      console.log(`Completed: ${taskId}`);
      found = true;
      break;
    }
    if (!found) { console.error(`Task not found: ${taskId}`); process.exit(1); }
    saveHub(hub);
    break;
  }

  case 'add': {
    const [slug] = args;
    if (!slug) { console.error('Usage: add <slug> --type <t> --title "..." --priority <p>'); process.exit(1); }
    const active = loadActive(slug);
    if (!active) { console.error(`No active hackathon: ${slug}`); process.exit(1); }
    if (!active.tasks) active.tasks = [];
    const type = flags.type || 'research';
    const title = flags.title || 'Untitled task';
    const priority = flags.priority || 'medium';
    const id = genId(slug, type, title);
    if (active.tasks.find(t => t.id === id)) {
      console.error(`Task already exists: ${id}`);
      process.exit(1);
    }
    const task = {
      id, type, title,
      description: flags.description || null,
      status: 'queued',
      assigned_to: null,
      claimed_at: null,
      priority,
      depends_on: flags.depends ? flags.depends.split(',') : [],
      deliverables: flags.deliverables ? flags.deliverables.split(',') : [],
      notes: null,
      deadline: flags.deadline || null,
      estimated_hours: flags.hours ? parseFloat(flags.hours) : null,
      completed_at: null,
      output: null,
    };
    active.tasks.push(task);
    // Ensure progress object
    if (!active.progress) {
      active.progress = {
        phase: 'research',
        pct_complete: 0,
        blocks: [],
        last_update: new Date().toISOString(),
        updated_by: null,
      };
    }
    saveActive(slug, active);
    hub.task_queue.push(id);
    saveHub(hub);
    console.log(`Added: ${id}`);
    break;
  }

  case 'register': {
    const [agentId] = args;
    if (!agentId) { console.error('Usage: register <agent-id> --caps "research,build"'); process.exit(1); }
    hub.agents[agentId] = {
      capabilities: (flags.caps || '').split(',').map(s => s.trim()).filter(Boolean),
      registered_at: hub.agents[agentId]?.registered_at || new Date().toISOString(),
      last_seen: new Date().toISOString(),
      tasks_completed: hub.agents[agentId]?.tasks_completed || 0,
    };
    saveHub(hub);
    console.log(`Registered agent: ${agentId}`);
    break;
  }

  case 'next': {
    const [agentId] = args;
    if (!agentId) { console.error('Usage: next <agent-id>'); process.exit(1); }
    // Update last_seen
    if (hub.agents[agentId]) hub.agents[agentId].last_seen = new Date().toISOString();
    // Find highest-priority queued task that matches agent capabilities
    const allTasks = getAllTasks(hub);
    const available = allTasks.filter(t => t.status === 'queued');
    const prio = { critical: 0, high: 1, medium: 2, low: 3 };
    available.sort((a, b) => (prio[a.priority] ?? 9) - (prio[b.priority] ?? 9));
    if (available.length) {
      console.log(JSON.stringify(available[0], null, 2));
    } else {
      console.log(JSON.stringify({ message: 'No tasks available. Check back later or add new tasks.' }));
    }
    saveHub(hub);
    break;
  }

  default:
    console.error(`Unknown command: ${cmd}
Commands: status, list, claim, update, complete, add, register, next`);
    process.exit(1);
}
