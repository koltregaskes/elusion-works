"""Verify configured contact links in the actual public bundle."""
from pathlib import Path
from html.parser import HTMLParser
import json
ROOT=Path(__file__).resolve().parent.parent;OUT=ROOT/'_site'
url=json.loads((ROOT/'site.config.json').read_text())['contactUrl']
class Links(HTMLParser):
    def __init__(self):super().__init__();self.hrefs=[]
    def handle_starttag(self,tag,attrs):
        if tag=='a':self.hrefs.append(dict(attrs).get('href',''))
primary=['index.html','404.html','demos/index.html','creative-radar/index.html','remix-relay/index.html','design-notes/index.html']+[p.relative_to(OUT).as_posix() for p in (OUT/'experiments').rglob('index.html')]
for name in primary:
    s=(OUT/name).read_text(encoding='utf-8');assert '{{CONTACT_URL}}' not in s,name
    h=Links();h.feed(s);assert url in h.hrefs,(name,'configured contact link missing')
for name in ['security.txt','.well-known/security.txt']:
    lines=(OUT/name).read_text().splitlines();assert f'Contact: {url}' in lines,name
assert (OUT/'security.txt').read_bytes()==(OUT/'.well-known/security.txt').read_bytes()
assert not (OUT/'site.config.json').exists(),'Source configuration must not be published separately'
print(f'Contact configuration passed: {len(primary)} site pages and both security.txt paths use one destination')
