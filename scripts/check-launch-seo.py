"""Check every published indexable HTML route, not a homepage sample."""
from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import urlparse, unquote
import json,struct,xml.etree.ElementTree as ET
ROOT=Path(__file__).resolve().parent.parent/'_site';BASE='https://elusionworks.com/'
class Head(HTMLParser):
    def __init__(self):
        super().__init__();self.meta={};self.links=[];self.schemas=[];self.schema=None
    def handle_starttag(self,tag,attrs):
        a=dict(attrs)
        if tag=='meta':self.meta[a.get('property',a.get('name'))]=a.get('content','')
        if tag=='link':self.links.append(a)
        if tag=='script' and a.get('type')=='application/ld+json':self.schema=''
    def handle_data(self,data):
        if self.schema is not None:self.schema+=data
    def handle_endtag(self,tag):
        if tag=='script' and self.schema is not None:self.schemas.append(json.loads(self.schema));self.schema=None
urls=[n.text for n in ET.parse(ROOT/'sitemap.xml').findall('.//{*}loc')];assert len(urls)==len(set(urls))
seen=[]
for p in sorted(ROOT.rglob('*.html')):
    h=Head();h.feed(p.read_text(encoding='utf-8'));rel=p.relative_to(ROOT).as_posix()
    if 'noindex' in h.meta.get('robots','').lower():continue
    url=BASE+(rel[:-10] if rel.endswith('index.html') else rel);seen.append(url)
    assert url in urls,(rel,'sitemap omission')
    assert [a['href'] for a in h.links if a.get('rel')=='canonical']==[url],(rel,'canonical')
    assert h.meta.get('description') and h.meta.get('og:url')==url,(rel,'metadata')
    assert len(h.schemas)==1,(rel,'exactly one JSON-LD block')
    image=h.meta.get('og:image','');assert image.startswith(BASE),(rel,'local OG')
    raw=(ROOT/unquote(image[len(BASE):])).read_bytes();assert raw[:8]==b'\x89PNG\r\n\x1a\n',(rel,'real PNG')
    w,ht=struct.unpack('>II',raw[16:24]);assert w>=600 and ht>=315,(rel,'OG dimensions')
    assert any(a.get('rel')=='alternate' and a.get('type')=='application/rss+xml' and a.get('href')==BASE+'feed.xml' for a in h.links),(rel,'RSS discovery')
assert set(urls)==set(seen),'Sitemap includes missing or noindex routes'
assert BASE+'sitemap.xml' in (ROOT/'robots.txt').read_text()
assert BASE in (ROOT/'llms.txt').read_text()
feed=ET.parse(ROOT/'feed.xml');assert feed.getroot().tag=='rss';assert feed.find('channel/link').text==BASE
assert feed.find('channel/{http://www.w3.org/2005/Atom}link').get('href')==BASE+'feed.xml'
for item in feed.findall('channel/item'):
    link=item.findtext('link');assert link.startswith('https://') and not urlparse(link).path.endswith('.md'),('RSS HTML link',link)
    if link.startswith(BASE):
        path=ROOT/unquote(urlparse(link).path.lstrip('/'));assert path.exists(),('RSS destination',link)
print(f'SEO contract passed on all {len(seen)} indexable routes: sitemap, RSS, canonical, real PNG, JSON-LD, robots and llms')
