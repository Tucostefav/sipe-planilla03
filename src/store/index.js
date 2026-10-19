'use strict';

const path = require('path');
const { FileStore } = require('./fileStore');
const { MysqlStore } = require('./mysqlStore');

// Con DB_HOST usa MySQL (producción en Hostinger); si no, archivos JSON en DATA_DIR.
function crearStore(env = process.env) {
  if (env.DB_HOST) {
    return new MysqlStore({
      host: env.DB_HOST,
      port: Number(env.DB_PORT || 3306),
      user: env.DB_USER,
      password: env.DB_PASSWORD,
      database: env.DB_NAME,
    });
  }
  return new FileStore(env.DATA_DIR || path.join(__dirname, '..', '..', 'data'));
}

module.exports = { crearStore };
