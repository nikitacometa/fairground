import re, os, glob

ROOT = '/Users/nikitagorokhov/dev/fairground'
PKGS = ['types','sdk','db','api','keeper','proof-card','price-client']

EXPORT_RE = re.compile(r'^export\s+(?:declare\s+)?(?:async\s+)?(?:type|interface|const|let|function|class|enum)\s+([A-Za-z0-9_]+)', re.M)
EXPORT_LIST_RE = re.compile(r'^export\s*(?:type\s*)?\{([^}]*)\}', re.M)
STAR_FROM_RE = re.compile(r"export\s+\*\s+from\s+'(\./[^']+)'")

def resolve_rel(base_dir, rel):
    rel = rel.replace('.js', '.ts')
    p = os.path.normpath(os.path.join(base_dir, rel))
    if os.path.exists(p): return p
    # try index
    cand = os.path.normpath(os.path.join(base_dir, rel.replace('.ts',''), 'index.ts'))
    return cand if os.path.exists(cand) else None

def collect_exports(entry):
    """Collect exported symbols from entry, following `export * from` one+ levels."""
    syms, seen = set(), set()
    stack = [entry]
    while stack:
        f = stack.pop()
        if f in seen or not os.path.exists(f): continue
        seen.add(f)
        t = open(f).read()
        for m in EXPORT_RE.finditer(t): syms.add(m.group(1))
        for m in EXPORT_LIST_RE.finditer(t):
            for part in m.group(1).split(','):
                part = part.strip().replace('type ','')
                if ' as ' in part: part = part.split(' as ')[-1]
                part = part.strip()
                if part: syms.add(part)
        for m in STAR_FROM_RE.finditer(t):
            nxt = resolve_rel(os.path.dirname(f), m.group(1))
            if nxt: stack.append(nxt)
    return syms

pkg_exports = {}
for p in PKGS:
    entry = f'{ROOT}/packages/{p}/src/index.ts'
    pkg_exports[p] = collect_exports(entry) if os.path.exists(entry) else set()

IMPORT_RE = re.compile(r"import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+'@fairground/([a-z-]+)'")
problems = []
for f in glob.glob(f'{ROOT}/**/*.ts', recursive=True) + glob.glob(f'{ROOT}/**/*.tsx', recursive=True):
    if '/node_modules/' in f or '/dist/' in f or '/.scaffold/' in f: continue
    t = open(f).read()
    for m in IMPORT_RE.finditer(t):
        names = [n.strip().replace('type ','').split(' as ')[0].strip() for n in m.group(1).split(',') if n.strip()]
        pkg = m.group(2)
        if pkg not in pkg_exports:
            problems.append(('PKG?', pkg, os.path.relpath(f,ROOT), names)); continue
        for n in names:
            if n and n not in pkg_exports[pkg]:
                problems.append(('MISS', f'@fairground/{pkg}:{n}', os.path.relpath(f,ROOT), ''))

print("=== EXPORTS PER PACKAGE ===")
for p in PKGS: print(f"  {p}: {sorted(pkg_exports[p])}")
print("\n=== UNRESOLVED @fairground IMPORTS ===")
if not problems: print("  NONE — all @fairground imports resolve")
for kind,sym,f,extra in problems: print(f"  {kind} {sym}  <- {f} {extra}")
