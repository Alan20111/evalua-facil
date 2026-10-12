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
        return f'<Button type="{tipo}" fullWidth busy={{{busy}}}{disabled}{oc}>\n{ind}  {texto.strip()}\n{ind}</Button>'
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

def ruta_ui(archivo):
    import os
    if not archivo:
        return '../../components/ui'
    r = os.path.relpath('src/components/ui', os.path.dirname(archivo))
    return r if r.startswith('.') else './' + r

def asegurar_import(s, nombres, archivo=None):
    usados = [x for x in nombres if re.search(r'<' + x + r'\b', s)]
    if not usados: return s
    # Los imports por defecto (…/ui/Button, …/ui/Input) se cambian por el barril.
    for u in usados:
        s = re.sub(r"import " + u + r" from '[./]*(?:components/)?ui/" + u + r"'\n", '', s)
    m = re.search(r"import \{([^}]*)\} from '([./]*(?:components/)?ui)'", s)
    if m:
        actuales = [x.strip() for x in m.group(1).split(',') if x.strip()]
        faltan = [u for u in usados if u not in actuales]
        if faltan:
            s = s[:m.start(1)] + ' ' + ', '.join(actuales + faltan) + ' ' + s[m.end(1):]
        return s
    lineas = s.split('\n')
    ult = max(i for i, l in enumerate(lineas) if l.startswith('import '))
    lineas.insert(ult + 1, f"import {{ {', '.join(usados)} }} from '{ruta_ui(archivo)}'")
    return '\n'.join(lineas)

if __name__ == '__main__':
    for f in sys.argv[1:]:
        s = open(f).read()
        s2, n = migrar(s)
        s2 = asegurar_import(s2, ['Input', 'Button'], f)
        if s2 != s:
            open(f, 'w').write(s2)
        print(f, n)

# ── Pasada 2: botones de texto simples y cabeceras de resultado ─────────────
VARIANTE_POR_CLASES = [
    (re.compile(r'^(w-full )?px-[45] py-2\.5 bg-accent (hover:bg-accent-hover )?text-white (text-sm )?font-semibold rounded-full (hover:bg-accent-hover )?transition(-colors)?( disabled:opacity-60)?$'), 'primary'),
    (re.compile(r'^(w-full )?px-[45] py-2\.5 border border-outline-variant (text-muted|text-on-surface) (text-sm )?font-semibold rounded-full transition(-colors)? hover:bg-(surface-container|surface)$'), 'secondary'),
]

def pasada2(s, tamano='md'):
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
                tam = '' if tamano == 'md' else f' size="{tamano}"'
                return f'<Button{v}{tam}{full}{d} onClick={{{onclick}}}>{texto.strip()}</Button>'
        return m.group(0)
    s = pat.sub(r, s)
    patc = re.compile(r'<div className="w-16 h-16 rounded-card (bg-[\w-]+) flex items-center justify-center mx-auto mb-3">\s*<(\w+) size=\{32\} className="([^"]+)" />\s*</div>')
    def rc(m):
        n['cabeceras'] += 1
        return f'<span aria-hidden="true" className="size-20 rounded-full {m.group(1)} flex items-center justify-center mx-auto mb-3 animate-aparece motion-reduce:animate-none">\n  <{m.group(2)} size={{ICONO.xl}} className="{m.group(3)}" />\n</span>'
    s = patc.sub(rc, s)
    return s, n

def asegurar_icono(s, archivo=None):
    import os
    if 'ICONO.' in s and not re.search(r"import \{[^}]*\bICONO\b[^}]*\} from '[./]+config/iconos'", s):
        if archivo:
            ruta = os.path.relpath('src/config/iconos', os.path.dirname(archivo))
            ruta = ruta if ruta.startswith('.') else './' + ruta
        else:
            ruta = '../../config/iconos'
        lineas = s.split('\n')
        ult = max(i for i, l in enumerate(lineas) if l.startswith('import '))
        lineas.insert(ult + 1, f"import {{ ICONO }} from '{ruta}'")
        s = '\n'.join(lineas)
    return s

