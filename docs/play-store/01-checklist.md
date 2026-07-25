# Checklist de publicación — Evalúa Fácil

Estado a la fecha de esta preparación. ✅ = listo · ⏳ = en curso (Google) · ⬜ = te toca a ti.

## Técnico (código / build) — casi todo ✅
| Ítem | Estado | Nota |
|---|---|---|
| Nombre de paquete válido (`mx.evaluafacil.app`) | ✅ | Ya no es el placeholder `com.example.app` |
| App Android registrada en Firebase con el paquete nuevo | ✅ | `google-services.json` actualizado |
| Keystore de firma creado y respaldado | ✅ | `~/evaluafacil-android/` (fuera de git) |
| Firma de release configurada (Gradle) | ✅ | Play App Signing |
| AAB firmado compilado | ✅ | `~/evaluafacil-android/evalua-facil-v1.0-release.aab` |
| targetSdk cumple el mínimo de Play | ✅ | API 36, por encima del mínimo (35) |
| Permisos mínimos | ✅ | INTERNET, POST_NOTIFICATIONS, SCHEDULE_EXACT_ALARM |
| Icono de la app (512×512) | ✅ | La hojita |
| Política de privacidad publicada | ✅ | `https://evaluafacil.mx/privacidad` |
| Gráfico destacado (1024×500) | ✅ | `assets/feature-graphic.png` |

### ⚠️ Punto de atención técnico
- **`SCHEDULE_EXACT_ALARM`**: Google Play vigila este permiso. Lo usa la app para los
  recordatorios de clase a hora exacta (`@capacitor/local-notifications`). Si Play lo
  marca durante la revisión, hay que **declarar el caso de uso** en el formulario que
  aparezca (es un uso legítimo: recordatorios programados por el usuario). Alternativa
  si diera problemas: cambiar a alarmas inexactas (perdería precisión de minutos).

## Cuenta y verificación — depende de Google
| Ítem | Estado |
|---|---|
| Cuenta de desarrollador creada + $25 pagados | ✅ |
| Verificación de identidad (documentos) | ⏳ Google revisando (días) |
| Verificación de teléfono | ⬜ Play Console → "Ver detalles" |

## Ficha y formularios — te toca a ti (con los textos de esta carpeta)
| Ítem | Estado | Archivo |
|---|---|---|
| Crear la app en Play Console | ⬜ | `README.md` FASE B |
| Nombre + descripción corta + completa | ⬜ | `02-ficha-tienda.md` |
| Formulario de Seguridad de los datos | ⬜ | `03-seguridad-de-datos.md` |
| Clasificación de contenido | ⬜ | `04-clasificacion-contenido.md` |
| Público objetivo (13-15, 16-17, 18+) | ⬜ | NO marcar "diseñada para niños" |
| Anuncios → No | ⬜ | La app no tiene anuncios |
| Acceso a la app (login de prueba para revisores) | ⬜ | `05-acceso-revisores.md` |
| Capturas de teléfono (mín. 2) | ⬜ parcial | Ver abajo |
| Subir AAB a Prueba interna | ⬜ | `06-firma-y-aab.md` |
| Prueba cerrada 12 testers × 14 días | ⬜ | Requisito de cuenta personal nueva |

### Capturas de pantalla
- En `assets/` hay capturas de las pantallas **públicas** (bienvenida, inicio de sesión).
- Las capturas de las pantallas **con sesión iniciada** (panel del docente, captura de
  calificaciones, calendario, evaluaciones) hay que tomarlas entrando a la app — se
  hacen rápido juntos, o las tomas tú desde el celular con una cuenta de prueba y una
  materia de ejemplo. Play pide **mínimo 2**; con 4-8 buenas queda una ficha sólida.

## Lo único que realmente te bloquea
1. La **verificación de identidad** de Google (⏳, no depende de nadie más).
2. La **prueba cerrada de 14 días** (requisito de cuenta personal nueva).

Todo lo demás ya está listo o preparado en esta carpeta.
