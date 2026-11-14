export function elementOverflow(){
 const out=[];
 for(const el of document.querySelectorAll('body *')){
  if(!(el instanceof HTMLElement))continue;
  // World-space globe labels intentionally cross the canvas edge; no controls are exempt.
  const textLabel=el.closest('.lab3');
  const interactive='a,button,input,select,textarea,[tabindex],[contenteditable],[role]';
  if(location.pathname.includes('/orbit-census/')&&textLabel&&el.matches('.lab3,b,span')&&!el.matches(interactive)&&!el.querySelector(interactive)&&[...el.querySelectorAll('*')].every(n=>n.matches('b,span')))continue;
  if(el.id==='ringCursor'||(location.pathname.includes('/chronicles-of-bone/')&&el.matches('.noise,.tick')))continue;
  const r=el.getBoundingClientRect(),s=getComputedStyle(el);
  if(!r.width||!r.height||s.visibility==='hidden'||s.opacity==='0')continue;
  let transparent=false;for(let p=el.parentElement;p;p=p.parentElement){if(getComputedStyle(p).opacity==='0'){transparent=true;break;}}
  if(transparent)continue;
  if(r.right<=innerWidth+1&&r.left>=-1)continue;
  let contained=false;
  for(let p=el.parentElement;p&&p!==document.body&&p!==document.documentElement;p=p.parentElement){
   const b=p.getBoundingClientRect();
   if(b.left>=-1&&b.right<=innerWidth+1&&['hidden','clip','auto','scroll'].includes(getComputedStyle(p).overflowX)){contained=true;break;}
  }
  if(!contained)out.push({tag:el.tagName,id:el.id,class:el.className,left:Math.round(r.left),right:Math.round(r.right)});
 }
 return out;
}
