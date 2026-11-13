"""Validate shipped SEO contracts without network access or dependencies."""
from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import urlparse, unquote
import argparse
import json
import struct
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent.parent
BASE = 'https://elusionworks.com/'
FEED = 'feed.xml'
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--site-root', type=Path, default=ROOT)
parser.add_argument('--feed', type=Path)
args = parser.parse_args()
ROOT = args.site_root.resolve()
class Head(HTMLParser):
    def __init__(self):
        super().__init__(); self.links = {}; self.meta = {}; self.schemas = []; self.schema = None
    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == 'link': self.links[a.get('rel')] = a.get('href')
        if tag == 'meta': self.meta[a.get('property', a.get('name'))] = a.get('content')
        if tag == 'script' and a.get('type') == 'application/ld+json': self.schema = ''
    def handle_data(self, data):
        if self.schema is not None: self.schema += data
    def handle_endtag(self, tag):
        if tag == 'script' and self.schema is not None:
            self.schemas.append(json.loads(self.schema)); self.schema = None

def local(url):
    assert url.startswith(BASE), url
    path = ROOT / unquote(url[len(BASE):])
    return path / 'index.html' if path.is_dir() else path

urls = [n.text for n in ET.parse(ROOT / 'sitemap.xml').findall('.//{*}loc')]
assert len(urls) == len(set(urls))
for url in urls:
    assert local(url).is_file(), url
for rel in ['index.html']:
    url = BASE + ('' if rel == 'index.html' else rel)
    h = Head(); h.feed((ROOT / rel).read_text(encoding='utf-8'))
    assert h.links.get('canonical') == url, (rel, 'canonical')
    assert h.meta.get('description'), (rel, 'description')
    assert h.meta.get('og:url') == url, (rel, 'og:url')
    image = local(h.meta['og:image']); data = image.read_bytes()
    assert data[:8] == b'\x89PNG\r\n\x1a\n', image
    width, height = struct.unpack('>II', data[16:24]); assert width >= 600 and height >= 315
    assert h.schemas, (rel, 'JSON-LD')
    assert h.links.get('alternate') == BASE + FEED or h.links.get('alternate') == FEED
    assert url in urls
assert BASE + 'sitemap.xml' in (ROOT / 'robots.txt').read_text()
assert BASE in (ROOT / 'llms.txt').read_text()
feed = ET.parse(args.feed or ROOT / FEED)
assert feed.getroot().tag == 'rss'
assert feed.find('channel/link').text == BASE
assert feed.find('channel/{http://www.w3.org/2005/Atom}link').get('href') == BASE + FEED
assert feed.find('channel/item') is not None
print(f'SEO contract passed: {len(urls)} sitemap entries, core metadata, PNG and RSS')
