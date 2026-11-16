// CelesTrak usage-policy.php, checked 16 November 2026. No per-visitor requests.
export const QUIET = 15 * 60 * 1000;
export const RETRY_STATE = 'urn:elusionworks:celestrak:retry-deadline';
// Serialise provider requests across acquirers using the same cache, not just
// within one createAcquirer call. Workflow concurrency serialises hosted runs.
const sharedCaches = new WeakMap();
const redirectRejected = error => {
  const seen=new Set();
  for(let e=error;e&&!seen.has(e);e=e.cause){
    seen.add(e);
    if(/unexpected redirect|redirect(?:s)? (?:not allowed|disallowed|rejected)|redirect count exceeded/i.test(e.message||'') ||
      /^(?:UND_ERR_REDIRECT|ERR_FR_TOO_MANY_REDIRECTS)$/.test(e.code||''))return true;
  }
  return false;
};
export function createAcquirer({fetcher=fetch, sleep=ms=>new Promise(r=>setTimeout(r,ms)),
  now=Date.now, cache=new Map(), persist=async()=>{}}={}) {
  let shared=sharedCaches.get(cache);
  if(!shared){shared={tail:Promise.resolve(),inFlight:new Map(),terminal:false};sharedCaches.set(cache,shared);}
  const pending=new Map();let stopped=false;
  const stop=(message,terminal=false)=>{stopped=true;if(terminal)shared.terminal=true;return Error(message);};
  const persistCache=async()=>{try{await persist(cache);}catch{throw stop('Cannot persist CelesTrak cache; run stopped',true);}};
  function enforceDeadline(){
    const state=cache.get(RETRY_STATE);
    if(state!==undefined&&(!Number.isFinite(state?.retryUntil)||state.retryUntil<0))throw stop('Invalid provider retry deadline; run stopped');
    if(state?.retryUntil>now())throw stop('CelesTrak paused until '+new Date(state.retryUntil).toISOString());
  }
  async function pause(delay){
    const retryUntil=Math.max(cache.get(RETRY_STATE)?.retryUntil||0,now()+delay);
    cache.set(RETRY_STATE,{retryUntil});
    await persistCache(); // Save before sleeping, returning or failing.
  }
  function delayFor(res,attempt){
    const raw=res?.headers?.get('retry-after');
    const extra=raw&&/^\d+$/.test(raw)?Number(raw)*1000:Date.parse(raw)-now();
    return Math.max(QUIET*2**attempt,Number.isFinite(extra)?extra:0);
  }
  async function acquire(url,ttl){
    if(stopped||shared.terminal)throw stop('CelesTrak run stopped before a queued request');
    const hit=cache.get(url);
    // Serving already acquired data makes no provider request, even during a pause.
    if(hit&&Number.isFinite(hit.acquired)&&now()>=hit.acquired&&now()-hit.acquired<ttl&&typeof hit.body==='string')return hit;
    for(let attempt=0;attempt<3;attempt++){
      enforceDeadline();let res,body;
      try{
        res=await fetcher(url,{redirect:'error',signal:AbortSignal.timeout(30000),headers:{
          'User-Agent':'ElusionWorks-OrbitCensus/1.0 (+https://elusionworks.com/demos/orbit-census/)',
          Accept:'text/csv, */*;q=0.8','Accept-Encoding':'gzip, br'}});
        if(res.status===200)body=await res.text();
      }catch(error){
        if(redirectRejected(error))throw stop('CelesTrak redirect rejected; run stopped',true);
        const delay=delayFor(null,attempt);await pause(delay);
        if(attempt===2)throw stop('CelesTrak network retries exhausted; run stopped');
        await sleep(delay);continue;
      }
      if(res.status!==200){
        await res.body?.cancel();
        const transient=[500,502,503,504].includes(res.status);
        // A terminal throttle response may still instruct later runs to pause.
        if(!transient){
          if(res.headers?.get('retry-after'))await pause(delayFor(res,attempt));
          throw stop(`CelesTrak HTTP ${res.status}; run stopped`,true);
        }
        const delay=delayFor(res,attempt);await pause(delay);
        if(attempt===2)throw stop(`CelesTrak HTTP ${res.status}; retries exhausted`);
        if(delay>60*60*1000)throw stop('Provider requested a longer pause; run stopped');
        await sleep(delay);continue;
      }
      const value={body,acquired:now(),lastModified:res.headers?.get('last-modified')||null,etag:res.headers?.get('etag')||null};
      cache.set(url,value);await persistCache();return value;
    }
  }
  return function get(url,ttl){
    if(stopped||shared.terminal)return Promise.reject(Error('CelesTrak run stopped; investigate before querying again'));
    if(pending.has(url))return pending.get(url);
    let task=shared.inFlight.get(url);
    if(!task){
      task=shared.tail.then(()=>acquire(url,ttl));
      shared.tail=task.catch(()=>{});shared.inFlight.set(url,task);
      task.then(()=>shared.inFlight.delete(url),()=>shared.inFlight.delete(url));
    }
    pending.set(url,task);return task;
  };
}
