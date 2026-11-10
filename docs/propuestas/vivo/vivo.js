// Prototipo de la propuesta de En vivo · punto medio. Datos y profesor de mentira.

const VISTAS = [
    { nombre: 'PV', titulo: 'Profesor', tecla: 'P', color: '#d22c36', tinta: '#fff' },
    { nombre: 'R', titulo: 'Pantalla', tecla: 'R', color: '#e96f24', tinta: '#fff' },
    { nombre: 'S', titulo: 'Slides', tecla: 'S', color: '#718637', tinta: '#fff' },
    { nombre: 'MG', titulo: 'Motion Graphics', tecla: 'M', color: '#3b82f6', tinta: '#fff' },
    { nombre: 'X2', titulo: 'Acelerar', tecla: 'X', color: '#af8bb1', tinta: '#0a0c10' }
];
const deVista = v => VISTAS.find(y => y.nombre === v) || VISTAS[0];
const estilo = v => `--vista:${deVista(v).color};--vista-tinta:${deVista(v).tinta}`;

const FRASES = (
    'Bueno, ahora vamos a ver cómo se conecta el disparador con la condición. ' +
    'Fíjense que cuando cambia el valor, todo se vuelve a evaluar desde el principio. ' +
    'Esto es importante porque si no lo tienen en cuenta, la automatización corre dos veces. ' +
    'Lo que vamos a hacer es abrir el editor y crear un flujo nuevo desde cero. ' +
    'Acá tengo el proyecto abierto, y lo primero que hago es elegir la plantilla correcta. ' +
    'Si se fijan en la esquina de arriba, ahí aparece el historial de ejecuciones. ' +
    'Cada uno de estos pasos se puede probar por separado, que es lo que les recomiendo. ' +
    'Ahora pensemos en qué pasa si el servicio no responde: necesitamos un reintento. ' +
    'Les dejo un ejercicio para la casa, que es armar el mismo flujo con dos condiciones. ' +
    'Y con esto cerramos la parte teórica y pasamos a la práctica con el ejemplo real.'
).split(' ');

const s = {
    rio: [], tomas: [], abierta: null, vistaProxima: 'PV', elegida: null, desplegadas: new Set(),
    letra: 19, filtro: '', compacto: false, verDesactivadas: true, pausado: false,
    guion: [], cur: 0, reloj: 0, ultimaDescartada: null
};

const $ = q => document.querySelector(q);
const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const tc = seg => { const t = Math.max(0, Math.floor(seg)); const p = n => String(n).padStart(2, '0'); return `${p(Math.floor(t / 3600))}:${p(Math.floor(t / 60) % 60)}:${p(t % 60)}`; };
const dura = seg => (seg >= 60 ? `${Math.floor(seg / 60)} min ${String(Math.floor(seg % 60)).padStart(2, '0')} s` : `${Math.max(0, Math.floor(seg))} s`);
const norm = w => w.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9ñ]/g, '');

let tostadaReloj = null;
function avisar(texto) {
    const t = $('#pv-tostada');
    t.textContent = texto;
    t.hidden = false;
    clearTimeout(tostadaReloj);
    tostadaReloj = setTimeout(() => { t.hidden = true; }, 2600);
}

/* ── Los datos ─────────────────────────────────────────────────────────── */

function hablar(w) {
    s.reloj += 0.42;
    s.rio.push({ w, t: s.reloj });
    return s.rio.length - 1;
}

function sembrar(cuantas) {
    s.rio = []; s.tomas = []; s.abierta = null; s.elegida = null; s.desplegadas = new Set(); s.reloj = 20;
    let c = 0;
    for (let k = 1; k <= cuantas; k++) {
        const sueltas = 6 + ((k * 7) % 10);
        for (let i = 0; i < sueltas; i++) hablar(FRASES[c++ % FRASES.length]);
        ['3,', '2,', '1.'].forEach(hablar);
        const inI = s.rio.length;
        const largo = 25 + ((k * 37) % 70);
        for (let i = 0; i < largo; i++) hablar(FRASES[c++ % FRASES.length]);
        const t = {
            id: k, vista: ['PV', 'PV', 'R', 'S', 'PV', 'MG', 'R', 'X2'][k % 8], inI, outI: s.rio.length - 1,
            nota: k % 9 === 0 ? 'Repetir el ejemplo' : '', comentarios: [], estado: 'lista', desactivada: k % 17 === 0
        };
        if (k % 6 === 0) t.comentarios.push({ a: inI + 4, b: inI + 7, comentario: 'Revisar si esto aporta' });
        s.tomas.push(t);
        hablar('Pausa.');
    }
    for (let i = 0; i < 14; i++) hablar(FRASES[c++ % FRASES.length]);
    s.cur = c;
}

const tomaDe = id => s.tomas.find(t => t.id === Number(id)) || null;
const anterior = t => s.tomas[s.tomas.indexOf(t) - 1] || null;
const siguiente = t => s.tomas[s.tomas.indexOf(t) + 1] || null;
const textoDe = (a, b) => s.rio.slice(a, b + 1).map(x => x.w).join(' ');
const finDe = t => (t.outI != null ? t.outI : s.rio.length - 1);

