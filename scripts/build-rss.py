"""Build selected showcase RSS items using their original editorial timestamps."""
from pathlib import Path
from datetime import datetime
from email.utils import format_datetime
import html
import json
import argparse
ROOT = Path(__file__).resolve().parent.parent
items = []
for row in json.loads((ROOT / 'data/feed.json').read_text(encoding='utf-8'))['ticker']:
    url = row['href']
    if url.startswith('/'): url = 'https://elusionworks.com' + url
    items.append('<item><title>' + html.escape(row['text']) + '</title><link>' + html.escape(url) + '</link><guid isPermaLink="false">' + html.escape(url + '#' + row['timestamp']) + '</guid><pubDate>' + format_datetime(datetime.fromisoformat(row['timestamp'].replace('Z', '+00:00'))) + '</pubDate></item>')
feed = '''<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>Elusion Works updates</title><link>https://elusionworks.com/</link><description>Selected project updates from the Elusion Works showcase. Dates are editorial dates, not deployment times.</description><language>en-gb</language><atom:link href="https://elusionworks.com/feed.xml" rel="self" type="application/rss+xml"/>
''' + '\n'.join(items) + '</channel></rss>\n'
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', type=Path, default=ROOT / '_site/feed.xml')
args = parser.parse_args()
target = args.output if args.output.is_absolute() else ROOT / args.output
target.parent.mkdir(parents=True, exist_ok=True)
target.write_text(feed, encoding='utf-8', newline='\n')
print(f'RSS generated from {len(items)} editorial updates')
