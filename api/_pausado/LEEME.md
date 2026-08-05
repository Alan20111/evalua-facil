# Endpoints pausados (Mercado Pago / PayPal)

Estos cuatro archivos son código **vivo y completo**, solo que no se despliegan.

## Por qué están aquí

El plan Hobby de Vercel admite **12 funciones serverless por despliegue**. Al
agregar `api/admin/last-access.js` quedamos en 13 y **todos los despliegues
empezaron a fallar** — producción se quedó cuatro commits atrás sin que nada en
el código estuviera mal (5-ago-2026).

Vercel no convierte en ruta nada que viva bajo una carpeta que empiece con `_`
(por eso `api/_lib` nunca contó). Moverlos aquí baja la cuenta a 9 y deja
margen para las siguientes.

## Por qué estos cuatro y no otros

En la versión 1.0.1 el único método de pago es la transferencia: nadie llama a
Mercado Pago ni a PayPal desde la app (se comprobó buscando las rutas en `src/`
antes de moverlos).

**`api/mp/webhook.js` se quedó donde estaba a propósito.** Esa URL no la llama
la app: la llama Mercado Pago desde afuera. Si alguna suscripción vieja siguiera
cobrando por ahí, moverla dejaría ese aviso en el vacío y el pago no quedaría
registrado.

## Cómo revivirlos

Regresarlos a `api/mp/` y `api/paypal/` con sus nombres originales:

```bash
git mv api/_pausado/mp-create-subscription.js api/mp/create-subscription.js
git mv api/_pausado/mp-process-payment.js     api/mp/process-payment.js
git mv api/_pausado/paypal-create-order.js    api/paypal/create-order.js
git mv api/_pausado/paypal-capture-order.js   api/paypal/capture-order.js
```

Antes de hacerlo, revisa cuántas funciones quedarían: con estas cuatro de
vuelta serían 13 y **el despliegue vuelve a fallar**. Habría que subir de plan
o agrupar varias rutas en una sola función.
