# Construit index.html (le lecteur, un seul fichier autonome) à partir de :
#   src/template.html + src/extract.js + src/mail.js
#   listes.json si présent (tes vraies listes, jamais versionnées), sinon listes.exemple.json
#   vendor/ : pdf.js (lecture des PDF) et cfb (mails Outlook .msg)
# Usage : python assemble.py            (Python 3, rien d'autre à installer)
import base64, gzip, json, os, datetime
os.chdir(os.path.dirname(os.path.abspath(__file__)))
lire = lambda p: open(p, encoding='utf-8').read()
t = lire('src/template.html')
code = {n: lire(f'src/{n}').replace('export function', 'function') for n in ('extract.js', 'mail.js')}
for n, c in code.items():
    assert '</script' not in c, n + ' ne doit pas contenir </script'
listes = 'listes.json' if os.path.exists('listes.json') else 'listes.exemple.json'
data = json.load(open(listes, encoding='utf-8'))
data['__maj'] = datetime.date.today().strftime('%d/%m/%Y')
# bibliothèques compressées en gzip puis encodées en base64 (le navigateur les décompresse à l'ouverture)
b = lambda p: base64.b64encode(gzip.compress(open(p, 'rb').read(), 9, mtime=0)).decode()
t = t.replace('__DATA_JSON__', json.dumps(data, ensure_ascii=False).replace('<', '\\u003c'))
t = t.replace('__EXTRACT_JS__', code['extract.js']).replace('__MAIL_JS__', code['mail.js'])
t = t.replace('__CFB_JS__', lire('vendor/cfb.min.js'))
t = t.replace('__PDFJS_B64__', b('vendor/pdf.min.mjs')).replace('__WORKER_B64__', b('vendor/pdf.worker.min.mjs'))
open('index.html', 'w', encoding='utf-8').write(t)
print(f'{len(t) // 1024} Ko -> index.html (listes : {listes})')
