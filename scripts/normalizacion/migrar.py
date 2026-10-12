"""Migrador de la normalización (PLAN_NORMALIZACION_UI §4).
Convierte en los archivos dados:
  1. <div[ class]> <label htmlFor=ID ...>TXT</label> <input …campo…/> [<p>(opcional)</p>] </div>
     → <Input label="TXT" id=ID … [wrapperClassName] [optional] />
  2. <input …className="CAMPO extra"…/> (texto) → <Input … className="extra" />
  3. Botón primario de ancho completo con spinner → <Button type fullWidth busy>
Uso: python3 migrar.py archivo.jsx [...]  (imprime un resumen; escribe en sitio)
"""
import re, sys

CAMPO = ['w-full','px-4','py-2.5','rounded-full','rounded','border','border-outline-variant','focus:outline-none',
         'focus-visible:ring-2','focus-visible:ring-accent','text-sm','bg-surface','focus:border-transparent']
NO_TEXTO = re.compile(r'type="(checkbox|radio|file|color|range|hidden)"')

def resto_clases(cls):
    toks = cls.split()
    if not ('border-outline-variant' in toks and ('px-4' in toks or 'px-3' in toks)):
        return None
    extra = [t for t in toks if t not in CAMPO and t not in ('px-3','py-2')]
    return ' '.join(extra)

def conv_input_tag(tag):
    """tag = texto completo '<input ... />' → '<Input ... />' o None."""
    if NO_TEXTO.search(tag):
        return None
    m = re.search(r'(\n[ \t]*|\s)className="([^"]*)"', tag)
    if not m:
        return None
    extra = resto_clases(m.group(2))
    if extra is None:
        return None
    nuevo = tag[:m.start()] + (f'{m.group(1)}className="{extra}"' if extra else '') + tag[m.end():]
    return nuevo.replace('<input', '<Input', 1)

def sangria(tag):
    m = re.search(r'\n([ \t]+)\S', tag)
    return m.group(1) if m else ' '

