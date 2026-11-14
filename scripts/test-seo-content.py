from pathlib import Path
import re,subprocess,sys,unittest
ROOT=Path(__file__).resolve().parent.parent
class SEOContent(unittest.TestCase):
 def test_unrelated_schema_is_rejected(self):
  p=ROOT/'_site/index.html';before=p.read_bytes()
  try:
   p.write_text(re.sub(r'(<script\b[^>]*type="application/ld\+json"[^>]*>)[\s\S]*?(</script>)',lambda m:m[1]+'{"@context":"https://schema.org","@type":"Thing","url":"https://example.org/wrong"}'+m[2],before.decode()),encoding='utf-8')
   r=subprocess.run([sys.executable,'scripts/check-launch-seo.py'],cwd=ROOT,capture_output=True)
   self.assertNotEqual(r.returncode,0,'unrelated JSON-LD passed built SEO')
  finally:p.write_bytes(before)
 def test_rss_source_date_drift_is_rejected(self):
  p=ROOT/'_site/feed.xml';before=p.read_bytes()
  try:
   p.write_text(re.sub(r'<pubDate>[^<]+</pubDate>','<pubDate>Fri, 13 Nov 2026 12:00:00 +0000</pubDate>',before.decode(),count=1),encoding='utf-8')
   r=subprocess.run([sys.executable,'scripts/check-launch-seo.py'],cwd=ROOT,capture_output=True)
   self.assertNotEqual(r.returncode,0,'fabricated RSS freshness passed built SEO')
  finally:p.write_bytes(before)
if __name__=='__main__':unittest.main()
