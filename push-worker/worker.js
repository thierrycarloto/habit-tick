// Habit Tick - servidor de lembretes (Cloudflare Worker + D1 + Cron)
// Envia Web Push SEM payload (n�o precisa de criptografia). O Service Worker,
// ao receber o push, consulta POST /due para saber qual lembrete mostrar.

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
};

const json = (obj, status = 200) =>
    new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...CORS } });

async function sha256Hex(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function b64uToBytes(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    return Uint8Array.from(atob(s), c => c.charCodeAt(0));
}

function bytesToB64u(bytes) {
    let bin = '';
    new Uint8Array(bytes).forEach(b => (bin += String.fromCharCode(b)));
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Hora local (HH:MM, data YYYY-MM-DD e dia da semana 0-6) em um fuso IANA
function localParts(tz, date = new Date()) {
    const fmt = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short'
    });
    const p = Object.fromEntries(fmt.formatToParts(date).map(x => [x.type, x.value]));
    const hour = p.hour === '24' ? '00' : p.hour;
    const days = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return { date: `${p.year}-${p.month}-${p.day}`, time: `${hour}:${p.minute}`, day: days[p.weekday] };
}

// ---- VAPID (JWT ES256) ----
let cachedKey = null;
async function getSigningKey(env) {
    if (cachedKey) return cachedKey;
    const pub = b64uToBytes(env.VAPID_PUBLIC); // 65 bytes: 0x04 | x | y
    const jwk = {
        kty: 'EC', crv: 'P-256',
        x: bytesToB64u(pub.slice(1, 33)),
        y: bytesToB64u(pub.slice(33, 65)),
        d: env.VAPID_PRIVATE,
        ext: true
    };
    cachedKey = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
    return cachedKey;
}

async function vapidHeader(env, endpoint) {
    const aud = new URL(endpoint).origin;
    const enc = o => bytesToB64u(new TextEncoder().encode(JSON.stringify(o)));
    const unsigned = `${enc({ typ: 'JWT', alg: 'ES256' })}.${enc({
        aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: env.VAPID_SUBJECT || 'mailto:admin@example.com'
    })}`;
    const sig = await crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' }, await getSigningKey(env), new TextEncoder().encode(unsigned)
    );
    return `vapid t=${unsigned}.${bytesToB64u(sig)}, k=${env.VAPID_PUBLIC}`;
}

async function sendPush(env, endpoint, body = null) {
    const headers = {
        Authorization: await vapidHeader(env, endpoint),
        TTL: '120',
        Urgency: 'high'
    };
    if (body) {
        headers['Content-Encoding'] = 'aes128gcm';
        headers['Content-Type'] = 'application/octet-stream';
    }
    return fetch(endpoint, { method: 'POST', headers, body });
}

// ---- Push com conteúdo (RFC 8291, aes128gcm) ----
// Cada aviso vai dentro do próprio push: o Service Worker não precisa consultar /due,
// então não há avisos misturados nem a notificação genérica "seus hábitos".
const te = new TextEncoder();

function concatBytes(...arrs) {
    const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0));
    let o = 0;
    for (const a of arrs) { out.set(a, o); o += a.length; }
    return out;
}

async function hkdf(salt, ikm, info, length) {
    const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
    return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}

async function encryptPayload(keys, text) {
    const uaPublic = b64uToBytes(keys.p256dh);
    const authSecret = b64uToBytes(keys.auth);
    const asKeys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', asKeys.publicKey));
    const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, asKeys.privateKey, 256));

    const ikm = await hkdf(authSecret, shared, concatBytes(te.encode('WebPush: info\0'), uaPublic, asPublic), 32);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const cek = await hkdf(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16);
    const nonce = await hkdf(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12);

    const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
    const plaintext = concatBytes(te.encode(text), new Uint8Array([2])); // 0x02 = último registro
    const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, plaintext));

    const header = new Uint8Array(21 + asPublic.length);
    header.set(salt, 0);
    new DataView(header.buffer).setUint32(16, 4096); // tamanho do registro
    header[20] = asPublic.length;
    header.set(asPublic, 21);
    return concatBytes(header, cipher);
}

function parseKeys(k) {
    if (!k) return null;
    try {
        const o = typeof k === 'string' ? JSON.parse(k) : k;
        return o && typeof o.p256dh === 'string' && typeof o.auth === 'string' ? { p256dh: o.p256dh, auth: o.auth } : null;
    } catch {
        return null;
    }
}

