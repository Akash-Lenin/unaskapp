const target = process.env.TARGET_URL ?? 'http://localhost:3000';
const requests = Number(process.env.LOAD_REQUESTS ?? 100);
const concurrency = Number(process.env.LOAD_CONCURRENCY ?? 10);

if (!Number.isSafeInteger(requests) || requests < 1) throw new Error('Invalid LOAD_REQUESTS');
if (!Number.isSafeInteger(concurrency) || concurrency < 1) throw new Error('Invalid LOAD_CONCURRENCY');

const timings = [];
let next = 0;
let failures = 0;

async function worker() {
  while (next < requests) {
    next += 1;
    const started = performance.now();
    try {
      const response = await fetch(`${target.replace(/\/$/, '')}/api/health`, {
        redirect: 'error',
      });
      if (!response.ok) failures += 1;
    } catch {
      failures += 1;
    }
    timings.push(performance.now() - started);
  }
}

await Promise.all(Array.from({ length: Math.min(concurrency, requests) }, worker));
timings.sort((a, b) => a - b);
const percentile = (p) => timings[Math.min(timings.length - 1, Math.floor(timings.length * p))];

console.log(JSON.stringify({
  target,
  requests,
  concurrency,
  failures,
  p50_ms: Math.round(percentile(0.5)),
  p95_ms: Math.round(percentile(0.95)),
  max_ms: Math.round(timings.at(-1) ?? 0),
}, null, 2));

if (failures > 0) process.exitCode = 1;
