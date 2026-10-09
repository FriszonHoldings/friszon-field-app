set -e
cd /home/claude/friszon-field-app
for f in app.js screens2.js sync.js styles.css index.html sw.js manifest.webmanifest icon-192.png icon-512.png; do git show phase2:$f > preview/$f; done
python3 - <<'PY'
import re,os
os.chdir('preview')
s=open('sync.js').read(); s=s.replace("const FF_DB = 'friszon-field';","const FF_DB = 'friszon-field-preview';"); open('sync.js','w').write(s)
s=open('sw.js').read(); s=re.sub(r"const CACHE = '[^']+';","const CACHE = 'ff-preview-2';",s); s=s.replace("keys.filter(k => k !== CACHE)","keys.filter(k => k !== CACHE && k.indexOf('ff-preview-') === 0)"); open('sw.js','w').write(s)
m=open('manifest.webmanifest').read(); m=m.replace('"name": "Friszon Field"','"name": "Friszon Field PREVIEW"').replace('"short_name": "Friszon"','"short_name": "FF Preview"'); open('manifest.webmanifest','w').write(m)
h=open('index.html').read(); h=h.replace('<title>Friszon Field</title>','<title>Friszon Field PREVIEW</title>').replace('content="#2f5d34"','content="#8a5a00"'); open('index.html','w').write(h)
a=open('app.js').read()
a=re.sub(r"const APP_VERSION = '([^']+)';", lambda m: "const APP_VERSION = '"+m.group(1)+"-preview';", a, count=1)
a=a.replace("""  if (res && res.ok) {
    pullTry = 0;""","""  if (res && res.ok && !res.test) {
    S.session = null; S.data = null; await ffSet('session', null); await ffSet('data', null);
    renderLogin(); document.getElementById('lerr').innerHTML = '<div class="err">This preview is only for test logins. Use the normal Friszon Field app.</div>';
    return;
  }
  if (res && res.ok) {
    pullTry = 0;""",1)
a=a.replace("<h1>Friszon Field</h1><p class=\"small\">Sign in once on this phone.</p>","<h1>Friszon Field · PREVIEW</h1><p class=\"small\">Test logins only. Saves go to the TEST tabs.</p>")
assert 'only for test logins' in a and 'PREVIEW' in a
open('app.js','w').write(a)
PY
