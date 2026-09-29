/**
 * formato.js — Números a texto, y en un solo sitio.
 *
 * Está aparte porque el timecode se dibuja en cuatro pantallas y tiene que dar
 * EXACTAMENTE el mismo número que el XML: si la barra de la sesión redondeara
 * distinto que `notas-xml.aCuadros`, el editor leería un cuadro y el marcador
 * caería en otro, y esa diferencia es imposible de encontrar mirando.
 */

/**
 * Los cuadros por segundo con los que se cuenta, que no son siempre el número
 * que el editor eligió.
 *
 * En los tres NTSC el timecode cuenta sobre la base entera —30 cuadros por
 * segundo de timecode a 29.97 reales— y compensa saltando números, que es lo
 * que se llama drop-frame. Es la misma base que `fcp-xml.rateFor` escribe en
 * el `<timebase>` del XML, así que los dos lados cuentan igual.
 */
function base(fps) {
    const n = Number(fps) || 30;
    if (Math.abs(n - 23.976) < 0.01) return { base: 24, drop: false };
    if (Math.abs(n - 29.97) < 0.01) return { base: 30, drop: true };
    if (Math.abs(n - 59.94) < 0.01) return { base: 60, drop: true };
    return { base: Math.round(n), drop: false };
}

/** Segundos → cuadros, con la fracción exacta del formato (igual que el XML). */
export function aCuadros(segundos, fps) {
    const n = Number(fps) || 30;
    const b = base(n);
    // En NTSC hay 1001 cuadros reales cada 1000 nominales: `toFrames` del motor
    // hace esta misma cuenta, y las dos tienen que dar lo mismo.
    const num = b.drop || Math.abs(n - 23.976) < 0.01 ? b.base * 1000 : b.base;
    const den = b.drop || Math.abs(n - 23.976) < 0.01 ? 1001 : 1;
    return Math.round((Number(segundos) || 0) * num / den);
}

/**
 * Cuadros → `HH:MM:SS:FF`, con drop-frame donde corresponde.
 *
 * El drop-frame no tira cuadros: salta NÚMEROS. Cada minuto que no es múltiplo
 * de diez se saltea la numeración 00 y 01, que es lo que mantiene el timecode
 * pegado al reloj de pared en NTSC. Sin esto, una clase de tres horas a 29.97
 * termina con casi once segundos de diferencia entre lo que dice la app y lo
 * que dice Premiere — y el editor sincroniza mirando ese número.
 */
export function timecode(segundos, fps) {
    const b = base(fps);
    let f = aCuadros(segundos, fps);
    let sep = ':';

    if (b.drop) {
        sep = ';';
        const porMinuto = b.base * 60;
        const saltados = b.base / 15;            // 2 a 30, 4 a 60
        const porDiezMin = porMinuto * 10 - saltados * 9;
        const diezMin = Math.floor(f / porDiezMin);
        const resto = f % porDiezMin;
        f += saltados * 9 * diezMin;
        if (resto >= saltados) f += saltados * Math.floor((resto - saltados) / (porMinuto - saltados));
    }

    const p = n => String(n).padStart(2, '0');
    const cuadro = f % b.base;
    const total = Math.floor(f / b.base);
    return `${p(Math.floor(total / 3600))}:${p(Math.floor(total / 60) % 60)}:${p(total % 60)}${sep}${p(cuadro)}`;
}

/** Hora del día → timecode de la sesión, contra su cero. */
export function timecodeDe(paredMs, ceroMs, fps) {
    return timecode(Math.max(0, (Number(paredMs) - Number(ceroMs)) / 1000), fps);
}

/** Una duración en segundos, dicha como la diría una persona. */
export function duracion(segundos) {
    const s = Math.max(0, Math.round(Number(segundos) || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor(s / 60) % 60;
    if (h) return `${h} h ${String(m).padStart(2, '0')} min`;
    if (m) return `${m} min ${String(s % 60).padStart(2, '0')} s`;
    return `${s} s`;
}

/** La hora del día, para emparejar con la fecha de un archivo de cámara. */
export function horaDelDia(ms) {
    const d = new Date(Number(ms));
    const p = n => String(n).padStart(2, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** Cuándo fue una sesión, dicho corto. */
export function cuando(ms) {
    if (!ms) return '';
    const d = new Date(Number(ms));
    const hoy = new Date();
    const mismoDia = d.toDateString() === hoy.toDateString();
    const p = n => String(n).padStart(2, '0');
    const hora = `${p(d.getHours())}:${p(d.getMinutes())}`;
    if (mismoDia) return `hoy ${hora}`;
    return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${hora}`;
}
