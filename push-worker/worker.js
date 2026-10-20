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

async function sendPush(env, endpoint) {
    return fetch(endpoint, {
        method: 'POST',
        headers: {
            Authorization: await vapidHeader(env, endpoint),
            TTL: '120',
            Urgency: 'high'
        }
    });
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
        await env.DB.prepare(
            `INSERT INTO subs (id, endpoint, tz, reminders, done, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(id) DO UPDATE SET endpoint=?2, tz=?3, reminders=?4, done=?5, updated_at=?6`
        ).bind(id, body.endpoint, tz, JSON.stringify(reminders), JSON.stringify(done), Date.now()).run();
        return json({ ok: true });
    }

    if (url.pathname === '/due') {
        const row = await env.DB.prepare('SELECT due FROM subs WHERE id = ?1').bind(id).first();
        const due = row && row.due ? JSON.parse(row.due) : [];
        if (due.length) await env.DB.prepare("UPDATE subs SET due = '[]' WHERE id = ?1").bind(id).run();
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

    if (url.pathname === '/unsubscribe') {
        await env.DB.prepare('DELETE FROM subs WHERE id = ?1').bind(id).run();
        return json({ ok: true });
    }

    return json({ error: 'not found' }, 404);
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
            if (r.time === lp.time) newDue.push({ id: r.id, name: r.name });
        }

        const remainingSnoozes = [];
        for (const s of snoozes) {
            if (s.at <= nowMs) {
                const r = byId[s.habitId];
                if (r && !doneToday.has(r.id) && !newDue.some(d => d.id === r.id)) {
                    newDue.push({ id: r.id, name: r.name });
                }
            } else {
                remainingSnoozes.push(s);
            }
        }

        if (!newDue.length) {
            if (remainingSnoozes.length !== snoozes.length) {
                await env.DB.prepare('UPDATE subs SET snoozes = ?2 WHERE id = ?1').bind(sub.id, JSON.stringify(remainingSnoozes)).run();
            }
            continue;
        }

        const due = [...pending, ...newDue];
        await env.DB.prepare('UPDATE subs SET due = ?2, snoozes = ?3 WHERE id = ?1')
            .bind(sub.id, JSON.stringify(due), JSON.stringify(remainingSnoozes)).run();

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
