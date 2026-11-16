// CelesTrak usage-policy.php, checked 16 November 2026. No per-visitor requests.
// One shared cache per provider run. Terminal errors stop all further queries.
export const QUIET = 15 * 60 * 1000;
export function createAcquirer({fetcher = fetch, sleep = ms => new Promise(r => setTimeout(r, ms)),
  now = Date.now, cache = new Map()} = {}) {
  const pending = new Map();
  let stopped = false;
  return function get(url, ttl) {
    if (stopped) return Promise.reject(Error('CelesTrak run stopped; investigate before querying again'));
    if (pending.has(url)) return pending.get(url);
    const task = (async () => {
      const hit = cache.get(url);
      if (hit && Number.isFinite(hit.acquired) && now() >= hit.acquired && now() - hit.acquired < ttl && typeof hit.body === 'string') return hit;
      for (let attempt = 0; attempt < 3; attempt++) {
        let res;
        try {
          res = await fetcher(url, {redirect:'error', signal:AbortSignal.timeout(30000), headers:{
            'User-Agent':'ElusionWorks-OrbitCensus/1.0 (+https://elusionworks.com/demos/orbit-census/)',
            Accept:'text/csv, */*;q=0.8', 'Accept-Encoding':'gzip, br'}});
          if (res.status !== 200) {
            const transient = [500,502,503,504].includes(res.status);
            await res.body?.cancel();
            if (!transient) {stopped=true; throw Error(`CelesTrak HTTP ${res.status}; run stopped`);}
            if (attempt === 2) {stopped=true; throw Error(`CelesTrak HTTP ${res.status}; retries exhausted`);}
            const retry = res.headers?.get('retry-after');
            const seconds = retry && /^\d+$/.test(retry) ? Number(retry)*1000 : Date.parse(retry)-now();
            // Never shorten a provider quiet period. Excessive Retry-After stops this run.
            const delay = Math.max(QUIET * 2**attempt, Number.isFinite(seconds)?seconds:0);
            if (delay > 60*60*1000) {stopped=true; throw Error('Provider requested a longer pause; run stopped');}
            await sleep(delay); continue;
          }
          const body = await res.text();
          const value = {body, acquired:now(), lastModified:res.headers?.get('last-modified')||null, etag:res.headers?.get('etag')||null};
          cache.set(url,value); return value;
        } catch (error) {
          if (stopped) throw error;
          if (attempt === 2) {stopped=true; throw Error('CelesTrak network retries exhausted; run stopped');}
          await sleep(QUIET * 2**attempt);
        }
      }
    })();
    pending.set(url,task); return task;
  };
}
