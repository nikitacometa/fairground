import json, os, re, subprocess
ROOT = '/Users/nikitagorokhov/dev/fairground'
out = []

# 1. all package.json valid JSON + no duplicate keys
def check_json(p):
    raw = open(p).read()
    try:
        json.loads(raw)
    except Exception as e:
        return f"INVALID JSON: {e}"
    # duplicate top-level key crude check
    keys = re.findall(r'^\s{2}"(\w+)":', raw, re.M)
    dupes = {k for k in keys if keys.count(k) > 1}
    return f"dup-keys: {dupes}" if dupes else "ok"

for p in [f'{ROOT}/package.json'] + \
         [f'{ROOT}/packages/{d}/package.json' for d in os.listdir(f'{ROOT}/packages') if os.path.isdir(f'{ROOT}/packages/{d}')] + \
         [f'{ROOT}/apps/{d}/package.json' for d in ['game','landing']]:
    if os.path.exists(p):
        out.append(f"{os.path.relpath(p,ROOT)}: {check_json(p)}")

# 2. forbidden algopy symbols (non-comment)
out.append("--- contracts ---")
for c in ['house_treasury','coinflip','leaderboard']:
    f = f'{ROOT}/packages/contracts/smart_contracts/{c}/contract.py'
    t = open(f).read()
    bad = []
    for pat in [r'arc4\.Int64', r'op\.AppParam\.address', r'algopy\.Literal', r'Box\.get\(b"V"', r'bet_amount = UInt64\(0\)']:
        for ln in t.split('\n'):
            s = ln.strip()
            if s.startswith('#') or s.startswith('*') or 'does not exist' in s or s.startswith('"""'):
                continue
            if re.search(pat, ln):
                bad.append(pat)
                break
    out.append(f"  {c}: {'CLEAN' if not bad else 'BAD: '+str(bad)}")

# 3. infra files
out.append("--- infra ---")
for f in ['.nvmrc','.prettierrc','.editorconfig','eslint.config.mjs','docker-compose.yml',
          'packages/api/Dockerfile','packages/keeper/Dockerfile','.eslintrc.cjs']:
    exists = os.path.exists(f'{ROOT}/{f}')
    flag = 'EXISTS' if exists else 'MISSING'
    if f == '.eslintrc.cjs': flag += ' (should be MISSING)'
    out.append(f"  {f}: {flag}")

# 4. dead files gone
out.append("--- dead files (should be MISSING) ---")
for f in ['packages/api/src/ws.ts','packages/api/src/routes/games.ts','packages/proof-card/src/render.ts',
          'apps/game/next.config.ts','apps/game/src']:
    out.append(f"  {f}: {'STILL EXISTS' if os.path.exists(f'{ROOT}/{f}') else 'gone'}")

open('/tmp/fgverify.txt','w').write('\n'.join(out))
print('written')