def migrar(s):
    n = {'campos_con_etiqueta': 0, 'campos': 0, 'botones': 0}
    # 1) campo con etiqueta en un div
    pat = re.compile(r'<div(?: className="([^"]*)")?>\s*<label htmlFor="([\w-]+)" className="block text-(?:sm|xs) font-medium text-muted mb-1">([^<]+)</label>\s*(<input\b(?:(?!/>).)*?/>)\s*(<p className="text-xs text-hint mt-1">\(opcional\)</p>\s*)?</div>', re.S)
    def r1(m):
        nuevo = conv_input_tag(m.group(4))
        if not nuevo:
            return m.group(0)
        n['campos_con_etiqueta'] += 1
        sg = '\n' + sangria(nuevo)
        extra = f'{sg}label="{m.group(3).strip()}"'
        if m.group(1): extra += f'{sg}wrapperClassName="{m.group(1)}"'
        if m.group(5): extra += f'{sg}optional'
        nuevo = nuevo.replace('<Input', '<Input' + extra, 1)
        # El <input> estaba anidado dentro del <div>: se le quita ese nivel.
        div_ind = len(s_previo_txt(s_ref1[0], m.start()))
        inp_ind = len(re.search(r'\n([ \t]*)<input', m.group(0)).group(1))
        quitar = max(0, inp_ind - div_ind)
        if quitar:
            nuevo = re.sub(r'\n' + ' ' * quitar, '\n', nuevo)
        return nuevo
    s_ref1[0] = s
    s = pat.sub(r1, s)
    # 1b) PasswordInput con etiqueta en un div → label=, sin clases de campo
    patp = re.compile(r'<div(?: className="([^"]*)")?>\s*<label htmlFor="([\w-]+)" className="block text-(?:sm|xs) font-medium text-muted mb-1">([^<]+)</label>\s*(<PasswordInput\b(?:(?!/>).)*?/>)\s*</div>', re.S)
    def rp(m):
        tag = m.group(4)
        tag = re.sub(r'\n[ \t]*className="[^"]*border-outline-variant[^"]*"', '', tag)
        sg = '\n' + sangria(tag)
        extra = f'{sg}label="{m.group(3).strip()}"'
        if m.group(1): extra += f'{sg}wrapperClassName="{m.group(1)}"'
        tag = tag.replace('<PasswordInput', '<PasswordInput' + extra, 1)
        div_ind = len(s_previo_txt(s_ref1[0], m.start()))
        inp_ind = len(re.search(r'\n([ \t]*)<PasswordInput', m.group(0)).group(1))
        quitar = max(0, inp_ind - div_ind)
        if quitar:
            tag = re.sub(r'\n' + ' ' * quitar, '\n', tag)
        n['campos_con_etiqueta'] += 1
        return tag
    s_ref1[0] = s
    s = patp.sub(rp, s)
    # PasswordInput sueltos: quitar la clase de campo copiada
    s = re.sub(r'(<PasswordInput\b(?:(?!/>).)*?)\n[ \t]*className="w-full px-4 py-2\.5 rounded-full border border-outline-variant[^"]*"', r'\1', s, flags=re.S)
    # 2) inputs sueltos
    def r2(m):
        nuevo = conv_input_tag(m.group(0))
        if nuevo: n['campos'] += 1
        return nuevo or m.group(0)
    s = re.sub(r'<input\b(?:(?!/>).)*?/>', r2, s, flags=re.S)
    # 3) botón primario con spinner
    BTN = r'w-full py-2\.5 bg-accent hover:bg-accent-hover text-white (?:text-sm )?font-semibold rounded-full transition(?:-colors)? disabled:opacity-60 flex items-center justify-center gap-2'
    pat3 = re.compile(r'<button\s+type="(submit|button)"\s+(?:onClick=\{([^}]*\}?)\}\s+)?disabled=\{([^}]*)\}\s+className="' + BTN + r'"\s*>\s*\{(\w+) \? <Spinner size="sm" /> : null\}\s*(\{[^}]*\}|[^<{]+)\s*</button>', re.S)
    def r3(m):
        n['botones'] += 1
        tipo, onclick, dis, busy, texto = m.groups()
        oc = f' onClick={{{onclick}}}' if onclick else ''
        disabled = '' if dis.strip() == busy else f' disabled={{{dis}}}'
        ind = re.search(r'([ \t]*)$', s_previo(m)).group(1)
        return f'<Button type="{tipo}" size="lg" fullWidth busy={{{busy}}}{disabled}{oc}>\n{ind}  {texto.strip()}\n{ind}</Button>'
    s_ref[0] = s
    s = pat3.sub(r3, s)
    return s, n

s_ref = ['']
s_ref1 = ['']
def s_previo_txt(t, pos):
    ini = t.rfind('\n', 0, pos) + 1
    return t[ini:pos]
def s_previo(m):
    t = s_ref[0]
    ini = t.rfind('\n', 0, m.start()) + 1
    return t[ini:m.start()]

def asegurar_import(s, nombres):
    usados = [x for x in nombres if re.search(r'<' + x + r'\b', s)]
    if not usados: return s
    # Los imports por defecto (ui/Button, ui/Input) se cambian por el barril.
    for u in usados:
        s = re.sub(r"import " + u + r" from '((?:\.\./)+components/ui)/" + u + r"'\n", '', s)
    m = re.search(r"import \{([^}]*)\} from '((?:\.\./)+components/ui)'", s)
    if m:
        actuales = [x.strip() for x in m.group(1).split(',') if x.strip()]
        faltan = [u for u in usados if u not in actuales]
        if faltan:
            s = s[:m.start(1)] + ' ' + ', '.join(actuales + faltan) + ' ' + s[m.end(1):]
        return s
    # quitar imports default sueltos de ui/Button, ui/Input
    for u in usados:
        s = re.sub(r"import " + u + r" from '((?:\.\./)+components/ui)/" + u + r"'\n", '', s)
    prof = re.search(r"from '((?:\.\./)+)components/", s)
    base = prof.group(1) if prof else '../../'
    lineas = s.split('\n')
    ult = max(i for i, l in enumerate(lineas) if l.startswith('import '))
    lineas.insert(ult + 1, f"import {{ {', '.join(usados)} }} from '{base}components/ui'")
    return '\n'.join(lineas)

if __name__ == '__main__':
    for f in sys.argv[1:]:
        s = open(f).read()
        s2, n = migrar(s)
        s2 = asegurar_import(s2, ['Input', 'Button'])
        if s2 != s:
            open(f, 'w').write(s2)
        print(f, n)

