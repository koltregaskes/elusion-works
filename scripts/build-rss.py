"""Build selected showcase RSS items using their original editorial timestamps."""
from pathlib import Path
from datetime import datetime
from email.utils import format_datetime
import html
import json
import sys
ROOT = Path(__file__).resolve().parent.parent
items = []
for row in json.loads((ROOT / 'data/feed.json').read_text(encoding='utf-8'))['ticker']:
    url = row['href']
    if url.startswith('/'): url = 'https://elusionworks.com' + url
    items.append('<item><title>' + html.escape(row['text']) + '</title><link>' + html.escape(url) + '</link><guid isPermaLink="false">' + html.escape(url + '#' + row['timestamp']) + '</guid><pubDate>' + format_datetime(datetime.fromisoformat(row['timestamp'].replace('Z', '+00:00'))) + '</pubDate></item>')
feed = '''<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>Elusion Works updates</title><link>https://elusionworks.com/</link><description>Selected project updates from the Elusion Works showcase. Dates are editorial dates, not deployment times.</description><language>en-gb</language><atom:link href="https://elusionworks.com/scripts/feed.xml" rel="self" type="application/rss+xml"/>
''' + '\n'.join(items) + '</channel></rss>\n'
target = ROOT / 'scripts/feed.xml'
if '--write' in sys.argv:
    target.write_text(feed, encoding='utf-8')
else:
    assert target.read_text(encoding='utf-8') == feed, 'Run python scripts/build-rss.py --write after changing data/feed.json'
    print('RSS matches the editorial source')
