# Entrar desde ENCARGA sin clave

ENCARGA decide qué usuarios pueden usar Planilla 03. Cuando uno de esos usuarios quiere entrar, ENCARGA le arma un enlace firmado. El programa revisa la firma y abre la sesión sin pedir usuario ni clave.

La firma usa una clave secreta que solo conocen ENCARGA y Planilla 03. El enlace sirve **una sola vez** y vence en pocos minutos.

## 1. Crear la clave secreta

Genera un texto largo y aleatorio, por ejemplo con:

```bash
openssl rand -hex 32
```

Guárdalo en un lugar seguro. **No lo mandes por chat ni por correo**, y no lo pongas en el código de ENCARGA que corre en el navegador.

## 2. Ponerla en Hostinger

En hPanel, entra a tu aplicación Node.js, luego a **Variables de entorno**, y agrega:

| Variable | Valor |
|---|---|
| `ENCARGA_SECRET` | la clave del paso 1 |

Guarda y dale a **Volver a desplegar**. Mientras `ENCARGA_SECRET` no esté puesta, la entrada desde ENCARGA queda apagada.

## 3. Ponerla en ENCARGA

Guarda la misma clave en el **servidor** de ENCARGA (en su configuración o en sus variables de entorno). Nunca la pongas en el navegador.

## 4. El botón "Abrir Planilla 03" en ENCARGA

Muéstralo solo a los usuarios que tengan el permiso. Cuando el usuario le da clic, el servidor de ENCARGA hace esto:

1. Arma un token JWT firmado con **HS256** y la clave secreta. Lleva estos datos:

   | Dato | Qué es | Obligatorio |
   |---|---|---|
   | `sub` | El usuario de ENCARGA, por ejemplo `mlopez` | Sí |
   | `iat` | La hora de ahora, en segundos (Unix) | Sí |
   | `exp` | Cuándo vence. Recomendado: `iat + 120` (2 minutos). El máximo que se acepta es 10 minutos. | Sí |
   | `jti` | Un identificador único del enlace, por ejemplo un UUID | Sí |
   | `ir` | La página que se abre al entrar, por ejemplo `/empresa/1234-5-67890/talonarios/202610`. Si no se pone, se abre el inicio. | No |

2. Abre en una pestaña nueva:

   ```
   https://rosybrown-armadillo-996892.hostingersite.com/sso?token=EL_TOKEN
   ```

La sesión dura 12 horas, igual que cuando se entra con la clave. Si el enlace ya se usó o ya venció, el programa manda a la pantalla de entrada con un aviso. El usuario solo tiene que volver a darle al botón en ENCARGA.

> El programa no se puede mostrar dentro de un marco (iframe) de ENCARGA. Ábrelo en una pestaña o ventana nueva.

### Ejemplo en PHP

```php
function enlacePlanilla03(string $usuario, string $ir = '/'): string {
    $secreto = getenv('ENCARGA_SECRET');
    $b64 = fn($s) => rtrim(strtr(base64_encode($s), '+/', '-_'), '=');
    $ahora = time();
    $cab = $b64(json_encode(['alg' => 'HS256', 'typ' => 'JWT']));
    $datos = $b64(json_encode([
        'sub' => $usuario, 'iat' => $ahora, 'exp' => $ahora + 120,
        'jti' => bin2hex(random_bytes(16)), 'ir' => $ir,
    ]));
    $firma = $b64(hash_hmac('sha256', "$cab.$datos", $secreto, true));
    return 'https://rosybrown-armadillo-996892.hostingersite.com/sso?token=' . urlencode("$cab.$datos.$firma");
}
```

### Ejemplo en Node.js

```js
const crypto = require('crypto');

function enlacePlanilla03(usuario, ir = '/') {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const ahora = Math.floor(Date.now() / 1000);
  const cuerpo = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: usuario, iat: ahora, exp: ahora + 120, jti: crypto.randomUUID(), ir })}`;
  const firma = crypto.createHmac('sha256', process.env.ENCARGA_SECRET).update(cuerpo).digest('base64url');
  return `https://rosybrown-armadillo-996892.hostingersite.com/sso?token=${encodeURIComponent(`${cuerpo}.${firma}`)}`;
}
```

En cualquier otro lenguaje sirve una librería de JWT. Se firma con HS256 y la clave secreta, y se mandan los datos de la tabla.

## 5. (Opcional) Que el servidor de ENCARGA baje los archivos directo

El servidor de ENCARGA también puede llamar al programa sin abrir el navegador. Para eso manda el mismo tipo de token en un encabezado:

```
Authorization: Bearer EL_TOKEN
```

En este caso el `jti` no es obligatorio, y el token sirve varias veces hasta que vence. Si el token no es válido, la respuesta es `401`. Algunas direcciones útiles (el periodo va como `AAAAMM`, por ejemplo `202610`):

| Qué | Dirección |
|---|---|
| Excel del Informe 03 para la DGI | `GET /empresa/{RUC}/informe03/{periodo}/excel` |
| Excel de la Planilla 03 del año | `GET /empresa/{RUC}/planilla03/{año}/excel` |
| Talonarios en PDF (todos) | `GET /empresa/{RUC}/talonarios/{periodo}/pdf?modo=1` (`1`, `2` o `mes`) |
| Talonarios, un PDF por empleado (ZIP) | `GET /empresa/{RUC}/talonarios/{periodo}/zip?modo=1` |
| Talonario de un empleado | `GET /empresa/{RUC}/talonarios/{periodo}/pdf?modo=1&cedula={cédula}` |
| Talonarios en Excel | `GET /empresa/{RUC}/talonarios/{periodo}/excel?modo=1` |
| Subir el detalle de la CSS | `POST /cargar`, multipart con el campo `archivo` |

Ejemplo con curl:

```bash
curl -H "Authorization: Bearer $TOKEN" -o informe03.xlsx \
  https://rosybrown-armadillo-996892.hostingersite.com/empresa/1234-5-67890/informe03/202610/excel
```

## Seguridad

- Quien tenga la clave secreta puede entrar como cualquier usuario. Guárdala solo en los servidores.
- Si crees que la clave se filtró, cámbiala en Hostinger y en ENCARGA al mismo tiempo. Los enlaces viejos dejan de servir.
- El programa todavía no separa permisos por empresa: quien entra desde ENCARGA ve todas las empresas, igual que con la clave.
