'use strict';

const { crearApp } = require('./src/app');
const { crearStore } = require('./src/store');
const { crearAuth } = require('./src/auth');

async function main() {
  const store = crearStore();
  await store.init();
  const auth = crearAuth();
  if (!auth.configurado) console.warn('AVISO: APP_CLAVE no está configurada; nadie podrá entrar.');
  const port = Number(process.env.PORT || 3000);
  crearApp({ store, auth }).listen(port, () => console.log(`SIPE Planilla 03 escuchando en el puerto ${port}`));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