def correr2(archivos):
    for f in archivos:
        s = open(f).read()
        s2, n = pasada2(s)
        s2 = asegurar_import(s2, ['Input', 'Button'], f)
        s2 = asegurar_icono(s2, f)
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
        s2 = asegurar_icono(s2, f)
        if s2 != s:
            open(f, 'w').write(s2)
        print(f, {'iconos': n})

# ── Pasada 4: <button> de texto con estilo de botón → <Button variant> ──────
# Reconoce por sus clases los botones primario, secundario, de peligro y
# contorno de peligro con className de texto fijo (sin plantillas). Conserva
# las clases de colocación (márgenes, flex-1, self-*, ml-auto…) y pasa
# w-full → fullWidth. El patrón {x ? <Spinner/> : <Icono/>} → busy={x} icon.
ESTILO = re.compile(r'^(?:(?:hover|focus|focus-visible|disabled|active):.*|p[xy]?-[\d.]+|py-[\d.]+|px-[\d.]+|text-(?:sm|xs|base|white|accent|muted|on-surface|red-\d+)|font-(?:semibold|medium|bold)|rounded(?:-full)?|transition(?:-\w+)?|duration-\w+|flex|inline-flex|items-center|justify-center|gap-[\d.]+|bg-[\w/\[\]()-]+|border(?:-[\w/-]+)?|shadow-\w+|whitespace-nowrap|text-center|w-full|cursor-pointer|select-none)$')

def variante_de(tokens):
    t = set(tokens)
    if 'bg-accent' in t and 'text-white' in t: return 'primary'
    if any(x in t for x in ('bg-red-600', 'bg-red-500')) and 'text-white' in t: return 'danger'
    if 'border-red-300' in t and any(x.startswith('text-red') for x in t): return 'danger-outline'
    if 'border-outline-variant' in t and 'rounded-full' in t: return 'secondary'
    if 'border-accent' in t and 'text-accent' in t and 'rounded-full' in t: return 'outline-accent'
    return None

def fin_tag(s, i):
    d = 0; q = None; j = i + 1
    while j < len(s):
        c = s[j]
        if q:
            if c == '\\': j += 2; continue
            if c == q: q = None
        elif c in '"\'`' and (d > 0 or c == '"'): q = c
        elif c == '{': d += 1
        elif c == '}': d -= 1
        elif c == '>' and d == 0: return j
        j += 1
    return -1

def pasada4(s):
    n = 0; out = []; pos = 0
    for m in re.finditer(r'<button\b', s):
        if m.start() < pos: continue
        fin = fin_tag(s, m.start())
        if fin < 0 or s[fin - 1] == '/': continue
        cierre = s.find('</button>', fin)
        if cierre < 0 or '<button' in s[fin:cierre]: continue
        tag = s[m.start():fin + 1]
        cm = re.search(r'\sclassName="([^"]*)"', tag)
        if not cm: continue
        toks = cm.group(1).split()
        # Botones de solo ícono (w-7 h-7, size-9…) no son botones de texto.
        if any(re.match(r'^(?:w|h|size)-\d', x) for x in toks): continue
        var = variante_de(toks)
        if not var: continue
        extra = [x for x in toks if not ESTILO.match(x)]
        full = 'w-full' in toks
        attrs = tag[len('<button'):-1].replace(cm.group(0), '')
        attrs = re.sub(r'\s+type="button"', '', attrs)
        cuerpo = s[fin + 1:cierre]
        busy = ''
        sp = re.search(r'\{(\w+) \? <Spinner size="sm" /> : (?:<(\w+) size=\{[^}]+\}(?: className="[^"]*")? />|null)\}', cuerpo)
        icono = ''
        if sp:
            busy = f' busy={{{sp.group(1)}}}'
            if sp.group(2): icono = f' icon={{{sp.group(2)}}}'
            cuerpo = cuerpo.replace(sp.group(0), '')
        else:
            ic = re.match(r'(\s*)<(\w+) size=\{[^}]+\}(?: className="[^"]*")? />', cuerpo)
            if ic and ic.group(2)[0].isupper() and ic.group(2) not in ('Spinner',):
                icono = f' icon={{{ic.group(2)}}}'
                cuerpo = cuerpo[:ic.start(2) - 1] + cuerpo[ic.end():]
        v = '' if var == 'primary' else f' variant="{var}"'
        cls = f' className="{" ".join(extra)}"' if extra else ''
        attrs = re.sub(r'\n[ \t]*$', '', attrs.rstrip()) if attrs.strip() else ''
        if attrs and not attrs.startswith((' ', '\n')): attrs = ' ' + attrs
        nuevo = f'<Button{v}{" fullWidth" if full else ""}{icono}{busy}{cls}{attrs}>{cuerpo}</Button>'
        out.append(s[pos:m.start()]); out.append(nuevo); pos = cierre + len('</button>'); n += 1
    out.append(s[pos:])
    return ''.join(out), n

