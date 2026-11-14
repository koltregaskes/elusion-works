"""Scan public source/bundle with Gitleaks; emit aggregate, redacted results only."""
from pathlib import Path
import json,os,shutil,subprocess,sys,uuid
ROOT=Path(__file__).resolve().parent.parent
stage=ROOT/'.local'/('security-scan-'+uuid.uuid4().hex);stage.mkdir(parents=True)
files=subprocess.check_output(['git','ls-files','--cached','--others','--exclude-standard','-z'],cwd=ROOT).decode().split('\0')
count=0;excluded=0
for name in sorted(set(files)):
    if not name:continue
    rel=Path(name)
    if any(part.lower()=='.env' or part.lower().startswith('.env.') for part in rel.parts):excluded+=1;continue
    src=ROOT/rel
    if not src.is_file() or src.is_symlink():continue
    dest=stage/'source'/rel;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(src,dest);count+=1
if not (ROOT/'_site').is_dir():raise SystemExit('Build the public bundle before scanning')
for src in (ROOT/'_site').rglob('*'):
    if not src.is_file():continue
    if any(part.lower()=='.env' or part.lower().startswith('.env.') for part in src.parts):raise SystemExit('Forbidden environment filename in public bundle; contents not opened')
    if src.is_symlink():raise SystemExit('Symlink in public bundle requires review')
    dest=stage/'bundle'/src.relative_to(ROOT/'_site');dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(src,dest);count+=1
report=stage/'redacted-findings.json'
scanner=os.environ.get('EW_GITLEAKS_BIN','gitleaks')
result=subprocess.run([scanner,'dir',str(stage),'--redact=100','--no-banner','--no-color','--log-level','error','--ignore-gitleaks-allow','--exit-code','23','--timeout','120','--report-format','json','--report-path',str(report)],capture_output=True,timeout=150)
if result.returncode not in [0,23]:raise SystemExit(f'Scanner failed with exit {result.returncode}; scanner output withheld to avoid disclosure')
findings=json.loads(report.read_text(encoding='utf-8')) if report.exists() else []
print(f'Gitleaks: {count} source/bundle files; {excluded} environment filenames excluded without opening; {len(findings)} findings. Secret values and raw findings withheld.')
if findings:raise SystemExit('Secret findings require private investigation; no values published')
