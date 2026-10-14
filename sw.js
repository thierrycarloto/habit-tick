const CACHE_NAME = 'habit-tick-v10';
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
                if (key !== CACHE_NAME) {
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

self.addEventListener('notificationclick', event => {
    event.notification.close();
    const habitId = event.notification.data ? event.notification.data.habitId : null;
    const action = event.action;

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