def correr4(archivos):
    for f in archivos:
        s = open(f).read()
        s2, n = pasada4(s)
        s2 = asegurar_import(s2, ['Input', 'Button'], f)
        if s2 != s:
            open(f, 'w').write(s2)
        print(f, {'botones4': n})

# ── Pasada 5: tokens de color, botones de ícono y esquinas a medias ─────────
def pasada5(s):
    n = {'tokens': 0, 'iconbuttons': 0, 'esquinas': 0}
    # 1) grises sueltos → tokens (solo texto; los fondos slate se quedan)
    for viejo, nuevo in (('text-slate-500', 'text-muted'), ('text-slate-600', 'text-muted'), ('text-slate-300', 'text-hint')):
        k = len(re.findall(r'(?<![\w:-])' + viejo + r'(?![\w-])', s))
        s = re.sub(r'(?<![\w:-])' + viejo + r'(?![\w-])', nuevo, s); n['tokens'] += k
    # 2) <button … aria-label="X" … className="p-2 … rounded-full …"><Icono size={…} /></button>
    pat = re.compile(r'<button\b((?:(?!>)[^{]|\{(?:[^{}]|\{[^{}]*\})*\})*?)>\s*<(\w+) size=\{[^}]+\}(?: className="[^"]*")? />\s*</button>', re.S)
    def r(m):
        attrs = m.group(1); icono = m.group(2)
        if not icono[0].isupper() or icono == 'Spinner': return m.group(0)
        cm = re.search(r'\sclassName="([^"]*)"', attrs)
        lm = re.search(r'\saria-label=(\{`[^`]*`\}|\{[^{}]*\}|"[^"]*")', attrs)
        if not cm or not lm: return m.group(0)
        toks = cm.group(1).split()
        if not any(re.fullmatch(r'p-(1\.5|2|2\.5|3)', t) for t in toks) or 'rounded-full' not in toks:
            return m.group(0)
        if any(t.startswith('bg-accent') or t.startswith('absolute') or t.startswith('fixed') for t in toks):
            return m.group(0)
        var = ' variant="danger"' if any('red' in t for t in toks) else ''
        coloca = [t for t in toks if re.match(r'^-?m[trblxy]?-|^flex-shrink-0$|^ml-auto$|^self-', t) and t != 'flex-shrink-0']
        resto = attrs.replace(cm.group(0), '').replace(lm.group(0), '')
        resto = re.sub(r'\s+type="button"', '', resto)
        etiqueta = lm.group(1)
        cls = f' className="{" ".join(coloca)}"' if coloca else ''
        n['iconbuttons'] += 1
        return f'<IconButton icon={{{icono}}} label={etiqueta}{var} tooltip={{false}}{cls}{" " + resto.strip() if resto.strip() else ""} />'
    s = pat.sub(r, s)
    # 3) rounded + border sueltos: una línea → rounded-full; bloque → rounded-card
    def r3(m):
        cls = m.group(1); toks = cls.split()
        if 'rounded' not in toks or not any(t.startswith('border') for t in toks): return m.group(0)
        una_linea = 'items-center' in toks and any(t in toks for t in ('py-1', 'py-1.5', 'py-2', 'py-2.5')) and 'overflow-hidden' not in toks
        nuevo = ' '.join(('rounded-full' if una_linea else 'rounded-card') if t == 'rounded' else t for t in toks)
        n['esquinas'] += 1
        return f'className="{nuevo}"'
    s = re.sub(r'className="([^"]*\brounded border\b[^"]*)"', r3, s)
    return s, n

