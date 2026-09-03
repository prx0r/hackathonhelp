#!/usr/bin/env node
/**
 * LLMDeals → HackathonHelp Oracle Adapter
 * 
 * Pulls AI tool costs from LLMDeals and feeds them into HackathonHelp's
 * opportunity scoring. When an agent evaluates a hackathon, it needs to know:
 * "Can I afford the AI tools needed for this hackathon?"
 * 
 * Usage:
 *   node scripts/llmdeals-adapter.mjs                    # sync once
 *   node scripts/llmdeals-adapter.mjs --daemon           # hourly sync
 *   node scripts/llmdeals-adapter.mjs --budget 50        # filter by budget
 *   node scripts/llmdeals-adapter.mjs --agent hermes-1   # per-agent view
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

const ROOT = path.resolve(import.meta.dirname, '..');
const LLMDEALS_API = process.env.LLMDEALS_API || 'http://localhost:3847';
const INTEL_PATH = path.join(ROOT, 'data/ai-tool-intel.json');
const INTERVAL_MS = parseInt(process.env.ADAPTER_INTERVAL || '3600000');

// ── LLMDeals API ───────────────────────────────────────────────────────────

async function fetchDeals() {
  return new Promise((resolve, reject) => {
    // Try local LLMDeals API first, fall back to static file
    const req = http.get(`${LLMDEALS_API}/api/v1/deals.json`, { timeout: 10000 }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(null); }
      });
    });
    req.on('error', () => {
      // Fallback: try reading from llmdeals repo directly
      const fallback = '/root/llmdeals/web/public/api/v1/deals.json';
      if (fs.existsSync(fallback)) {
        try { resolve(JSON.parse(fs.readFileSync(fallback, 'utf8'))); }
        catch { resolve(null); }
      } else { resolve(null); }
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

// ── Score a hackathon's AI tool requirements against deals ──────────────────

function scoreToolRequirements(hackathon, deals, budget) {
  const themes = hackathon.themes || [];
  const requiredTech = hackathon.required_tech || [];
  
  // Map hackathon themes/tech to deal categories
  const categoryMap = {
    'ai': ['ai', 'llm', 'inference', 'model'],
    'ml': ['ai', 'ml', 'inference'],
    'research': ['search', 'research', 'data'],
    'agents': ['ai', 'agents', 'inference'],
    'image': ['image', 'generation', 'ai'],
    'video': ['video', 'generation'],
    'data': ['data', 'api', 'search'],
    'web3': ['blockchain', 'web3', 'defi'],
  };
  
  // Find relevant deals
  const relevantDeals = [];
  const allDeals = deals?.deals || deals || [];
  
  for (const deal of allDeals) {
    const dealText = `${deal.provider || ''} ${deal.product || ''} ${deal.offer_type || ''} ${(deal.tags || []).join(' ')}`.toLowerCase();
    
    for (const theme of [...themes, ...requiredTech]) {
      const keywords = categoryMap[theme.toLowerCase()] || [theme.toLowerCase()];
      if (keywords.some(kw => dealText.includes(kw))) {
        relevantDeals.push(deal);
        break;
      }
    }
  }
  
  if (relevantDeals.length === 0) {
    return { has_tools: false, total_cost: 0, deals: [], recommendation: 'No matching AI tools found' };
  }
  
  // Calculate cost for this hackathon
  let totalCost = 0;
  const freeTools = relevantDeals.filter(d => d.price === 0 || d.price === 'free' || d.savings_pct > 90);
  const cheapTools = relevantDeals.filter(d => {
    const price = typeof d.price === 'number' ? d.price : parseFloat(d.price) || 0;
    return price > 0 && price <= 0.01;
  });
  
  const affordable = freeTools.length > 0 || cheapTools.length > 0;
  
  // Estimate hackathon AI spend
  // Typical hackathon: 100-500 API calls over a weekend
  const estimatedCalls = 200;
  const avgCostPerCall = relevantDeals.reduce((sum, d) => {
    const price = typeof d.price === 'number' ? d.price : parseFloat(d.price) || 0;
    return sum + price;
  }, 0) / relevantDeals.length;
  
  totalCost = estimatedCalls * avgCostPerCall;
  
  return {
    has_tools: affordable,
    free_tools: freeTools.length,
    cheap_tools: cheapTools.length,
    total_relevant: relevantDeals.length,
    estimated_cost: Math.round(totalCost * 100) / 100,
    budget_sufficient: budget ? totalCost <= budget : true,
    deals: relevantDeals.slice(0, 5).map(d => ({
      provider: d.provider,
      product: d.product,
      price: d.price,
      savings: d.savings_pct,
    })),
    recommendation: affordable
      ? `${freeTools.length} free + ${cheapTools.length} cheap tools available`
      : `No affordable tools found. Estimated cost: $${totalCost.toFixed(2)}`,
  };
}

// ── Build AI tool intel ────────────────────────────────────────────────────

function buildToolIntel(hackathons, deals) {
  const intel = {
    generated_at: new Date().toISOString(),
    deals_summary: {
      total_deals: deals?.deals?.length || 0,
      free_deals: (deals?.deals || []).filter(d => d.price === 0 || d.savings_pct > 90).length,
      providers: [...new Set((deals?.deals || []).map(d => d.provider))].length,
    },
    hackathons: {},
  };
  
  for (const h of hackathons) {
    const score = scoreToolRequirements(h, deals, null);
    intel.hackathons[h.slug] = {
      title: h.title,
      has_tools: score.has_tools,
      estimated_cost: score.estimated_cost,
      relevant_deals: score.total_relevant,
      recommendation: score.recommendation,
    };
  }
  
  return intel;
}

// ── CLI ────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args.includes('--status')) {
  if (fs.existsSync(INTEL_PATH)) {
    const intel = JSON.parse(fs.readFileSync(INTEL_PATH, 'utf8'));
    console.log('AI Tool Intel:');
    console.log('  Generated:', intel.generated_at);
    console.log('  Deals:', intel.deals_summary?.total_deals);
    console.log('  Free tools:', intel.deals_summary?.free_deals);
    console.log('  Providers:', intel.deals_summary?.providers);
    console.log('  Hackathons scored:', Object.keys(intel.hackathons || {}).length);
  } else {
    console.log('No intel file. Run without --status first.');
  }
} else if (args.includes('--daemon')) {
  console.log(`[adapter] Starting hourly sync`);
  const loop = async () => {
    try {
      console.log('[adapter] Fetching deals...');
      const deals = await fetchDeals();
      if (!deals) { console.log('[adapter] No deals available'); }
      else {
        console.log(`[adapter] Got ${(deals.deals || []).length} deals`);
        // Load hackathons
        const selectedPath = path.join(ROOT, 'data/active/selected.json');
        const hackathons = fs.existsSync(selectedPath)
          ? JSON.parse(fs.readFileSync(selectedPath)).hackathons || []
          : [];
        
        const intel = buildToolIntel(hackathons, deals);
        fs.writeFileSync(INTEL_PATH, JSON.stringify(intel, null, 2));
        console.log(`[adapter] Intel saved for ${hackathons.length} hackathons`);
      }
    } catch (e) { console.error('[adapter] Error:', e.message); }
    setTimeout(loop, INTERVAL_MS);
  };
  loop();
} else {
  // One-shot sync
  (async () => {
    console.log('Fetching deals from LLMDeals...');
    const deals = await fetchDeals();
    if (!deals) {
      console.log('No deals available. Ensure LLMDeals API is running or static file exists.');
      process.exit(1);
    }
    
    const dealCount = deals.deals?.length || 0;
    const freeCount = (deals.deals || []).filter(d => d.price === 0 || d.savings_pct > 90).length;
    console.log(`Found ${dealCount} deals (${freeCount} free/cheap)`);
    
    // Load hackathons
    const selectedPath = path.join(ROOT, 'data/active/selected.json');
    const hackathons = fs.existsSync(selectedPath)
      ? JSON.parse(fs.readFileSync(selectedPath)).hackathons || []
      : [];
    
    // Score each hackathon
    const budget = args.find(a => a.startsWith('--budget='))?.split('=')[1];
    const intel = buildToolIntel(hackathons, deals);
    
    if (budget) {
      console.log(`\nBudget filter: $${budget}`);
      for (const [slug, info] of Object.entries(intel.hackathons)) {
        const afford = info.estimated_cost <= parseFloat(budget);
        console.log(`  ${afford ? '✓' : '✗'} ${info.title}: $${info.estimated_cost?.toFixed(2)} (${info.recommendation})`);
      }
    }
    
    fs.writeFileSync(INTEL_PATH, JSON.stringify(intel, null, 2));
    console.log(`\nIntel saved to ${INTEL_PATH}`);
  })();
}