function renumerar() {
    s.tomas.forEach((t, i) => { t.id = i + 1; });
}

/* ── El profesor de mentira ────────────────────────────────────────────── */

function siguientePalabra() {
    if (s.guion.length) return s.guion.shift();
    if (!s.abierta && Math.random() < 0.02) { s.guion.push('3,', '2,', '1.'); return s.guion.shift(); }
    if (s.abierta && s.rio.length - s.abierta.inI > 80 && Math.random() < 0.015) return 'Pausa.';
    return FRASES[s.cur++ % FRASES.length];
}

function oir() {
    if (s.pausado) return;
    const i = hablar(siguientePalabra());
    const n = norm(s.rio[i].w);
    if (!s.abierta) {
        const cola = s.rio.slice(-3).map(x => norm(x.w)).join('');
        if (cola === '321') { abrir(i + 1, 'la cuenta'); return; }
        agregarPalabra(i);
    } else if (n === 'pausa') {
        cerrar(i - 1, '«Pausa»');
        return;
    } else if (/vamos a la pantalla\.?$/i.test(textoDe(i - 3, i))) {
        cerrar(i - 4, '«Vamos a la pantalla»');
        s.vistaProxima = 'R';
        abrir(i + 1, '«Vamos a la pantalla»');
        return;
    } else {
        agregarPalabra(i);
    }
    pintarCifras();
}

/* ── Los gestos sobre las tomas ────────────────────────────────────────── */

function abrir(inI, por) {
    if (s.abierta) return;
    const t = { id: s.tomas.length + 1, vista: s.vistaProxima, inI, outI: null, nota: '', comentarios: [], estado: 'abierta', desactivada: false };
    s.tomas.push(t);
    s.abierta = t;
    if (por) avisar(`Toma ${t.id} abierta por ${por}`);
    pintarTodo();
}

function cerrar(outI, por) {
    const t = s.abierta;
    if (!t) return;
    t.outI = Math.max(t.inI, outI);
    t.estado = 'releyendo';
    s.abierta = null;
    if (por) avisar(`Toma ${t.id} cerrada por ${por}`);
    setTimeout(() => { t.estado = 'lista'; pintarLista(); }, 2500);
    pintarTodo();
}

function bordeDeToma() {
    const b = $('#pv-enter');
    b.classList.add('es-apretado');
    setTimeout(() => b.classList.remove('es-apretado'), 140);
    if (s.abierta) cerrar(s.rio.length - 1, 'Enter');
    else abrir(s.rio.length, 'Enter');
}

function ponerBorde(t, borde, i) {
    if (!t) return;
    if (borde === 'in') {
        const previa = anterior(t);
        if (previa && i <= previa.outI) return avisar(`El IN no puede pasar a la toma ${previa.id}`);
        if (t.outI != null && i > t.outI) return avisar('El IN no puede quedar después del OUT');
        t.inI = i;
        avisar(`IN de la toma ${t.id}: «${s.rio[i].w}»`);
    } else {
        const prox = siguiente(t);
        if (prox && i >= prox.inI) return avisar(`El OUT no puede pasar a la toma ${prox.id}`);
        if (i < t.inI) return avisar('El OUT no puede quedar antes del IN');
        if (t === s.abierta) return cerrar(i, 'el OUT puesto a mano');
        t.outI = i;
        avisar(`OUT de la toma ${t.id}: «${s.rio[i].w}»`);
    }
    pintarTodo();
}

function dividir(t, i) {
    if (!t || i <= t.inI || i > finDe(t)) return;
    const nueva = { id: 0, vista: t.vista, inI: i, outI: t.outI, nota: '', comentarios: [], estado: t.estado, desactivada: false };
    t.outI = i - 1;
    if (t === s.abierta) { t.estado = 'releyendo'; s.abierta = nueva; nueva.estado = 'abierta'; }
    s.tomas.splice(s.tomas.indexOf(t) + 1, 0, nueva);
    renumerar();
    avisar(`Toma ${t.id} dividida: la ${nueva.id} empieza en «${s.rio[i].w}»`);
    pintarTodo();
}

function ponerVista(vista, cual) {
    const t = cual != null ? tomaDe(cual) : s.abierta;
    if (t) t.vista = vista; else s.vistaProxima = vista;
    if (t === s.abierta) s.vistaProxima = vista;
    pintarTodo();
}

/* ── El texto ──────────────────────────────────────────────────────────── */

function borde(tipo, t) {
    return `<span class="pv-borde es-${tipo}" draggable="true" data-borde="${tipo}" data-toma="${t ? t.id : 'espera'}"
                  title="Arrastralo a otra palabra${tipo === 'in' && !t ? ' para abrir una toma ahí' : ''}">${tipo.toUpperCase()}</span>`;
}

function buscada(i) {
    if (!s.filtro) return false;
    return norm(s.rio[i].w).includes(norm(s.filtro)) && norm(s.filtro).length > 1;
}

