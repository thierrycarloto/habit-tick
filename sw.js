const CACHE_NAME = 'habit-tick-v26';
const ASSETS = [
    './',
    './index.html',
    './style.css',
    './app.js',
    './manifest.json',
    './icon-192.png',
    './icon-512.png',
    './novo_icone.png'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(ASSETS))
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys => {
            return Promise.all(keys.map(key => {
                if (key !== CACHE_NAME && key.startsWith('habit-tick-')) {
                    return caches.delete(key);
                }
            }));
        })
    );
    return self.clients.claim();
});

self.addEventListener('fetch', event => {
    if (event.request.url.endsWith('favicon.ico')) {
        event.respondWith(
            caches.match('./icon-192.png').then(response => {
                return response || fetch('./icon-192.png');
            })
        );
        return;
    }
    event.respondWith(
        caches.match(event.request)
            .then(response => {
                return response || fetch(event.request);
            })
    );
});

self.addEventListener('message', event => {
    if (event.data === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

// === Web Push: lembretes com o app fechado ===
async function getPushServer() {
    try {
        const cache = await caches.open('ht-config');
        const res = await cache.match('/__push_server');
        return res ? (await res.text()) : null;
    } catch (e) {
        return null;
    }
}

self.addEventListener('push', event => {
    event.waitUntil((async () => {
        // 1) Push com conteúdo (servidor novo): os avisos vêm dentro do próprio push
        let due = null;
        if (event.data) {
            try {
                const payload = event.data.json();
                if (payload && Array.isArray(payload.due)) due = payload.due;
            } catch (e) {}
        }

        // 2) Push vazio (modo antigo): consulta o servidor
        if (due === null) {
            due = [];
            try {
                const server = await getPushServer();
                const sub = await self.registration.pushManager.getSubscription();
                if (server && sub) {
                    const res = await fetch(`${server}/due`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ endpoint: sub.endpoint })
                    });
                    due = (await res.json()).due || [];
                }
            } catch (e) {}
        }

        const focusDone = due.filter(d => d.kind === 'focus');
        due = due.filter((d, i, arr) => d.kind !== 'focus' && d.id && arr.findIndex(x => x.id === d.id) === i);

        await Promise.all(focusDone.map(f => self.registration.showNotification('Foco conclu\u00eddo! \ud83c\udfaf', {
            body: 'Parab\u00e9ns! Voc\u00ea ficou ' + f.minutes + ' min em foco' + (f.name ? ' em "' + f.name + '"' : '') + '! \ud83c\udf89 Abra o app para registrar.',
            icon: './icon-192.png',
            badge: './icon-192.png',
            vibrate: [200, 100, 200],
            tag: 'focus-completed',
            renotify: true
        })));

        if (!due.length) {
            if (focusDone.length) return;
            // O navegador exige uma notificação visível a cada push. Se já houver alguma
            // do app na tela, não cria o aviso genérico (era o lembrete "sem sentido").
            const open = await self.registration.getNotifications();
            if (open.length) return;
            await self.registration.showNotification('Habit Tick', {
                body: 'Toque para ver seus h\u00e1bitos de hoje.',
                icon: './icon-192.png',
                badge: './icon-192.png',
                tag: 'reminder-geral'
            });
            return;
        }

        await Promise.all(due.map(d => self.registration.showNotification(`Lembrete: ${d.name}`, {
            body: `Hora de cumprir sua meta: ${d.name}!`,
            icon: './icon-192.png',
            badge: './icon-192.png',
            vibrate: [200, 100, 200],
            requireInteraction: true,
            tag: `reminder-${d.id}`,
            renotify: true,
            data: { habitId: d.id },
            actions: [
                { action: 'done', title: '\u2713 Marcar Conclu\u00eddo' },
                { action: 'snooze', title: '\u23f1 Adiar 10 min' }
            ]
        })));
    })());
});

self.addEventListener('notificationclick', event => {
    event.notification.close();
    const habitId = event.notification.data ? event.notification.data.habitId : null;
    const action = event.action;

    if (action === 'snooze' && habitId) {
        event.waitUntil((async () => {
            const server = await getPushServer();
            const sub = await self.registration.pushManager.getSubscription();
            if (!server || !sub) return;
            try {
                await fetch(`${server}/snooze`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ endpoint: sub.endpoint, habitId, minutes: 10 })
                });
            } catch (e) {}
        })());
        return;
    }

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
            for (const client of clientList) {
                if (client.url && 'focus' in client) {
                    client.focus();
                    if (habitId) {
                        client.postMessage({
                            type: 'NOTIFICATION_ACTION',
                            action: action,
                            habitId: habitId
                        });
                    }
                    return;
                }
            }
            let targetUrl = './';
            if (habitId) {
                targetUrl = `./?alarmHabitId=${encodeURIComponent(habitId)}&action=${encodeURIComponent(action || '')}`;
            }
            if (clients.openWindow) {
                return clients.openWindow(targetUrl);
            }
        })
    );
});
