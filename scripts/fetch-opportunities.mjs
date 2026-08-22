// Deterministic fetch from Devpost public API → data/seed.json
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const PAGES = parseInt(process.env.PAGES || '8');

function parsePrize(html) {
  if (!html) return null;
  const m = String(html).match(/data-currency-value>([\d,.]+)</);
  if (!m) {
    const m2 = String(html).match(/([\d,.]+)/);
    if (!m2) return null;
    return parseFloat(m2[1].replace(/,/g, '')) || null;
  }
  return parseFloat(m[1].replace(/,/g, '')) || null;
}

function parseDates(str) {
  // "Jul 31 - Oct 01, 2026"
  const m = str.match(/(\w{3}) (\d+) - (\w{3}) (\d+), (\d+)/);
  if (!m) return {};
  const months = {Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
  const year = +m[5];
  return {
    starts_at: new Date(Date.UTC(year, months[m[1]], +m[2])).toISOString(),
    ends_at: new Date(Date.UTC(year, months[m[3]], +m[4], 23, 59)).toISOString(),
  };
}

const seen = new Set();
const opportunities = [];
for (let p = 1; p <= PAGES; p++) {
  const res = await fetch(`https://devpost.com/api/hackathons?page=${p}`);
  const d = await res.json();
  for (const h of d.hackathons ?? []) {
    if (!h.url || seen.has(h.url)) continue;
    seen.add(h.url);
    const dates = parseDates(h.submission_period_dates || '');
    const loc = h.displayed_location?.location || 'Unknown';
    opportunities.push({
      id: h.url.replace(/https:\/\/([^./]+)\.devpost\.com\/?/, '$1'),
      slug: h.url.replace(/https:\/\/([^./]+)\.devpost\.com\/?/, '$1'),
      title: h.title,
      organizer: h.organization || h.title.split(' ')[0],
      prize_usd: parsePrize(h.prize_amount),
      prize_raw: (h.prize_amount || '').replace(/<[^>]*>/g, '').trim(),
      registrants: h.registrations_count ?? null,
      starts_at: dates.starts_at ?? null,
      ends_at: dates.ends_at ?? null,
      time_left: h.time_left_to_submission || null,
      location_type: /online/i.test(loc) ? 'online' : 'in-person',
      location: loc,
      themes: (h.themes || []).map(t => t.name),
      open_to_all: !h.private,
      source_url: h.url,
      source_authority: 'official_platform_api',
      observed_at: new Date().toISOString(),
    });
  }
}
opportunities.sort((a,b) => (b.prize_usd||0)-(a.prize_usd||0));
fs.mkdirSync(path.join(ROOT,'data'), {recursive:true});
fs.writeFileSync(path.join(ROOT,'data/seed.json'), JSON.stringify({
  schema_version:'hackathonhelp.seed.v1',
  generated_at:new Date().toISOString(),
  source:'devpost.com/api/hackathons (official platform API)',
  count: opportunities.length,
  opportunities
}, null, 2));
console.log(`fetch: ${opportunities.length} opportunities across ${PAGES} pages`);