// ---- Rotas ----
async function handleRequest(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (request.method !== 'POST') return json({ ok: true, service: 'habit-tick-push' });

    const url = new URL(request.url);
    let body;
    try { body = await request.json(); } catch { return json({ error: 'json' }, 400); }
    if (!body.endpoint) return json({ error: 'endpoint' }, 400);
    const id = await sha256Hex(body.endpoint);

    if (url.pathname === '/sync') {
        const tz = body.tz || 'America/Sao_Paulo';
        const reminders = Array.isArray(body.reminders) ? body.reminders.slice(0, 100) : [];
        const done = body.done && typeof body.done === 'object' ? body.done : { date: '', ids: [] };
        const keys = parseKeys(body.keys);
        try {
            await env.DB.prepare(
                `INSERT INTO subs (id, endpoint, tz, reminders, done, updated_at, push_keys)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                 ON CONFLICT(id) DO UPDATE SET endpoint=?2, tz=?3, reminders=?4, done=?5, updated_at=?6, push_keys=?7`
            ).bind(id, body.endpoint, tz, JSON.stringify(reminders), JSON.stringify(done), Date.now(), keys ? JSON.stringify(keys) : '').run();
        } catch (e) {
            // Banco ainda sem a coluna push_keys (migração não aplicada): mantém o modo antigo
            await env.DB.prepare(
                `INSERT INTO subs (id, endpoint, tz, reminders, done, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                 ON CONFLICT(id) DO UPDATE SET endpoint=?2, tz=?3, reminders=?4, done=?5, updated_at=?6`
            ).bind(id, body.endpoint, tz, JSON.stringify(reminders), JSON.stringify(done), Date.now()).run();
        }
        return json({ ok: true });
    }

    if (url.pathname === '/due') {
        const row = await env.DB.prepare('SELECT due FROM subs WHERE id = ?1').bind(id).first();
        const all = row && row.due ? JSON.parse(row.due) : [];
        const due = freshDue(all, Date.now());
        if (all.length) await env.DB.prepare("UPDATE subs SET due = '[]' WHERE id = ?1").bind(id).run();
        return json({ due });
    }

    if (url.pathname === '/snooze') {
        const minutes = Math.max(1, Math.min(120, Number(body.minutes) || 10));
        const row = await env.DB.prepare('SELECT snoozes FROM subs WHERE id = ?1').bind(id).first();
        const snoozes = row && row.snoozes ? JSON.parse(row.snoozes) : [];
        snoozes.push({ habitId: body.habitId, at: Date.now() + minutes * 60000 });
        await env.DB.prepare('UPDATE subs SET snoozes = ?2 WHERE id = ?1').bind(id, JSON.stringify(snoozes.slice(-50))).run();
        return json({ ok: true });
    }

    // Foco em andamento: o servidor avisa quando o tempo acabar (mesmo com o app fechado)
    if (url.pathname === '/focus-start') {
        const minutes = Math.max(1, Math.min(180, Number(body.minutes) || 0));
        // Usa o fim calculado pelo app (início real do foco), se for coerente
        const nowMs = Date.now();
        const clientEnd = Number(body.endsAt) || 0;
        const endsAt = clientEnd > nowMs - 60000 && clientEnd <= nowMs + 181 * 60000 ? clientEnd : nowMs + minutes * 60000;
        const focus = {
            endsAt,
            minutes,
            name: String(body.name || '').slice(0, 80)
        };
        await env.DB.prepare('UPDATE subs SET focus = ?2 WHERE id = ?1').bind(id, JSON.stringify(focus)).run();
        return json({ ok: true });
    }

    if (url.pathname === '/focus-cancel') {
        await env.DB.prepare("UPDATE subs SET focus = '' WHERE id = ?1").bind(id).run();
        return json({ ok: true });
    }

    if (url.pathname === '/unsubscribe') {
        await env.DB.prepare('DELETE FROM subs WHERE id = ?1').bind(id).run();
        return json({ ok: true });
    }

    return json({ error: 'not found' }, 404);
}

