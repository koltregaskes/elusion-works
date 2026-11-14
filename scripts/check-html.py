"""Reject mangled question-mark separators in published HTML text and labels."""
from pathlib import Path
from html.parser import HTMLParser
import re

ROOT = Path(__file__).resolve().parent.parent / '_site'
SEPARATOR = re.compile(r'\w \? \w')

class Text(HTMLParser):
    def __init__(self):
        super().__init__(); self.hidden = []; self.text = []; self.labels = []
    def handle_starttag(self, tag, attrs):
        for name, value in attrs:
            if name == 'aria-label': self.labels.append(value or '')
        if tag in ['head', 'script', 'style']: self.hidden.append(tag)
    def handle_endtag(self, tag):
        if self.hidden and self.hidden[-1] == tag: self.hidden.pop()
    def handle_data(self, data):
        if not self.hidden: self.text.append(data)

pages = sorted(ROOT.rglob('*.html'))
assert pages, 'Build the public bundle before checking HTML'
for page in pages:
    h = Text(); h.feed(page.read_text(encoding='utf-8'))
    for text in h.labels + [''.join(h.text)]:
        assert not SEPARATOR.search(text), (page.relative_to(ROOT).as_posix(), 'Mangled " ? " separator in text or aria-label')
print(f'HTML text passed: {len(pages)} pages have no mangled question-mark separators')
