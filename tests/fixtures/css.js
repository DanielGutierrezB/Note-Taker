'use strict';
/**
 * El CSS de la app entero, en el orden de la cascada.
 *
 * `src/css/style.css` es un índice de `@import`, uno por sección; las pruebas
 * que miran una regla la buscan en todo el estilo, como lo ve el navegador.
 */

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', '..', 'src', 'css');

module.exports = function cssEntero() {
    const indice = fs.readFileSync(path.join(DIR, 'style.css'), 'utf8');
    const partes = [...indice.matchAll(/@import url\("([^"]+)"\);/g)].map(m => m[1]);
    return [indice, ...partes.map(p => fs.readFileSync(path.join(DIR, p), 'utf8'))].join('\n');
};
