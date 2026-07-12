# Design System — Quick Start (5 min)

## Ya está configurado. Ahora:

### 1️⃣ Instalar dependencias (ya está en background)
```bash
npm install
```

### 2️⃣ Levantar Storybook
```bash
npm run storybook
```
→ Se abre en http://localhost:6006

### 3️⃣ Ver historias de ejemplo
Navega a:
- Components → Button (3 variantes: mobile/tablet/desktop)
- Components → Input (4 variantes: standard/error/disabled/focus)
- Components → Card (4 tipos: standard/border/row/accordion)

### 4️⃣ Validar accesibilidad
```bash
# Levanta Storybook primero en otra terminal
npm run test:a11y
```
→ Detecta contraste bajo, labels faltantes, focus rings

### 5️⃣ Testing responsivo
```bash
npm run test:responsive
```
→ Toma screenshots en 375/768/1440px

### 6️⃣ Commit y push
```bash
git add .
git commit -m "feat: design system setup completo"
git push -u origin test
```

→ GitHub Actions valida automáticamente
→ Chromatic compara cambios visuales
→ Storybook se publica en Vercel

---

## ✅ Después de cada cambio en Figma:

1. Crea/edita un `.stories.js`:
```javascript
export default {
  title: 'Components/Button',
  parameters: {
    design: {
      type: 'figma',
      url: 'https://www.figma.com/...' // URL de Figma
    }
  }
};

export const Primary = {
  render: () => <Button>Click me</Button>,
  parameters: { viewport: { defaultViewport: 'mobile' } }
};
```

2. Push:
```bash
git add . && git commit -m "feat: Button story" && git push
```

3. GitHub Actions valida automáticamente ✅

---

## 🔑 Secrets a configurar (GitHub)

Settings → Secrets and variables → New repository secret:

```
CHROMATIC_PROJECT_TOKEN = [tu_token_de_chromatic]
```

(Los otros son opcionales por ahora)

---

## 📞 Si algo no funciona:

```bash
# Limpia caché de Storybook
rm -rf node_modules/.storybook-cache

# Reintenta
npm run storybook
```

---

**¡Listo! Ahora tienes un Design System automatizado que se valida en cada push.**

Próximo: Configura Figma Tokens para sincronizar colores/tipografía directamente.