# ── Pasada 2: botones de texto simples y cabeceras de resultado ─────────────
VARIANTE_POR_CLASES = [
    (re.compile(r'^(w-full )?px-[45] py-2\.5 bg-accent (hover:bg-accent-hover )?text-white (text-sm )?font-semibold rounded-full (hover:bg-accent-hover )?transition(-colors)?( disabled:opacity-60)?$'), 'primary'),
    (re.compile(r'^(w-full )?px-[45] py-2\.5 border border-outline-variant (text-muted|text-on-surface) (text-sm )?font-semibold rounded-full transition(-colors)? hover:bg-(surface-container|surface)$'), 'secondary'),
]

def pasada2(s, tamano='lg'):
    n = {'botones2': 0, 'cabeceras': 0}
    pat = re.compile(r'<button\s+type="button"\s+onClick=\{((?:[^{}]|\{[^{}]*\})*)\}(\s+disabled=\{[^}]*\})?\s+className="([^"]+)"\s*>\s*([^<>{}]+?)\s*</button>', re.S)
    def r(m):
        onclick, dis, cls, texto = m.groups()
        for rx, var in VARIANTE_POR_CLASES:
            if rx.match(cls.strip()):
                n['botones2'] += 1
                full = ' fullWidth' if cls.startswith('w-full') else ''
                v = '' if var == 'primary' else f' variant="{var}"'
                d = dis.strip() if dis else ''
                d = f' {d}' if d else ''
                return f'<Button{v} size="{tamano}"{full}{d} onClick={{{onclick}}}>{texto.strip()}</Button>'
        return m.group(0)
    s = pat.sub(r, s)
    patc = re.compile(r'<div className="w-16 h-16 rounded-card (bg-[\w-]+) flex items-center justify-center mx-auto mb-3">\s*<(\w+) size=\{32\} className="([^"]+)" />\s*</div>')
    def rc(m):
        n['cabeceras'] += 1
        return f'<span aria-hidden="true" className="size-20 rounded-full {m.group(1)} flex items-center justify-center mx-auto mb-3 animate-aparece motion-reduce:animate-none">\n  <{m.group(2)} size={{ICONO.xl}} className="{m.group(3)}" />\n</span>'
    s = patc.sub(rc, s)
    return s, n

def asegurar_icono(s):
    if 'ICONO.' in s and not re.search(r"import \{[^}]*\bICONO\b[^}]*\} from '[./]+config/iconos'", s):
        prof = re.search(r"from '((?:\.\./)+)components/", s)
        base = prof.group(1) if prof else '../../'
        lineas = s.split('\n')
        ult = max(i for i, l in enumerate(lineas) if l.startswith('import '))
        lineas.insert(ult + 1, f"import {{ ICONO }} from '{base}config/iconos'")
        s = '\n'.join(lineas)
    return s

def correr2(archivos):
    for f in archivos:
        s = open(f).read()
        s2, n = pasada2(s)
        s2 = asegurar_import(s2, ['Input', 'Button'])
        s2 = asegurar_icono(s2)
        if s2 != s:
            open(f, 'w').write(s2)
        print(f, n)

# ── Pasada 3: íconos a la escala (config/iconos.js) ─────────────────────────
# size={N} numérico ≤ 28 → ICONO.xs/sm/md/lg. Los ≥ 30 (ilustración) se
# deciden a mano. Los size={X ? a : b} no se tocan.
MAPA_ICONO = {**{n: 'xs' for n in (10, 11, 12, 13, 14)}, **{n: 'sm' for n in (15, 16, 17)},
              **{n: 'md' for n in (18, 19, 20, 21, 22)}, **{n: 'lg' for n in (23, 24, 25, 26, 27, 28)}}

def escala_iconos(s):
    n = 0
    def r(m):
        nonlocal n
        v = int(m.group(1))
        if v not in MAPA_ICONO:
            return m.group(0)
        n += 1
        return f'size={{ICONO.{MAPA_ICONO[v]}}}'
    s = re.sub(r'size=\{(\d+)\}', r, s)
    return s, n

def correr3(archivos):
    for f in archivos:
        s = open(f).read()
        s2, n = escala_iconos(s)
        s2 = asegurar_icono(s2)
        if s2 != s:
            open(f, 'w').write(s2)
        print(f, {'iconos': n})
