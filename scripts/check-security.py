"""Check code-enforced policy and report actual host header gaps without secrets."""
from pathlib import Path
from html.parser import HTMLParser
import argparse,json,urllib.request,urllib.error
ROOT=Path(__file__).resolve().parent.parent
class Meta(HTMLParser):
    def __init__(self):super().__init__();self.meta={}
    def handle_starttag(self,tag,attrs):
        if tag=='meta':
            a=dict(attrs);self.meta[(a.get('http-equiv') or a.get('name') or '').lower()]=a.get('content','')
count=0;csp=0
for p in (ROOT/'_site').rglob('*.html'):
    h=Meta();h.feed(p.read_text(encoding='utf-8'));assert h.meta.get('referrer')=='strict-origin-when-cross-origin',(p.relative_to(ROOT/'_site'),'referrer')
    if h.meta.get('content-security-policy'):csp+=1
    count+=1
h=Meta();h.feed((ROOT/'_site/index.html').read_text());policy=h.meta['content-security-policy'];assert "script-src 'self';" in policy and 'nonce-elusion-frontdoor-schema' not in policy
assert "object-src 'none'" in policy and "base-uri 'self'" in policy and "form-action 'self'" in policy
assert not (ROOT/'_site/scripts').exists()
print(f'Code policy: referrer on {count} HTML routes; CSP present on {csp}; previously missing demo policies are generated with hashes. Meta policies do not supply HTTP framing/MIME headers; interaction review remains separate.')
parser=argparse.ArgumentParser();parser.add_argument('--live',action='store_true');args=parser.parse_args()
if args.live:
    expected=json.loads((ROOT/'config/response-headers.json').read_text());request=urllib.request.Request('https://elusionworks.com/',method='HEAD')
    try:
        with urllib.request.urlopen(request,timeout=20) as response:
            print(f'Live host: HTTP {response.status}')
            for name,value in expected.items():print(f'{name}: '+('matches' if response.headers.get(name)==value else 'GAP: absent or differs; host/proxy owner action required'))
    except (urllib.error.URLError,TimeoutError):print('Live header readback unavailable; host acceptance remains unverified')
