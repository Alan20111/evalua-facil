# Setup Design System — Guía Completa

## ✅ Lo que se instaló

- **Storybook**: Galería de componentes interactiva (puerto 6006)
- **Axe DevTools**: Validación de accesibilidad WCAG 2.1 AA
- **Playwright**: Testing responsivo automatizado (375 / 768 / 1440px)
- **Chromatic**: Visual testing premium en cloud
- **GitHub Actions**: CI/CD automático en cada push
- **Figma Tokens**: Sincronización de tokens Figma → Código (próximo paso)

---

## 🚀 Primeros pasos

### 1. Instalar dependencias
```bash
npm install
```

### 2. Verificar que Storybook levante
```bash
npm run storybook
# Se abre en http://localhost:6006
```

### 3. Ver las historias de ejemplo
- Button (3 tamaños: mobile/tablet/desktop)
- Input (estándar, error, disabled, focus)
- Card (estándar, con borde, fila clicable, acordeón)

---

## 🧪 Comandos principales

### Desarrollo
```bash
npm run dev              # App React
npm run storybook       # Storybook en 6006
```

### Testing
```bash
npm run test:a11y              # Validación accesibilidad WCAG 2.1 AA
npm run test:responsive        # Testing responsive (3 breakpoints)
npm run test:responsive:debug  # Con debugger de Playwright
npm run test:responsive:headed # Ver navegador en vivo
```

### Validación completa
```bash
npm run design:verify  # Build Storybook + test a11y + test responsive
```

### Deploy
```bash
npm run storybook:build  # Genera archivos estáticos
npm run chromatic        # Sube a Chromatic (visual testing)
```

---

## 🔐 Configurar CI/CD (GitHub Actions)

El workflow automático valida cada push en `main` y `test`:

### Secrets necesarios (GitHub → Settings → Secrets and variables)

1. **CHROMATIC_PROJECT_TOKEN**
   - Ve a https://www.chromatic.com/
   - Crea proyecto → copia token
   - Pega en GitHub Secrets

2. **VERCEL_TOKEN** (opcional, para deploy automático)
   - Ve a https://vercel.com → Settings → Tokens
   - Crea token → GitHub Secrets

3. **VERCEL_ORG_ID** y **VERCEL_PROJECT_ID** (opcional)
   - Vercel → Project → Settings → General

### Qué hace el workflow automático:

```
git push → GitHub Actions
  ├─ Job 1: Accesibilidad (Axe)
  │  └─ Detecta contraste bajo, labels faltantes, focus rings, etc.
  ├─ Job 2: Responsive (Playwright)
  │  └─ Toma screenshots en 375/768/1440px, detecta cambios
  ├─ Job 3: Chromatic (visual testing)
  │  └─ Compara antes/después, sombra de cambios visuales
  └─ Job 4: Deploy (solo en main)
     └─ Publica Storybook en Vercel
```

Si algo falla, GitHub te avisa en el PR. ✅ = listo para mergear.

---

## 📱 Figma ↔ Código (siguiente paso)

### Configurar Figma Tokens Plugin:

1. Abre tu archivo Figma
2. Instala plugin: **Tokens Studio for Figma**
3. En el panel → Set → crea sets de tokens (colores, tipografía, etc.)
4. Exporta a JSON
5. Guarda `tokens.json` en la raíz del proyecto
6. En `tailwind.config.js`, lee el JSON

Ejemplo:
```javascript
import tokens from './tokens.json';

export default {
  theme: {
    colors: {
      surface: tokens.colors.surface.value,
      accent: tokens.colors.accent.value,
      // ... etc
    }
  }
}
```

Resultado: cambios en Figma → automáticamente en código (con push).

---

## 🎨 Agregar nuevos componentes

Cada componente = 1 archivo `.stories.js`:

```javascript
// src/components/MyComponent.stories.js

export default {
  title: 'Components/MyComponent',
  parameters: {
    layout: 'centered',
    design: {
      type: 'figma',
      url: 'https://www.figma.com/file/XXX?node-id=123'
    }
  }
};

export const Mobile = {
  render: () => <MyComponent />,
  parameters: { viewport: { defaultViewport: 'mobile' } }
};

export const Desktop = {
  render: () => <MyComponent />,
  parameters: { viewport: { defaultViewport: 'desktop' } }
};
```

En CI/CD automáticamente:
1. Axe valida que sea accesible
2. Playwright toma screenshots
3. Chromatic los compara

---

## 📊 Dashboard de calidad

Después de cada push:

- **GitHub Actions**: estado de tests (✅/❌)
- **Chromatic**: visual testing en cloud
- **Storybook**: publicado en Vercel (link en Chromatic)

Ejemplo de flujo:

```
Diseñador edita Figma
        ↓
Desarrollador copia URL a story
        ↓
npm push
        ↓
GitHub Actions valida a11y + responsive
        ↓
Chromatic compara cambios visuales
        ↓
Storybook auto-publica en Vercel
        ↓
Design System vivo y documentado
```

---

## ⚙️ Troubleshooting

### Storybook no levanta
```bash
rm -rf node_modules/.storybook-cache
npm run storybook
```

### Axe tests fallan
```bash
# Revisa qué controles tienen problemas
npm run test:a11y
cat a11y-results.json | jq '.violations'
```

### Playwright no encuentra elementos
```bash
npm run test:responsive:headed  # Ve el navegador en vivo
npm run test:responsive:debug   # Debugger interactivo
```

### Chromatic no sube
```bash
# Verifica token en .env
echo $CHROMATIC_PROJECT_TOKEN
# Si está vacío, configúralo en GitHub Secrets
```

---

## 📚 Recursos

- [Storybook docs](https://storybook.js.org/)
- [Axe DevTools](https://www.deque.com/axe/devtools/)
- [Playwright docs](https://playwright.dev/)
- [Chromatic docs](https://www.chromatic.com/docs/)
- [WCAG 2.1 AA standard](https://www.w3.org/WAI/WCAG21/quickref/)
- [Tailwind CSS](https://tailwindcss.com/)

---

## 🤝 Flujo de trabajo

1. **Edita Figma** → copia URL del componente
2. **Crea/edita story** en `src/components/XXX.stories.js`
3. **git add + commit + push**
4. **GitHub Actions** valida automáticamente
5. **Chromatic** compara cambios visuales
6. **Storybook** se publica automáticamente
7. **Si todo pasa** → ✅ PR listo para mergear

¡Todo se actualiza automáticamente en cada push!

