# SIPE · Planilla 03 e Informe 03

Aplicación web en Node.js. El usuario sube el **detalle de planilla que emite la CSS (SIPE)**, y el sistema genera:

- **Informe 03 (DGI):** un archivo por mes, con el formato exacto de la plantilla *INFORME 03v5* que se sube a la DGI.
- **Planilla 03:** el acumulado anual por empresa. Cada mes que se sube llena sus columnas (salario, prima de producción, porción de prima que es salario, XIII mes e ISR), y además calcula las cuotas a la CSS.

Los dos reportes se ven en pantalla y se pueden descargar en Excel.

## Cómo se usa

1. Entra con el usuario y la clave.
2. En **Inicio**, sube el detalle de planilla. La empresa se reconoce por el RUC y el mes por el "Mes cuota". Si subes de nuevo un mes que ya estaba, se reemplaza.
3. La primera vez, en la página de la empresa, escribe el **ID_PLANILLA** (es el código interno de la CSS que va en la columna A del Informe 03).
4. La CSS solo trae el primer nombre y el primer apellido. El **maestro de empleados** guarda el nombre completo y el DV de cada cédula:
   - En **Empleados → Importar**, sube un Informe 03 o una Planilla 03 de antes. Se llena solo.
   - Si aparece alguien nuevo, el sistema lo pide después de subir el detalle.
5. Abre el **Informe 03** del mes o la **Planilla 03** del año y descárgalos.

## Reglas de cálculo

| Informe 03 | Sale del detalle CSS |
|---|---|
| SALARIO | "Salario" del empleado (lo que constituye salario) |
| SUELDO, VACACIONES, HORAS_EXTRAS, COMISIONES, BONIFICACIONES, SALARIO_ESPECIE, DIETA, PRIMA_PRODUCCION, DTM, GRATIFICACION_AGUINALDOS, GASTO_REPRESENTACION | El monto reportado del concepto con el mismo nombre |
| IMPUESTO_RENTA | El concepto "Impuesto sobre la renta" |
| TOTAL_DE_DEDUCCIONES, RENTA_NETA_GRAVABLE, A_FAVOR_DEL_FISCO, A_FAVOR_DEL_EMPLEADO | Las mismas fórmulas de la plantilla de la DGI |
| RETENCIONES_SALARIO | Igual a IMPUESTO_RENTA (el ISR ya se retuvo en planilla) |
| RETENCIONES_GR | Igual a IMP_RENTA_REPRESENTACION |
| Las deducciones | 0 (no vienen en el detalle de la CSS) |

- Como las retenciones son iguales al impuesto, A_FAVOR_DEL_FISCO y A_FAVOR_DEL_EMPLEADO siempre dan 0.
- Los viáticos no van al Informe 03.
- Las filas van ordenadas por cédula.
- El sistema revisa que la suma de SALARIO y la de ISR sean iguales a los totales del detalle de la CSS.

En la Planilla 03, la columna de salario del mes es lo que constituye salario sin la prima (sueldo, vacaciones, etc.). PP es la prima de producción y PP SS es la parte de la prima que pasa del 50% del salario. Para las cuotas se usan estas tasas: SS patronal 13.25% (12.25% antes de abril de 2025), SS XIII patronal 10.75%, SE patronal 1.5%, riesgo profesional según la tasa del detalle, SS empleado 9.75%, SS XIII empleado 7.25% y SE empleado 1.25%. Al final se compara contra el total del detalle de la CSS. El ISR anual estimado usa los tramos 0% / 15% / 25%.

## Instalación local

```bash
npm install
cp .env.example .env   # y edita APP_CLAVE y SESSION_SECRET
APP_CLAVE=mi-clave SESSION_SECRET=algo-largo npm start
# abre http://localhost:3000
npm test
```

Si no hay `DB_HOST`, los datos se guardan en archivos JSON dentro de `data/`. Esa carpeta no se sube a GitHub.

## Despliegue en Hostinger (Business Web Hosting, Node.js desde GitHub)

1. En hPanel, entra a **Bases de datos → MySQL** y crea una base de datos con su usuario. Anota el host, el nombre, el usuario y la clave.
2. En **Sitios web → Agregar sitio → Aplicación web Node.js**, elige **Importar repositorio de GitHub** y selecciona este repositorio, rama `main`.
3. Configuración de compilación:
   - Versión de Node: 20 o superior
   - Comando de instalación: `npm install`
   - Archivo de entrada: `server.js` (o comando de inicio `npm start`)
4. Variables de entorno:
   - `APP_USUARIO`, `APP_CLAVE`: el usuario y la clave para entrar
   - `SESSION_SECRET`: un texto largo y aleatorio
   - `NODE_ENV=production`
   - `ENCARGA_SECRET` (opcional): la clave compartida para entrar desde ENCARGA sin clave. Los pasos están en [docs/ENCARGA.md](docs/ENCARGA.md).
   - `DB_HOST`, `DB_PORT` (3306), `DB_USER`, `DB_PASSWORD`, `DB_NAME`: los de la base de datos del paso 1
5. Despliega. La tabla `documentos` se crea sola la primera vez. Cada push a `main` vuelve a desplegar, y los datos quedan en MySQL.

## Estructura

```
server.js                 arranque
src/parseDetalleCSS.js    lee el detalle de planilla de la CSS
src/informe03.js          cálculo y Excel del Informe 03 (formato DGI)
src/planilla03.js         cálculo y Excel de la Planilla 03 anual
src/servicio.js           empresas, meses cargados y maestro de empleados
src/store/                guardado en MySQL o en archivos JSON
src/app.js, src/views.js  pantallas
scripts/crearDetalleEjemplo.js  genera un detalle de ejemplo con datos inventados
test/                     pruebas (node --test)
```