// Lembretes pendentes só valem por alguns minutos; evita avisar hábito antigo fora de hora
// (ex.: push perdido) junto com o lembrete atual. Também remove duplicados.
const DUE_MAX_AGE_MS = 3 * 60000;
function freshDue(list, nowMs) {
    const seen = new Set();
    return list.filter(d => {
        if (d.at && nowMs - d.at > DUE_MAX_AGE_MS) return false;
        const key = d.kind ? `${d.kind}` : d.id;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

// ---- Cron: roda a cada minuto ----
async function runCron(env) {
    const { results } = await env.DB.prepare('SELECT * FROM subs').all();
    const nowMs = Date.now();

    for (const sub of results) {
        let reminders = [], done = { date: '', ids: [] }, snoozes = [], pending = [];
        try { reminders = JSON.parse(sub.reminders || '[]'); } catch {}
        try { done = JSON.parse(sub.done || '{}'); } catch {}
        try { snoozes = JSON.parse(sub.snoozes || '[]'); } catch {}
        try { pending = JSON.parse(sub.due || '[]'); } catch {}

        const lp = localParts(sub.tz);
        const doneToday = done.date === lp.date ? new Set(done.ids || []) : new Set();
        const byId = Object.fromEntries(reminders.map(r => [r.id, r]));
        const newDue = [];

        for (const r of reminders) {
            if (!r.days || !r.days.includes(lp.day)) continue;
            if (doneToday.has(r.id)) continue;
            if (r.time === lp.time) newDue.push({ id: r.id, name: r.name, at: nowMs });
        }

        const remainingSnoozes = [];
        for (const s of snoozes) {
            if (s.at <= nowMs) {
                const r = byId[s.habitId];
                if (r && !doneToday.has(r.id) && !newDue.some(d => d.id === r.id)) {
                    newDue.push({ id: r.id, name: r.name, at: nowMs });
                }
            } else {
                remainingSnoozes.push(s);
            }
        }

        // Foco terminou? (ignora se passou mais de 15 min do fim, ex.: servidor/app sem sincronia)
        let focus = null, focusChanged = false;
        try { focus = sub.focus ? JSON.parse(sub.focus) : null; } catch {}
        if (focus && focus.endsAt <= nowMs) {
            if (nowMs - focus.endsAt <= 15 * 60000) {
                newDue.push({ kind: 'focus', minutes: focus.minutes, name: focus.name, at: nowMs });
            }
            focus = null;
            focusChanged = true;
        }

        if (!newDue.length) {
            if (remainingSnoozes.length !== snoozes.length) {
                await env.DB.prepare('UPDATE subs SET snoozes = ?2 WHERE id = ?1').bind(sub.id, JSON.stringify(remainingSnoozes)).run();
            }
            if (focusChanged) {
                await env.DB.prepare("UPDATE subs SET focus = '' WHERE id = ?1").bind(sub.id).run();
            }
            continue;
        }

        const focusStr = focus ? JSON.stringify(focus) : '';
        const keys = parseKeys(sub.push_keys);

        // 1) Push com conteúdo: só os avisos deste minuto, nada acumulado de antes
        if (keys) {
            await env.DB.prepare("UPDATE subs SET due = '[]', snoozes = ?2, focus = ?3 WHERE id = ?1")
                .bind(sub.id, JSON.stringify(remainingSnoozes), focusStr).run();
            try {
                const payload = await encryptPayload(keys, JSON.stringify({ due: newDue }));
                const res = await sendPush(env, sub.endpoint, payload);
                if (res.status === 404 || res.status === 410) {
                    await env.DB.prepare('DELETE FROM subs WHERE id = ?1').bind(sub.id).run();
                    continue;
                }
                if (res.ok) continue;
                console.log('push com conteúdo recusado', res.status);
            } catch (e) {
                console.log('push com conteúdo falhou', e && e.message);
            }
            pending = []; // cai no modo antigo só com os avisos deste minuto
        }

        // 2) Modo antigo (app ainda sem chaves): push vazio + SW consulta /due
        const due = freshDue([...pending, ...newDue], nowMs);
        await env.DB.prepare('UPDATE subs SET due = ?2, snoozes = ?3, focus = ?4 WHERE id = ?1')
            .bind(sub.id, JSON.stringify(due), JSON.stringify(remainingSnoozes), focusStr).run();

        try {
            const res = await sendPush(env, sub.endpoint);
            if (res.status === 404 || res.status === 410) {
                await env.DB.prepare('DELETE FROM subs WHERE id = ?1').bind(sub.id).run();
            }
        } catch (e) {
            console.log('push error', e && e.message);
        }
    }
}

export default {
    fetch: (request, env) => handleRequest(request, env).catch(e => json({ error: String(e && e.message) }, 500)),
    scheduled: (event, env, ctx) => ctx.waitUntil(runCron(env))
};
