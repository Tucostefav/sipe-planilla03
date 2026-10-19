'use strict';

const mysql = require('mysql2/promise');

// Misma interfaz que FileStore, sobre una tabla MySQL (la base de datos de Hostinger).
class MysqlStore {
  constructor(config) {
    this.pool = mysql.createPool({ ...config, waitForConnections: true, connectionLimit: 5, charset: 'utf8mb4' });
  }

  async init() {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS documentos (
      coleccion VARCHAR(40) NOT NULL,
      id VARCHAR(120) NOT NULL,
      datos LONGTEXT NOT NULL,
      actualizado TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (coleccion, id)
    ) CHARACTER SET utf8mb4`);
  }

  async get(col, id) {
    const [rows] = await this.pool.query('SELECT datos FROM documentos WHERE coleccion = ? AND id = ?', [col, id]);
    return rows.length ? JSON.parse(rows[0].datos) : null;
  }

  async put(col, id, data) {
    await this.pool.query(
      'INSERT INTO documentos (coleccion, id, datos) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE datos = VALUES(datos)',
      [col, id, JSON.stringify(data)],
    );
  }

  async putMany(col, docs) {
    if (!docs.length) return;
    const values = docs.map(([id, data]) => [col, id, JSON.stringify(data)]);
    await this.pool.query('INSERT INTO documentos (coleccion, id, datos) VALUES ? ON DUPLICATE KEY UPDATE datos = VALUES(datos)', [values]);
  }

  async delete(col, id) {
    await this.pool.query('DELETE FROM documentos WHERE coleccion = ? AND id = ?', [col, id]);
  }

  async list(col, prefix = '') {
    const [rows] = await this.pool.query('SELECT datos FROM documentos WHERE coleccion = ? AND id LIKE ?', [col, `${prefix.replace(/[%_]/g, '\\$&')}%`]);
    return rows.map((r) => JSON.parse(r.datos));
  }
}

module.exports = { MysqlStore };
