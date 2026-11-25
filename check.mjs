import { enqueue } from './alerts.mjs';
import { readFile, writeFile } from 'node:fs/promises';

const snapshotFile = new URL('./public/status-data.js', import.meta.url);
const assignment = 'globalThis.peledexStatus = ';
const source = await readFile(snapshotFile, 'utf8');
const previous = JSON.parse(source.trimEnd().slice(assignment.length, -1));
const targets = Object.entries({ landing: process.env.LANDING_URL, health: process.env.HEALTH_URL });
const dateKey = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' });

for (const [service, url] of targets) {
  if (!URL.canParse(url) || new URL(url).protocol !== 'https:') {
    throw new Error(`Configure uma URL HTTPS para ${service}.`);
  }
}

async function check(service, url) {
  try {
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(12_000) });
    if (service === 'health' && response.status === 200) {
      const result = await response.json();
      return result.status === 'ok' && result.checks?.mongo === 'ok' && result.checks?.api === 'ok';
    }
    await response.body?.cancel();
    return response.status === 200;
  } catch {
    return false;
  }
}

const results = await Promise.all(targets.map(async ([service, url]) => [service, await check(service, url)]));
const checkedAt = new Date();
const today = dateKey.format(checkedAt);
const cutoff = new Date(`${today}T00:00:00Z`);
cutoff.setUTCDate(cutoff.getUTCDate() - 89);
const firstDay = cutoff.toISOString().slice(0, 10);
const services = {};

for (const [service, ok] of results) {
  const past = previous.services?.[service]?.days ?? {};
  const days = Object.fromEntries(Object.entries(past).filter(([date]) => date >= firstDay && date <= today));
  const counts = days[today] ?? { up: 0, down: 0 };
  const state = ok ? 'up' : 'down';
  counts[state] += 1;
  days[today] = counts;
  services[service] = { state, days };
  console.log(`${service}: ${state}`);
}

const snapshot = { checkedAt: checkedAt.toISOString(), services };
await writeFile(snapshotFile, `${assignment}${JSON.stringify(snapshot, null, 2)};\n`);

await enqueue(previous, snapshot);