/** Las palabras de una toma con lo de alrededor, sus bordes y lo que tienen encima. */
function palabras(t, lo, hi) {
    const empieza = new Map(s.tomas.filter(x => x !== t).map(x => [x.inI, x]));
    const termina = new Map(s.tomas.filter(x => x !== t && x.outI != null).map(x => [x.outI, x]));
    let h = '';
    for (let i = lo; i <= hi; i++) {
        if (empieza.has(i)) h += `<span class="pv-limite" style="${estilo(empieza.get(i).vista)}">empieza la toma ${empieza.get(i).id}</span>`;
        if (i === t.inI) h += borde('in', t);
        const dentro = i >= t.inI && (t.outI == null || i <= t.outI);
        const cuenta = !dentro && i < t.inI && i >= t.inI - 3 && /^\d[.,]?$/.test(s.rio[i].w);
        let clase = 'pv-p';
        if (!dentro) clase += cuenta ? ' es-cuenta' : ' es-afuera';
        if (t.comentarios.some(c => i >= c.a && i <= c.b)) clase += ' es-comentada';
        if (buscada(i)) clase += ' es-buscada';
        h += `<span class="${clase}" data-i="${i}">${esc(s.rio[i].w)}</span> `;
        if (t.outI != null && i === t.outI) h += borde('out', t);
        if (termina.has(i)) h += `<span class="pv-limite" style="${estilo(termina.get(i).vista)}">fin de la toma ${termina.get(i).id}</span>`;
    }
    if (t.inI > hi) h += borde('in', t);
    return h;
}

function comentarios(t) {
    if (!t.comentarios.length) return '';
    return `<ul class="pv-comentarios">${t.comentarios.map((c, k) => `
      <li><q>${esc(textoDe(c.a, c.b))}</q> <b>${esc(c.comentario)}</b>
        <button class="btn-enlace" type="button" data-hace="corregir-comentario" data-toma="${t.id}" data-k="${k}">corregir</button>
        <button class="btn-enlace" type="button" data-hace="borrar-comentario" data-toma="${t.id}" data-k="${k}">borrar</button></li>`).join('')}</ul>`;
}

/* ── Pintar ────────────────────────────────────────────────────────────── */

function vistas(actual, cual, chica) {
    return `<span class="pv-vistas ${chica ? 'es-chica' : ''}">${VISTAS.map(v => `
      <button class="pv-vista" type="button" style="${estilo(v.nombre)}" data-vista="${v.nombre}" ${cual != null ? `data-toma="${cual}"` : ''}
              aria-pressed="${v.nombre === actual}" title="${v.titulo} · tecla ${v.tecla}"><kbd>${v.tecla}</kbd>${v.titulo}</button>`).join('')}</span>`;
}

/** Sobre qué toma caen las teclas de las vistas: la elegida, la abierta o la que viene. */
function laDeLasTeclas() {
    return (s.elegida != null && tomaDe(s.elegida)) || s.abierta || null;
}

function pintarAtajos() {
    const t = laDeLasTeclas();
    $('#pv-vistas-de').textContent = t ? `la toma ${t.id}:` : 'la que viene:';
    $('#pv-vistas-barra').innerHTML = vistas(t ? t.vista : s.vistaProxima, t ? t.id : null, true);
    const enter = $('#pv-enter');
    enter.classList.toggle('es-cerrar', Boolean(s.abierta));
    $('#pv-enter-dice').textContent = s.abierta ? `cierra la toma ${s.abierta.id}` : 'abre una toma';
}

