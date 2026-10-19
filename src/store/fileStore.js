'use strict';

const fs = require('fs');
const path = require('path');

// Guarda cada colección como un archivo JSON. Para desarrollo o un solo usuario.
class FileStore {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
    this.cache = new Map();
  }

  async init() {}

  _file(col) {
    return path.join(this.dir, `${col}.json`);
  }

  _load(col) {
    if (!this.cache.has(col)) {
      const f = this._file(col);
      this.cache.set(col, fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {});
    }
    return this.cache.get(col);
  }

  _save(col) {
    const f = this._file(col);
    const tmp = `${f}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this._load(col)));
    fs.renameSync(tmp, f);
  }

  async get(col, id) {
    const v = this._load(col)[id];
    return v ? JSON.parse(JSON.stringify(v)) : null;
  }

  async put(col, id, data) {
    this._load(col)[id] = data;
    this._save(col);
  }

  async putMany(col, docs) {
    const c = this._load(col);
    for (const [id, data] of docs) c[id] = data;
    this._save(col);
  }

  async delete(col, id) {
    delete this._load(col)[id];
    this._save(col);
  }

  async list(col, prefix = '') {
    return Object.entries(this._load(col))
      .filter(([id]) => id.startsWith(prefix))
      .map(([, v]) => JSON.parse(JSON.stringify(v)));
  }
}

module.exports = { FileStore };
