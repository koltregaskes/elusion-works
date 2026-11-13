"""One allowlisted static assembly used by Pages and launch CI. No server needed."""
from pathlib import Path
from html import escape
from html.parser import HTMLParser
from urllib.parse import urljoin
import json, re, shutil, subprocess, sys, uuid
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / '_site'
BASE = 'https://elusionworks.com/'
if OUT.exists():
    archive = ROOT / '.local' / ('build-preimage-' + uuid.uuid4().hex)
    archive.parent.mkdir(exist_ok=True)
    OUT.rename(archive)
OUT.mkdir()
for name in ['index.html','styles.css','showcase-pages.css','app.js','cursor.js','404.html','robots.txt','llms.txt','security.txt','CNAME','cross-site-nav.js','cabinet.js']:
    shutil.copy2(ROOT / name, OUT / name)
for name in ['assets','styles','experiments','creative-radar','remix-relay','design-notes','demos']:
    shutil.copytree(ROOT / name, OUT / name, ignore=shutil.ignore_patterns('tools','__pycache__','*.pyc','.env','.env.*'))
(OUT / 'data').mkdir()
for name in ['estate.js','feed.json']: shutil.copy2(ROOT / 'data' / name, OUT / 'data' / name)
class Head(HTMLParser):
    def __init__(self):
        super().__init__(); self.meta={}; self.title=''; self.in_title=False
    def handle_starttag(self, tag, attrs):
        a=dict(attrs)
        if tag=='meta': self.meta[a.get('name',a.get('property'))]=a.get('content','')
        if tag=='title': self.in_title=True
    def handle_endtag(self,tag):
        if tag=='title': self.in_title=False
    def handle_data(self,data):
        if self.in_title: self.title+=data
urls=[]
for p in sorted(OUT.rglob('*.html')):
    s=p.read_text(encoding='utf-8-sig'); h=Head();h.feed(s)
    rel=p.relative_to(OUT).as_posix();url=BASE+(rel[:-10] if rel.endswith('index.html') else rel)
    if 'noindex' in h.meta.get('robots','').lower(): continue
    urls.append(url)
    description=h.meta.get('description') or f'{h.title.strip()} - an Elusion Works interactive project. Explore the demo and its controls.'
    # Replace each contract tag once, preserving all unrelated head/body content.
    s=re.sub(r'<link\b[^>]*rel=["\']canonical["\'][^>]*>', '',s,flags=re.I)
    s=re.sub(r'<link\b(?=[^>]*type=["\']application/rss\+xml["\'])[^>]*>', '',s,flags=re.I)
    tags=[f'<link rel="canonical" href="{escape(url,quote=True)}" />',f'<link rel="alternate" type="application/rss+xml" title="Elusion Works projects" href="{BASE}feed.xml" />']
    meta={'description':description,'og:title':h.meta.get('og:title') or h.title,'og:description':description,'og:url':url,'og:type':h.meta.get('og:type') or 'website','og:image':BASE+'assets/og-card.png','og:image:type':'image/png','twitter:card':'summary_large_image','twitter:image':BASE+'assets/og-card.png'}
    for key,value in meta.items():
        s=re.sub(r'<meta\b[^>]*(?:name|property)=["\']'+re.escape(key)+r'["\'][^>]*>','',s,flags=re.I)
        tags.append(f'<meta {"property" if key.startswith("og:") else "name"}="{key}" content="{escape(value,quote=True)}" />')
    blocks=re.findall(r'<script\b[^>]*type=["\']application/ld\+json["\'][^>]*>([\s\S]*?)</script>',s,flags=re.I)
    if not blocks:
        schema={'@context':'https://schema.org','@type':'CreativeWork','name':h.title,'description':description,'url':url,'isPartOf':{'@id':BASE+'#website'}}
        tags.append('<script type="application/ld+json">'+json.dumps(schema,ensure_ascii=False).replace('<','\\u003c')+'</script>')
    elif len(blocks)>1:
        graph=[];seen=set()
        for block in blocks:
            obj=json.loads(block)
            for entry in obj.get('@graph',[obj]):
                key=json.dumps(entry,sort_keys=True)
                if key not in seen: graph.append(entry);seen.add(key)
        s=re.sub(r'<script\b[^>]*type=["\']application/ld\+json["\'][^>]*>[\s\S]*?</script>','',s,flags=re.I)
        tags.append('<script type="application/ld+json">'+json.dumps({'@context':'https://schema.org','@graph':graph},ensure_ascii=False).replace('<','\\u003c')+'</script>')
    s=re.sub(r'</head>',lambda m:'\n'+'\n'.join(tags)+'\n</head>',s,count=1,flags=re.I)
    p.write_text(s,encoding='utf-8',newline='\n')
(OUT/'sitemap.xml').write_text('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'+''.join('<url><loc>'+escape(u)+'</loc></url>\n' for u in urls)+'</urlset>\n',encoding='utf-8',newline='\n')
subprocess.run([sys.executable,str(ROOT/'scripts/build-rss.py'),'--output',str(OUT/'feed.xml')],check=True)
subprocess.run([sys.executable,str(ROOT/'scripts/check-launch-seo.py')],check=True)
assert not (OUT/'scripts').exists()
print(f'Built {len(urls)} indexable routes from one Pages/CI assembly')