function pintarAhora() {
    const t = s.abierta;
    const caja = $('#pv-ahora');
    caja.classList.toggle('es-espera', !t);
    caja.setAttribute('style', t ? estilo(t.vista) : '');
    const clave = [t && t.id, t ? t.vista : s.vistaProxima].join('|');
    const cabeza = $('#pv-ahora-cabeza');
    if (cabeza.dataset.clave !== clave) {
        cabeza.dataset.clave = clave;
        cabeza.innerHTML = `
          <span class="pv-ahora-titulo">${t
            ? `<span class="pv-sigla" style="${estilo(t.vista)}">${t.vista}</span> Toma ${t.id} <span class="pastilla" data-estado="abierta">abierta</span> <small>${tc(s.rio[Math.min(t.inI, s.rio.length - 1)].t)} · <span data-dura></span></small>`
            : '〰 Sin toma abierta <span class="pastilla" data-estado="escuchando">escuchando</span>'}</span>
          <span class="crece"></span>
          <span class="pv-letra"><button type="button" data-hace="menos" title="Texto más chico">A−</button><button type="button" data-hace="mas" title="Texto más grande">A+</button></span>
          <button class="btn btn-primario" type="button" data-hace="borde">${t ? '↑ Cerrar toma' : '↓ Abrir toma'} <kbd style="margin-left:6px">⏎</kbd></button>
          ${t ? `<div class="pv-ahora-nota" style="flex-basis:100%;padding:0"><input type="text" placeholder="Nota de esta toma — se escribe en el marcador del XML" value="${esc(t.nota)}" data-nota="${t.id}"></div>` : ''}`;
        $('#pv-ahora-pie').textContent = t
            ? 'Arrastrá el IN o el OUT a otra palabra, o clic derecho sobre una. Seleccioná un pedazo para comentarlo.'
            : 'Se abre sola con «3, 2, 1». Si ya empezó, arrastrá el IN hasta la primera palabra de la toma, o clic derecho sobre ella.';
    }
    const d = cabeza.querySelector('[data-dura]');
    if (d && t) d.textContent = dura(s.reloj - s.rio[Math.min(t.inI, s.rio.length - 1)].t);

    const cuerpo = $('#pv-texto-cuerpo');
    cuerpo.style.setProperty('--letra', `${s.letra}px`);
    cuerpo.dataset.toma = t ? t.id : 'espera';
    if (t) {
        const previa = anterior(t);
        const lo = Math.max(previa && previa.outI != null ? previa.outI - 6 : 0, t.inI - 14, 0);
        cuerpo.innerHTML = palabras(t, lo, s.rio.length - 1) + '<span class="pv-cursor"></span>' + comentarios(t);
    } else {
        const ultima = s.tomas[s.tomas.length - 1];
        const lo = Math.max(ultima ? ultima.outI + 1 : 0, s.rio.length - 120);
        let h = '';
        for (let i = lo; i < s.rio.length; i++) h += `<span class="pv-p es-suelta${buscada(i) ? ' es-buscada' : ''}" data-i="${i}">${esc(s.rio[i].w)}</span> `;
        cuerpo.innerHTML = h + borde('in', null) + '<span class="pv-cursor"></span>';
    }
    bajarSiEstabaAbajo(true);
}

function bajarSiEstabaAbajo(forzar) {
    const caja = $('#pv-texto');
    if (forzar || caja.scrollTop + caja.clientHeight >= caja.scrollHeight - 60) caja.scrollTop = caja.scrollHeight;
}

/** Una palabra más, sin rehacer el texto: así se puede seleccionar mientras se habla. */
function agregarPalabra(i) {
    const cuerpo = $('#pv-texto-cuerpo');
    const caja = $('#pv-texto');
    const abajo = caja.scrollTop + caja.clientHeight >= caja.scrollHeight - 60;
    const span = document.createElement('span');
    span.className = `pv-p${s.abierta ? '' : ' es-suelta'}`;
    span.dataset.i = i;
    span.textContent = s.rio[i].w;
    const antesDe = s.abierta ? cuerpo.querySelector('.pv-cursor') : cuerpo.querySelector('.pv-borde.es-in[data-toma="espera"]');
    cuerpo.insertBefore(span, antesDe);
    cuerpo.insertBefore(document.createTextNode(' '), antesDe);
    if (abajo) caja.scrollTop = caja.scrollHeight;
    const d = $('#pv-ahora-cabeza [data-dura]');
    if (d && s.abierta) d.textContent = dura(s.reloj - s.rio[Math.min(s.abierta.inI, s.rio.length - 1)].t);
}

function coincide(t) {
    if (!s.filtro) return true;
    const f = norm(s.filtro);
    return norm(textoDe(t.inI, finDe(t))).includes(f) || norm(t.nota).includes(f)
        || t.comentarios.some(c => norm(c.comentario).includes(f)) || String(t.id) === s.filtro.trim();
}

