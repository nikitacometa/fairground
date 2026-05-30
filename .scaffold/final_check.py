import json, os, re
ROOT = '/Users/nikitagorokhov/dev/fairground'

out = []
# game walletconnect deps
g = json.load(open(f'{ROOT}/apps/game/package.json'))
gd = {**g.get('dependencies', {}), **g.get('devDependencies', {})}
wc = [k for k in gd if 'walletconnect' in k.lower()]
out.append(f"game walletconnect deps: {[(k, gd[k]) for k in wc]}")

# api deps: ws present?
a = json.load(open(f'{ROOT}/packages/api/package.json'))
ad = {**a.get('dependencies', {}), **a.get('devDependencies', {})}
out.append(f"api has ws: {'ws' in ad}  @types/ws: {'@types/ws' in ad}")

# infra files
for f in ['.nvmrc', '.prettierrc', 'packages/api/Dockerfile', 'packages/keeper/Dockerfile']:
    out.append(f"{f}: {'EXISTS' if os.path.exists(f'{ROOT}/{f}') else 'MISSING'}")

# docker-compose build/dockerfile references
dc = open(f'{ROOT}/docker-compose.yml').read()
out.append("compose dockerfile refs: " + str(re.findall(r'dockerfile:\s*\S+', dc, re.I)))
out.append("compose build refs: " + str(re.findall(r'build:.*', dc)))

# leaderboard.ts unused 'and'
lb = open(f'{ROOT}/packages/api/src/routes/leaderboard.ts').read()
out.append("leaderboard imports 'and': " + str(bool(re.search(r"import\s*\{[^}]*\band\b", lb))))
body = '\n'.join(l for l in lb.split('\n') if not l.strip().startswith('import'))
out.append("leaderboard uses and(): " + str('and(' in body))

open('/tmp/fgfinal.txt', 'w').write('\n'.join(out))
print('\n'.join(out))