def correr5(archivos):
    for f in archivos:
        s = open(f).read()
        s2, n = pasada5(s)
        s2 = asegurar_import(s2, ['Input', 'Button', 'IconButton'], f)
        if s2 != s:
            open(f, 'w').write(s2)
        print(f, n)

# ── Pasada 6: botones de ícono por CLASE (los que no pudo tomar la 5) ──────
# Toda clase de botón con p-2/p-1.5 + text-hint (o text-muted) es un botón de
# solo ícono: pasa a medir una altura de control y queda redondo. Sirve
# también para className con plantilla, porque solo toca los tokens fijos.
def pasada6(s):
    n = 0
    def arreglar(cls):
        toks = cls.split()
        if not any(t in ('p-2', 'p-1.5') for t in toks): return None
        if not any(t in ('text-hint', 'text-muted') for t in toks): return None
        if any(t.startswith(('w-', 'h-', 'size-', 'absolute', 'px-', 'py-')) for t in toks): return None
        nuevos = []
        for t in toks:
            if t in ('p-2', 'p-1.5'):
                nuevos += ['size-control', 'inline-flex', 'items-center', 'justify-center']
            elif t == 'rounded':
                nuevos.append('rounded-full')
            else:
                nuevos.append(t)
        if 'rounded-full' not in nuevos: nuevos.append('rounded-full')
        return ' '.join(dict.fromkeys(nuevos))
    out = []; pos = 0
    for m in re.finditer(r'<button\b', s):
        if m.start() < pos: continue
        fin = fin_tag(s, m.start())
        if fin < 0: continue
        tag = s[m.start():fin + 1]
        cm = re.search(r'className=(?:"([^"]*)"|\{`([^`$]*)`\})', tag)
        if not cm: continue
        cls = cm.group(1) if cm.group(1) is not None else cm.group(2)
        nuevo_cls = arreglar(cls)
        if not nuevo_cls: continue
        nuevo_tag = tag[:cm.start()] + (f'className="{nuevo_cls}"' if cm.group(1) is not None else f'className={{`{nuevo_cls}`}}') + tag[cm.end():]
        out.append(s[pos:m.start()]); out.append(nuevo_tag); pos = fin + 1; n += 1
    out.append(s[pos:])
    return ''.join(out), n

# ── Pasada 7: altura mínima del contrato en botones píldora ────────────────
# Botón con rounded-full y relleno vertical: py-1/1.5/2 → + min-h-control-sm,
# py-2.5/3 → + min-h-control. Es ALTURA MÍNIMA (no fija): uno de un renglón
# queda exacto en la escala y uno de dos renglones puede crecer sin cortarse.
def pasada7(s):
    n = 0
    def arreglar(cls):
        toks = cls.split()
        if 'rounded-full' not in toks: return None
        if any(t.startswith(('h-', 'min-h-', 'size-', 'w-')) and not t.startswith('w-full') for t in toks): return None
        if any(t.startswith('min-h') or t.startswith('h-') for t in toks): return None
        if any(t in ('py-1', 'py-1.5', 'py-2') for t in toks): extra = 'min-h-control-sm'
        elif any(t in ('py-2.5', 'py-3') for t in toks): extra = 'min-h-control'
        else: return None
        return cls.rstrip() + ' ' + extra
    out = []; pos = 0
    for m in re.finditer(r'<button\b', s):
        if m.start() < pos: continue
        fin = fin_tag(s, m.start())
        if fin < 0: continue
        tag = s[m.start():fin + 1]
        cm = re.search(r'className=(?:"([^"]*)"|\{`([^`]*?)(\$\{|`))', tag)
        if not cm: continue
        if cm.group(1) is not None:
            nuevo = arreglar(cm.group(1))
            if not nuevo: continue
            nuevo_tag = tag[:cm.start(1)] + nuevo + tag[cm.end(1):]
        else:
            nuevo = arreglar(cm.group(2))
            if not nuevo: continue
            nuevo_tag = tag[:cm.start(2)] + nuevo + (' ' if cm.group(3) == '${' else '') + tag[cm.end(2):]
        out.append(s[pos:m.start()]); out.append(nuevo_tag); pos = fin + 1; n += 1
    out.append(s[pos:])
    return ''.join(out), n