function frase(t) {
    const texto = textoDe(t.inI, Math.min(finDe(t), t.inI + 30));
    if (!s.filtro) return esc(texto);
    const f = s.filtro.trim();
    const re = new RegExp(`(${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig');
    const largo = textoDe(t.inI, finDe(t));
    const donde = largo.toLowerCase().indexOf(f.toLowerCase());
    const trozo = donde > 40 ? `…${largo.slice(donde - 30, donde + 120)}` : largo.slice(0, 160);
    return esc(trozo).replace(re, '<mark>$1</mark>');
}

function filaDe(t) {
    const abierta = s.desplegadas.has(t.id);
    const pastilla = t.desactivada ? '<span class="pastilla" data-estado="desactivada">desactivada</span>'
        : `<span class="pastilla" data-estado="${t.estado === 'lista' ? 'lista' : t.estado === 'abierta' ? 'abierta' : 'releyendo'}">${t.estado}</span>`;
    const clases = ['pv-fila', t === s.abierta ? 'es-abierta' : '', s.elegida === t.id ? 'es-elegida' : '', t.desactivada ? 'es-desactivada' : '', abierta ? 'es-desplegada' : ''].join(' ');
    const mini = `<span class="pv-mini">${VISTAS.map(v => `<button type="button" style="${estilo(v.nombre)}" data-vista="${v.nombre}" data-toma="${t.id}" aria-pressed="${t.vista === v.nombre}" title="${v.titulo} · tecla ${v.tecla}">${v.tecla}</button>`).join('')}</span>`;
    const fila = `<div class="${clases}" style="${estilo(t.vista)}" data-fila="${t.id}">
        <span class="pv-flecha">›</span><span class="pv-num">${String(t.id).padStart(2, '0')}</span>${mini}
        <span class="pv-tc">${tc(s.rio[Math.min(t.inI, s.rio.length - 1)].t)}</span>
        <span>${t.outI != null ? dura(s.rio[t.outI].t - s.rio[t.inI].t) : '…'}</span>
        <span class="pv-frase">${t.nota ? `<b>${esc(t.nota)}</b>` : ''}${frase(t)}</span>${pastilla}</div>`;
    if (!abierta) return fila;
    const lo = Math.max(0, t.inI - 12);
    const hi = Math.min(s.rio.length - 1, finDe(t) + 12);
    const ultimaCerrada = !s.abierta && t === s.tomas[s.tomas.length - 1];
    return fila + `
      <div class="pv-desplegada" style="${estilo(t.vista)}">
        <div class="pv-desplegada-arriba">
          <input type="text" placeholder="Nota de toda la toma — va en el marcador del XML" value="${esc(t.nota)}" data-nota="${t.id}">
          ${vistas(t.vista, t.id, true)}
        </div>
        <div class="pv-texto-cuerpo ${s.compacto ? 'pv-compacto' : ''}" data-toma="${t.id}" style="--letra:${s.letra}px">${palabras(t, lo, hi)}</div>
        ${comentarios(t)}
        <div class="pv-ayuda">Lo gris es lo que se dijo antes y después: arrastrá el IN o el OUT hasta otra palabra, o clic derecho sobre una. Seleccioná un pedazo para comentarlo.</div>
        <div class="pv-desplegada-abajo">
          <div class="pv-foto" data-hace="ver-foto" title="La foto de la cámara al cerrar la toma">📷 OUT · ${t.outI != null ? tc(s.rio[t.outI].t) : '—'}</div>
          ${ultimaCerrada ? '<button class="btn" type="button" data-hace="reabrir">Reabrir</button>' : ''}
          <span class="pv-desplegada-acciones">
            <button class="btn" type="button" data-hace="mantener" data-toma="${t.id}">Mantener</button>
            <button class="btn btn-tenue" type="button" data-hace="desactivar" data-toma="${t.id}">${t.desactivada ? 'Activar' : 'Desactivar'}</button>
            <button class="btn btn-tenue" type="button" data-hace="descartar" data-toma="${t.id}" title="La saca de la sesión. Se deshace con ⌘Z">Descartar</button>
          </span>
        </div>
      </div>`;
}

function pintarLista() {
    const lista = $('#pv-lista');
    const scroll = $('#pv-scroll');
    const arriba = scroll.scrollTop;
    const visibles = s.tomas.slice().reverse().filter(t => (s.verDesactivadas || !t.desactivada) && coincide(t));
    lista.innerHTML = visibles.map(filaDe).join('') || `<p class="v3" style="padding:12px">Ninguna toma dice «${esc(s.filtro)}».</p>`;
    scroll.scrollTop = arriba;
    const quedan = s.tomas.filter(t => !t.desactivada).length;
    $('#pv-cuantas').textContent = `${s.tomas.length} · ${quedan} van al XML`;
    $('#pv-encontradas').textContent = s.filtro ? `${visibles.length} toma${visibles.length === 1 ? '' : 's'}` : '';
}

function pintarCifras() {
    $('#pv-tc').textContent = tc(s.reloj);
    const cortada = s.tomas.filter(t => !t.desactivada).reduce((x, t) => x + ((t.outI != null ? s.rio[t.outI].t : s.reloj) - s.rio[Math.min(t.inI, s.rio.length - 1)].t), 0);
    $('#pv-cortada').textContent = tc(cortada);
    const est = $('#pv-estado');
    est.textContent = s.abierta ? 'toma abierta' : 'escuchando';
    est.classList.toggle('es-abierta', Boolean(s.abierta));
    $('#pv-cuantas-barra').textContent = s.tomas.length;
}

function pintarTodo() {
    pintarAtajos();
    pintarAhora();
    pintarLista();
    pintarCifras();
}

/* ── Explicación ───────────────────────────────────────────────────────── */

$('#pv-explica').innerHTML = `<button class="cerrar" type="button" data-hace="ocultar">✕</button>
  <b>C · Punto medio.</b> La pantalla de hoy, con el texto grande y la vista al alcance.
  <ul>
    <li><b>Texto:</b> arriba, grande (A− / A+), y se agrega palabra por palabra: se puede seleccionar mientras se habla, y si subís a releer no te baja.</li>
    <li><b>Enter:</b> el botón grande de la barra dice qué va a hacer («abre una toma» / «cierra la toma 61») y se ilumina al apretarlo; también en el encabezado del texto.</li>
    <li><b>Vista:</b> en la barra de atajos, que dice sobre qué toma cae: «la que viene», la abierta o la elegida con ↑↓ (P R S M X). En la lista, cada fila muestra la suya y al pasar el mouse aparecen las otras: se cambia sin desplegar.</li>
    <li><b>Antes y después:</b> al desplegar una toma, lo gris de los dos lados, con el IN y el OUT para arrastrar, y «fin de la toma 4» / «empieza la toma 6» donde termina la vecina. Compacto lo esconde.</li>
    <li><b>Clic derecho</b> sobre una palabra: poner el IN o el OUT ahí, dividir la toma, o abrir una toma ahí si no hay ninguna.</li>
    <li><b>Comentar:</b> seleccioná un pedazo, en vivo o en una toma desplegada: aparece la caja, Enter guarda. Queda subrayado y en la lista de comentarios, con corregir y borrar.</li>
    <li><b>⌘F</b> va a «Buscar», dentro de la lista: filtra por lo que se dijo, las notas y los comentarios, y resalta. Enter despliega la primera; Esc limpia.</li>
    <li><b>Sigue todo lo de hoy:</b> audio con ↻, idioma, cámara con ↻, el medidor, ⌘Z / ⇧⌘Z, Terminar, la nota, la foto del OUT, Mantener / Desactivar / Descartar, Reabrir la última, Desactivadas y Compacto.</li>
  </ul>`;

/* ── Gestos ────────────────────────────────────────────────────────────── */

const MENUS = {
    audio: ['DJI Mic Mini', 'OBSBOT Meet 2 Microphone', 'MacBook Pro Microphone', 'Audio del sistema (Zoom, Meet, lo que suene)', 'Audio de Zoom (solo la llamada)'],
    idioma: ['Auto', 'Español', 'Inglés', 'Portugués'],
    camara: ['Ninguna', 'OBSBOT Meet 2', 'FaceTime HD Camera', 'OBS Virtual Camera']
};
const elegidoEn = { audio: 'DJI Mic Mini', idioma: 'Auto', camara: 'OBSBOT Meet 2' };

function abrirMenu(boton, opciones, alElegir, x, y) {
    const m = $('#pv-menu');
    m.innerHTML = opciones.map((o, k) => `<button type="button" data-k="${k}" class="${o.marcada ? 'es-marcada' : ''}">${esc(o.dice)}</button>`).join('');
    m.hidden = false;
    const r = boton ? boton.getBoundingClientRect() : { left: x, bottom: y };
    m.style.left = `${Math.min(r.left, innerWidth - m.offsetWidth - 8)}px`;
    m.style.top = `${Math.min(r.bottom + 4, innerHeight - m.offsetHeight - 8)}px`;
    m.onclick = e => { const b = e.target.closest('[data-k]'); if (!b) return; m.hidden = true; alElegir(opciones[Number(b.dataset.k)]); };
}

function menuDeRotulo(cual, boton) {
    abrirMenu(boton, MENUS[cual].map(dice => ({ dice, marcada: dice === elegidoEn[cual] })), o => {
        elegidoEn[cual] = o.dice;
        const corto = cual === 'audio' ? `🎙 ${o.dice}` : cual === 'camara' ? `📷 ${o.dice}` : (o.dice === 'Auto' ? 'Auto · ES' : o.dice);
        document.querySelector(`[data-menu="${cual}"]`).textContent = corto.length > 24 ? `${corto.slice(0, 23)}…` : corto;
        avisar(cual === 'audio' ? `Audio: ${o.dice}. La clase sigue, en un WAV nuevo.` : `${cual === 'idioma' ? 'Idioma' : 'Cámara'}: ${o.dice}`);
    });
}

document.addEventListener('click', e => {
    const b = e.target.closest('button, [data-fila], [data-hace]');
    if (!b) return;
    if (!e.target.closest('#pv-menu')) $('#pv-menu').hidden = true;
    if (b.dataset.cuantas) {
        document.querySelectorAll('[data-cuantas]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
        sembrar(Number(b.dataset.cuantas));
        $('#pv-ahora-cabeza').dataset.clave = '';
        return pintarTodo();
    }
    if (b.dataset.dice) { s.guion.push(...b.dataset.dice.split(' ')); return; }
    if (b.id === 'pv-pausar') { s.pausado = !s.pausado; b.textContent = s.pausado ? '▶ Que siga hablando' : '⏸ Pausar al profesor'; return; }
    if (b.id === 'pv-ver-explica') { $('#pv-explica').hidden = !$('#pv-explica').hidden; return; }
    if (b.id === 'pv-compacto') { s.compacto = !s.compacto; b.setAttribute('aria-pressed', String(s.compacto)); return pintarLista(); }
    if (b.id === 'pv-desactivadas') { s.verDesactivadas = !s.verDesactivadas; b.setAttribute('aria-pressed', String(s.verDesactivadas)); return pintarLista(); }
    if (b.dataset.menu) return menuDeRotulo(b.dataset.menu, b);
    if (b.dataset.recargar) {
        avisar(b.dataset.recargar === 'audio' ? '5 entradas de audio.' : '4 cámaras.');
        return menuDeRotulo(b.dataset.recargar, b.previousElementSibling);
    }
    if (b.dataset.vista) { e.stopPropagation(); return ponerVista(b.dataset.vista, b.dataset.toma ? Number(b.dataset.toma) : null); }
    const hace = b.dataset.hace;
    const t = b.dataset.toma ? tomaDe(b.dataset.toma) : null;
    switch (hace) {
        case 'borde': return bordeDeToma();
        case 'mas': case 'menos':
            s.letra = Math.max(14, Math.min(30, s.letra + (hace === 'mas' ? 2 : -2)));
            document.querySelectorAll('.pv-texto-cuerpo').forEach(x => x.style.setProperty('--letra', `${s.letra}px`));
            return undefined;
        case 'ocultar': $('#pv-explica').hidden = true; return undefined;
        case 'buscar': $('#pv-buscar').focus(); return undefined;
        case 'deshacer': return deshacer();
        case 'rehacer': return avisar('Rehacer (⇧⌘Z)');
        case 'terminar': return avisar('Terminar: pregunta antes, como hoy.');
        case 'ver-foto': return avisar('Abre la foto del OUT en grande.');
        case 'reabrir': {
            const ultima = s.tomas[s.tomas.length - 1];
            ultima.outI = null; ultima.estado = 'abierta'; s.abierta = ultima;
            avisar(`Toma ${ultima.id} reabierta`);
            return pintarTodo();
        }
        case 'mantener': t.estado = 'lista'; avisar(`Toma ${t.id}: se mantiene.`); return pintarLista();
        case 'desactivar': t.desactivada = !t.desactivada; return pintarLista();
        case 'descartar':
            s.ultimaDescartada = { t, donde: s.tomas.indexOf(t) };
            s.tomas.splice(s.tomas.indexOf(t), 1);
            s.desplegadas.delete(t.id);
            avisar(`Toma ${t.id} descartada. ⌘Z la devuelve.`);
            return pintarTodo();
        case 'borrar-comentario': t.comentarios.splice(Number(b.dataset.k), 1); return pintarTodo();
        case 'corregir-comentario': {
            const c = t.comentarios[Number(b.dataset.k)];
            const nuevo = prompt('Comentario', c.comentario);
            if (nuevo != null) c.comentario = nuevo;
            return pintarTodo();
        }
        default: break;
    }
    if (b.dataset.fila && !e.target.closest('input')) {
        const id = Number(b.dataset.fila);
        s.elegida = id;
        if (s.desplegadas.has(id)) s.desplegadas.delete(id); else s.desplegadas.add(id);
        pintarAtajos();
        pintarLista();
    }
    return undefined;
});

function deshacer() {
    if (s.ultimaDescartada) {
        const { t, donde } = s.ultimaDescartada;
        s.tomas.splice(donde, 0, t);
        s.ultimaDescartada = null;
        avisar(`Deshecho: descartar la toma ${t.id}`);
        return pintarTodo();
    }
    return avisar('Deshacer (⌘Z): vuelve el último cambio.');
}

document.addEventListener('input', e => {
    if (e.target.id === 'pv-buscar') { s.filtro = e.target.value; pintarLista(); return; }
    if (e.target.dataset.nota) { const t = tomaDe(e.target.dataset.nota); if (t) t.nota = e.target.value; }
});

document.addEventListener('keydown', e => {
    const meta = e.metaKey || e.ctrlKey;
    if (meta && e.key.toLowerCase() === 'f') { e.preventDefault(); $('#pv-buscar').focus(); $('#pv-buscar').select(); return; }
    if (meta && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) avisar('Rehacer'); else deshacer(); return; }
    if (e.target.id === 'pv-buscar') {
        if (e.key === 'Enter') {
            e.preventDefault();
            const primera = s.tomas.slice().reverse().find(coincide);
            if (primera) { s.desplegadas.add(primera.id); s.elegida = primera.id; pintarLista(); document.querySelector(`[data-fila="${primera.id}"]`).scrollIntoView({ block: 'start' }); }
        }
        if (e.key === 'Escape') { e.target.value = ''; s.filtro = ''; e.target.blur(); pintarLista(); }
        return;
    }
    if (e.target.closest && e.target.closest('input')) { if (e.key === 'Escape') e.target.blur(); return; }
    if (meta || e.repeat) return;
    if (e.key === 'Enter' && !(e.target.closest && e.target.closest('button'))) { e.preventDefault(); return bordeDeToma(); }
    const v = VISTAS.find(x => x.tecla.toLowerCase() === e.key.toLowerCase());
    if (v) { e.preventDefault(); const t = laDeLasTeclas(); return ponerVista(v.nombre, t ? t.id : null); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const orden = s.tomas.slice().reverse().map(t => t.id);
        const i = orden.indexOf(s.elegida);
        const j = i === -1 ? 0 : Math.max(0, Math.min(orden.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)));
        s.elegida = orden[j];
        pintarAtajos(); pintarLista();
        const fila = document.querySelector(`[data-fila="${s.elegida}"]`);
        if (fila) fila.scrollIntoView({ block: 'nearest' });
        return undefined;
    }
    if (e.key === 'Escape') { s.elegida = null; $('#pv-menu').hidden = true; $('#pv-burbuja').hidden = true; pintarAtajos(); pintarLista(); }
    return undefined;
});

/* Arrastrar el IN y el OUT. */
let arrastre = null;
document.addEventListener('dragstart', e => {
    const b = e.target.closest && e.target.closest('.pv-borde');
    if (!b) return;
    arrastre = { borde: b.dataset.borde, toma: b.dataset.toma };
    e.dataTransfer.setData('text/plain', b.dataset.borde);
    e.dataTransfer.effectAllowed = 'move';
});
const destino = e => {
    const p = e.target.closest && e.target.closest('.pv-p');
    if (!p || !arrastre) return null;
    const caja = p.closest('.pv-texto-cuerpo');
    return caja && caja.dataset.toma === String(arrastre.toma) ? p : null;
};
document.addEventListener('dragover', e => {
    document.querySelectorAll('.es-destino').forEach(x => x.classList.remove('es-destino'));
    const p = destino(e);
    if (!p) return;
    e.preventDefault();
    p.classList.add('es-destino');
});
document.addEventListener('drop', e => {
    const p = destino(e);
    if (!p) return;
    e.preventDefault();
    const i = Number(p.dataset.i);
    if (arrastre.toma === 'espera') abrir(i, 'el IN puesto a mano');
    else ponerBorde(tomaDe(arrastre.toma), arrastre.borde, i);
    arrastre = null;
});
document.addEventListener('dragend', () => { arrastre = null; document.querySelectorAll('.es-destino').forEach(x => x.classList.remove('es-destino')); });

/* Clic derecho sobre una palabra. */
document.addEventListener('contextmenu', e => {
    const p = e.target.closest && e.target.closest('.pv-p');
    if (!p) return;
    const caja = p.closest('.pv-texto-cuerpo');
    if (!caja) return;
    e.preventDefault();
    const i = Number(p.dataset.i);
    const w = s.rio[i].w;
    if (caja.dataset.toma === 'espera') {
        return abrirMenu(null, [{ dice: `Abrir una toma en «${w}»`, hace: () => abrir(i, 'el clic derecho') }], o => o.hace(), e.clientX, e.clientY);
    }
    const t = tomaDe(caja.dataset.toma);
    const opciones = [
        { dice: `Poner el IN en «${w}»`, hace: () => ponerBorde(t, 'in', i) },
        { dice: `Poner el OUT en «${w}»`, hace: () => ponerBorde(t, 'out', i) }
    ];
    if (i > t.inI && i <= finDe(t)) opciones.push({ dice: `Dividir la toma en «${w}»`, hace: () => dividir(t, i) });
    return abrirMenu(null, opciones, o => o.hace(), e.clientX, e.clientY);
});

/* Seleccionar un pedazo para comentarlo. */
document.addEventListener('mouseup', e => {
    if (e.target.closest('#pv-burbuja')) return;
    setTimeout(() => {
        const sel = getSelection();
        const burbuja = $('#pv-burbuja');
        if (!sel || sel.isCollapsed) { burbuja.hidden = true; return; }
        const deNodo = n => (n && (n.nodeType === 3 ? n.parentElement : n)).closest('.pv-p');
        const a = deNodo(sel.anchorNode);
        const b = deNodo(sel.focusNode);
        if (!a || !b) return;
        const caja = a.closest('.pv-texto-cuerpo');
        if (!caja || caja !== b.closest('.pv-texto-cuerpo') || caja.dataset.toma === 'espera') return;
        const t = tomaDe(caja.dataset.toma);
        const desde = Math.min(Number(a.dataset.i), Number(b.dataset.i));
        const hasta = Math.max(Number(a.dataset.i), Number(b.dataset.i));
        const r = sel.getRangeAt(0).getBoundingClientRect();
        burbuja.innerHTML = `<input type="text" placeholder="Comentario sobre «${esc(textoDe(desde, hasta).slice(0, 40))}»"><button class="btn btn-primario" type="button">Comentar</button>`;
        burbuja.hidden = false;
        burbuja.style.left = `${Math.max(8, Math.min(r.left, innerWidth - 400))}px`;
        burbuja.style.top = `${Math.min(r.bottom + 6, innerHeight - 50)}px`;
        const campo = burbuja.querySelector('input');
        const guardar = () => {
            if (!campo.value.trim()) return;
            t.comentarios.push({ a: desde, b: hasta, comentario: campo.value.trim() });
            burbuja.hidden = true;
            getSelection().removeAllRanges();
            avisar(`Comentario en la toma ${t.id}`);
            pintarTodo();
        };
        campo.addEventListener('keydown', ev => { ev.stopPropagation(); if (ev.key === 'Enter') guardar(); if (ev.key === 'Escape') burbuja.hidden = true; });
        burbuja.querySelector('button').addEventListener('click', guardar);
        campo.focus();
    }, 0);
});

/* El medidor, que se mueve mientras el profesor habla. */
setInterval(() => { $('#pv-nivel').style.width = s.pausado ? '0%' : `${20 + Math.random() * 55}%`; }, 110);

sembrar(60);
pintarTodo();
setInterval(oir, 300);
