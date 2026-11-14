import path from 'node:path';
import {readFile,mkdir,writeFile,appendFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const failureLabels={
 monitor_setup_failed:'monitor setup failed',
 monitor_runtime_failed:'monitor runtime failed',
 site_down:'site down or unreachable',
 site_verification_failed:'site verification failed',
};
const message=error=>String(error?.message||error).split('\n')[0];

export async function checkSiteHealth({
 siteUrl=process.env.SITE_URL||'https://elusionworks.com/',
 readFeed=async()=>JSON.parse(await readFile(path.join(process.cwd(),'data/feed.json'),'utf8')),
 launchBrowser=async()=>{const {chromium}=await import('@playwright/test');return chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'msedge'});},
 fetchSecurity=fetch,
 screenshotPath='healthchecks/elusion-works-home.png',
}={}) {
 let browser,phase='setup',navigationAttempted=false,snapshot,expectedCounts,httpStatus;
 try {
  const base=new URL(siteUrl);
  if(base.protocol!=='https:')throw new Error('SITE_URL must use HTTPS');
  const feed=await readFeed();
  const counts=['sites','tools','games'].map(key=>feed?.stats?.[key]);
  if(counts.some(value=>!Number.isInteger(value)||value<0))throw new Error('Monitor feed has invalid expected counts');
  expectedCounts=counts.map(String);
  browser=await launchBrowser();
  const page=await browser.newPage({viewport:{width:1440,height:1200}});
  page.setDefaultTimeout(20000);
  const errors=[];
  page.on('console',entry=>{if(entry.type()==='error')errors.push(entry.text());});
  const visitUrl=new URL(base);visitUrl.searchParams.set('health',String(Date.now()));
  phase='navigation';navigationAttempted=true;
  const response=await page.goto(visitUrl.href,{waitUntil:'networkidle',timeout:30000});
  httpStatus=response?.status();
  if(httpStatus>=500)throw new Error('Homepage returned HTTP '+httpStatus);
  phase='verification';
  if(!response?.ok())throw new Error('Homepage returned HTTP '+(httpStatus??'unknown'));
  await page.waitForSelector('.ew-cabinet-grid .ew-plate');
  snapshot=await page.evaluate(()=>({
   counts:[...document.querySelectorAll('[data-count-to]')].map(node=>node.getAttribute('data-count-to')?.trim()??''),
   cards:{total:document.querySelectorAll('.ew-cabinet-grid .ew-plate').length,websites:document.querySelectorAll('.ew-cabinet-grid .ew-plate[data-kind="website"]').length,tools:document.querySelectorAll('.ew-cabinet-grid .ew-plate[data-kind="tool"]').length,games:document.querySelectorAll('.ew-cabinet-grid .ew-plate[data-kind="game"]').length},
   hasEditorialSection:Boolean(document.querySelector('#editorial')),
   hasEditorialResource:performance.getEntriesByType('resource').some(entry=>entry.name.includes('editorial-hub')),
   footerLinks:[...document.querySelectorAll('.ew-footer-group a, .ew-footer-links a')].map(link=>link.textContent.trim()),
  }));
  phase='artifact';await page.screenshot({path:screenshotPath,fullPage:false});
  phase='verification';
  const securityResponse=await fetchSecurity(new URL('security.txt',base),{headers:{'cache-control':'no-cache'},signal:AbortSignal.timeout(15000)});
  const securityBody=await securityResponse.text();
  if(errors.length)throw new Error('Console errors detected: '+errors.map(message).join(' | '));
  if(snapshot.counts.length<expectedCounts.length)throw new Error('Count badge mismatch: expected at least '+expectedCounts.length+', received '+snapshot.counts.length);
  expectedCounts.forEach((value,index)=>{if(snapshot.counts[index]!==value)throw new Error('Count mismatch at index '+index+': expected '+value+', received '+snapshot.counts[index]);});
  if(snapshot.cards.total<10)throw new Error('Cabinet card mismatch: expected at least 10 plates, received '+snapshot.cards.total);
  for(const group of ['websites','tools','games'])if(snapshot.cards[group]<1)throw new Error('Cabinet group missing visible plates for '+group);
  if(snapshot.hasEditorialSection||snapshot.hasEditorialResource)throw new Error('Editorial-only content appeared in the public site');
  if(!snapshot.footerLinks.includes('Security'))throw new Error('Security link missing from footer');
  if(!securityResponse.ok||!securityBody.includes('Canonical:'))throw new Error('security.txt is missing or incomplete');
  return {ok:true,status:'healthy',navigationAttempted,httpStatus,expectedCounts,snapshot};
 } catch(error) {
  const browserLost=/browser.*(?:closed|disconnected)|target.*closed/i.test(message(error));
  const status=phase==='setup'?'monitor_setup_failed':phase==='artifact'||browserLost?'monitor_runtime_failed':phase==='navigation'?'site_down':'site_verification_failed';
  return {ok:false,status,label:failureLabels[status],phase,navigationAttempted,httpStatus,error:message(error),expectedCounts,snapshot};
 } finally {
  if(browser)await browser.close().catch(()=>{});
 }
}

async function main(){
 await mkdir('healthchecks',{recursive:true});
 const report={checkedAt:new Date().toISOString(),siteUrl:process.env.SITE_URL||'https://elusionworks.com/',...await checkSiteHealth()};
 await writeFile('healthchecks/result.json',JSON.stringify(report,null,2)+'\n');
 const summary=report.ok?'Live site verified':report.label+': '+report.error;
 if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,'## Elusion Works health check\n\n'+summary+'\n\nStatus: '+report.status+'; navigation attempted: '+report.navigationAttempted+'; HTTP: '+(report.httpStatus??'not received')+'.\n');
 if(!report.ok){console.error('::error title='+report.label+'::'+summary);process.exitCode=1;}
 else console.log(summary,JSON.stringify(report));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{console.error('::error title=Monitor setup failed::monitor setup failed: '+message(error));process.exitCode=1;});
