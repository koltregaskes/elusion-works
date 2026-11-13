from pathlib import Path
import unittest,re,subprocess,sys,hashlib,base64
ROOT=Path(__file__).resolve().parent.parent
class DemoCSP(unittest.TestCase):
 def test_every_built_demo_has_policy(self):
  missing=[str(p.relative_to(ROOT/'_site')) for p in (ROOT/'_site/demos').rglob('*.html') if 'Content-Security-Policy' not in p.read_text()]
  self.assertEqual(missing,[],'Demo routes without CSP')
 def test_no_browser_babel_or_eval_allowance_added(self):
  for name in ['atmosphere','chronicles-of-bone','solar-system-field-lab']:
   text=(ROOT/'_site/demos'/name/'index.html').read_text()
   self.assertNotIn('text/babel',text);self.assertNotIn('@babel/standalone',text)
   self.assertNotIn("'unsafe-eval'",text);self.assertNotIn("script-src 'self' 'unsafe-inline'",text)
 def test_generated_inline_hashes_match_final_bytes(self):
  checked=0
  for p in (ROOT/'_site/demos').rglob('*.html'):
   text=p.read_text();policy=re.search(r'http-equiv="Content-Security-Policy" content="([^"]+)"',text)
   if not policy or "form-action 'none'" not in policy[1]:continue
   for attrs,code in re.findall(r'<script\b([^>]*)>([\s\S]*?)</script>',text,re.I):
    if re.search(r'\bsrc=',attrs) or not code.strip():continue
    digest=base64.b64encode(hashlib.sha256(code.encode()).digest()).decode()
    self.assertIn("'sha256-"+digest+"'",policy[1],str(p));checked+=1
  self.assertGreater(checked,0)
if __name__=='__main__':unittest.main()
