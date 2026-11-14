import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import path from 'node:path';
const root=path.resolve('_site');
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'msedge'});
try {
 const page=await browser.newPage();
 await page.route('**/*',async route=>{
  const u=new URL(route.request().url());
  if(u.hostname!=='ew.test')return route.abort();
  const file=path.resolve(root,'.'+(u.pathname==='/'?'/index.html':u.pathname));
  if(!file.startsWith(root+path.sep))return route.abort();
  try {await route.fulfill({path:file});}catch{await route.fulfill({status:404,body:''});}
 });
 await page.goto('https://ew.test/',{waitUntil:'load',timeout:20000});
 await page.waitForFunction(()=>document.querySelector('[data-ticker]')?.dataset.editorialAge);
 const text=await page.locator('.ew-ticker-kicker').allTextContents();
 assert(text.length>0);
 for(const value of text){assert(!value.includes('?'),value);assert(value.includes('\u00b7'),value);}
 console.log('Rendered editorial ticker uses a middle dot, with no question-mark separator.');
} finally {await browser.close();}
