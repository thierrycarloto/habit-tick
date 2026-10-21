// === Estado da Aplicação ===
const today = new Date();

// Helper para formatar data YYYY-MM-DD
function formatDate(date) {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

const todayStr = formatDate(today);

let state = {
    habits: []
};

let focusChartPeriod = {}; // maps habitId -> 'dia' | 'semana' | 'mes' | 'ano'

// Carregar estado inicial
function loadState() {
    const saved = localStorage.getItem('habitTickStateV2');
    if (saved) {
        state = JSON.parse(saved);
        if (!Array.isArray(state.generalFocus)) state.generalFocus = [];
    } else {
        // Mock data inicial se estiver vazio
        state.habits = [
            {
                id: '1',
                name: 'Estudo',
                icon: 'fa-book-open',
                color: '#fca5a5',
                type: 'tempo',
                activeDays: [1, 2, 3, 4, 5], // Seg a Sex
                records: {},
                sessions: [],
                totalFocusTime: 0
            },
            {
                id: '2',
                name: 'Remédio',
                icon: 'fa-heart',
                color: '#fb7185',
                type: 'sim_nao',
                activeDays: [0, 1, 2, 3, 4, 5, 6], // Todos os dias
                records: {}
            }
        ];
        saveState();
    }

    // Migração de compatibilidade para hábitos de foco existentes
    state.habits.forEach(habit => {
        if (habit.type === 'tempo') {
            if (!Array.isArray(habit.sessions)) {
                habit.sessions = [];
                // Se já tinha registros e totalFocusTime, preservar em sessões
                const recDates = Object.keys(habit.records || {}).filter(d => habit.records[d]);
                if (recDates.length > 0 && habit.totalFocusTime > 0) {
                    const perDay = Math.max(1, Math.round(habit.totalFocusTime / recDates.length));
                    recDates.forEach(dStr => {
                        habit.sessions.push({
                            id: 'mig_' + dStr,
                            date: dStr,
                            minutes: perDay,
                            seconds: perDay * 60,
                            timestamp: new Date(dStr + 'T12:00:00').getTime()
                        });
                    });
                }
            }
        }
    });
}

function saveState() {
    localStorage.setItem('habitTickStateV2', JSON.stringify(state));
    schedulePushSync();
}

// === Lembretes com o app fechado (Web Push) ===
// Preencha após publicar o servidor em /push-worker (veja o README de lá)
const PUSH_SERVER_URL = 'https://habit-tick-push.thierrycarloto.workers.dev';   // ex.: 'https://habit-tick-push.SEUUSUARIO.workers.dev'
const VAPID_PUBLIC_KEY = 'BNfZ-kjmwI7sZdeX_YcA83GhKFGlsjq3ec4BEo8F_DU1L6T4hRNQsAtY07nAmgzyc2Bv-bYJyackuYi4aWTXPDk'; // chave pública gerada com: npx web-push generate-vapid-keys

let pushSyncTimer = null;
function schedulePushSync() {
    clearTimeout(pushSyncTimer);
    pushSyncTimer = setTimeout(syncPushSchedule, 800);
}

function urlBase64ToUint8Array(b64) {
    const padding = '='.repeat((4 - (b64.length % 4)) % 4);
    const raw = atob((b64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(raw, c => c.charCodeAt(0));
}

async function syncPushSchedule() {
    if (!PUSH_SERVER_URL || !VAPID_PUBLIC_KEY) return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    try {
        const reg = await navigator.serviceWorker.ready;
        let sub = await reg.pushManager.getSubscription();
        if (!sub) {
            sub = await reg.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
            });
        }
        // Guarda a URL do servidor para o Service Worker (cache não apagado nas atualizações)
        const cfg = await caches.open('ht-config');
        await cfg.put('/__push_server', new Response(PUSH_SERVER_URL));

        const nowD = new Date();
        const ds = formatDate(nowD);
        const reminders = state.habits
            .filter(h => h.reminderEnabled && h.reminderTime)
            .map(h => ({ id: h.id, name: h.name, time: h.reminderTime, days: h.activeDays }));
        const doneIds = state.habits.filter(h => h.records && h.records[ds]).map(h => h.id);

        await fetch(`${PUSH_SERVER_URL}/sync`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                endpoint: sub.endpoint,
                tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
                reminders,
                done: { date: ds, ids: doneIds }
            })
        });
    } catch (e) {
        console.warn('Falha ao sincronizar lembretes push:', e);
    }
}

// Avisa o servidor do foco em andamento para ele enviar o "Parabéns" mesmo com o app fechado
async function pushFocusCall(path, extra = {}) {
    if (!PUSH_SERVER_URL || !VAPID_PUBLIC_KEY) return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (!sub) return;
        await fetch(`${PUSH_SERVER_URL}${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint: sub.endpoint, ...extra })
        });
    } catch (e) {
        console.warn('Falha ao avisar servidor sobre o foco:', e);
    }
}

function pushFocusStart(minutes) {
    const habit = window.currentFocusHabitId
        ? state.habits.find(h => h.id === window.currentFocusHabitId)
        : null;
    pushFocusCall('/focus-start', { minutes, name: habit ? habit.name : '' });
}

function pushFocusCancel() {
    pushFocusCall('/focus-cancel');
}

// === Tema Light/Dark ===
const themeCheckbox = document.getElementById('theme-toggle-checkbox');
if (themeCheckbox) {
    themeCheckbox.addEventListener('change', (e) => {
        if (e.target.checked) {
            document.body.classList.add('light-mode');
        } else {
            document.body.classList.remove('light-mode');
        }
        localStorage.setItem('habitTickTheme', e.target.checked ? 'light' : 'dark');
    });
}
if (localStorage.getItem('habitTickTheme') === 'light') {
    document.body.classList.add('light-mode');
    if (themeCheckbox) themeCheckbox.checked = true;
}

// === Gerenciamento de Abas e Transição Suave (Estilo Samsung / ViewPager) ===
let currentTabIndex = 0;
const tabTrack = document.getElementById('tab-track');
const tabViewport = document.getElementById('tab-viewport');
const tabIndicator = document.getElementById('tab-indicator');
const tabBtns = Array.from(document.querySelectorAll('.tab-btn'));
const tabPages = Array.from(document.querySelectorAll('.tab-page'));
const TAB_GAP = 32;

function updateTabIndicator(progress) {
    if (!tabIndicator || tabBtns.length === 0) return;
    const tabWidth = tabBtns[0].offsetWidth;
    const indicatorWidth = tabWidth * 0.6;
    const indicatorOffset = tabWidth * 0.2;
    const x = (progress * tabWidth) + indicatorOffset;
    tabIndicator.style.width = `${indicatorWidth}px`;
    tabIndicator.style.transform = `translateX(${x}px)`;
}

function updateViewportHeight(animate = false) {
    if (!tabViewport || tabPages.length === 0) return;
    if (currentTabIndex === 2) {
        tabViewport.style.height = '';
        return;
    }
    const activePage = tabPages[currentTabIndex];
    if (activePage) {
        const contentH = activePage.offsetHeight || activePage.scrollHeight;
        // Limita a altura estritamente ao conteúdo + 24px de respiro (sem rolagem desnecessária no vazio)
        const targetH = Math.max(160, contentH + 24);
        tabViewport.style.transition = animate ? 'height 0.28s cubic-bezier(0.25, 1, 0.5, 1)' : 'none';
        tabViewport.style.height = `${targetH}px`;
    }
}

function switchTab(index, animate = true) {
    if (index < 0) index = 0;
    if (index >= tabBtns.length) index = tabBtns.length - 1;
    currentTabIndex = index;

    if (currentTabIndex === 2) {
        document.body.classList.add('focus-mode-active');
    } else {
        document.body.classList.remove('focus-mode-active');
    }

    if (tabTrack) {
        if (animate) {
            tabTrack.style.transition = 'transform 0.32s cubic-bezier(0.25, 1, 0.5, 1)';
        } else {
            tabTrack.style.transition = 'none';
        }
        tabTrack.style.transform = `translateX(calc(-${index} * (100% + ${TAB_GAP}px)))`;
    }

    if (tabIndicator) {
        if (animate) {
            tabIndicator.style.transition = 'transform 0.32s cubic-bezier(0.25, 1, 0.5, 1), width 0.32s ease';
        } else {
            tabIndicator.style.transition = 'none';
        }
        updateTabIndicator(index);
    }

    tabBtns.forEach((btn, i) => {
        btn.classList.toggle('active', i === index);
    });

    tabPages.forEach((page, i) => {
        page.classList.toggle('active', i === index);
    });

    const fabBtn = document.getElementById('add-habit-btn');
    if (fabBtn) {
        fabBtn.style.display = index === 2 ? 'none' : 'flex';
    }

    renderViews();
    updateViewportHeight(animate);
}

tabBtns.forEach((btn, index) => {
    btn.addEventListener('click', () => {
        switchTab(index, true);
    });
});

window.addEventListener('resize', () => {
    updateTabIndicator(currentTabIndex);
    updateViewportHeight(false);
});

// === Renderização ===
const weekDays = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
const weekDayMap = [1, 2, 3, 4, 5, 6, 0]; // JS Date.getDay(): 0 is Sunday, so map to match labels: M=1, Tu=2, ..., Su=0

// === Congelar Dia (segunda chance para hábitos Sim/Não) ===
const FREEZE_MIN_STREAK = 7;   // sequência real mínima antes do dia esquecido
const FREEZE_MAX_DAYS_BACK = 3; // até quantos dias atrás é possível congelar

// Quantos dias ativos CONCLUÍDOS consecutivos existem imediatamente antes de uma data.
// Um dia congelado anterior interrompe a contagem (é preciso conquistar uma nova sequência).
function realStreakBefore(habit, date) {
    let count = 0;
    for (let i = 1; i < 365; i++) {
        const d = new Date(date);
        d.setDate(date.getDate() - i);
        if (!habit.activeDays.includes(d.getDay())) continue;
        const ds = formatDate(d);
        if (habit.records[ds]) {
            count++;
        } else {
            break; // faltou ou foi congelado
        }
    }
    return count;
}

function canFreezeDay(habit, dateStr) {
    if (!habit || habit.type === 'tempo') return false;
    if (dateStr >= formatDate(new Date())) return false;
    const d = new Date(dateStr + 'T12:00:00');
    const nowD = new Date();
    nowD.setHours(12, 0, 0, 0);
    const diffDays = Math.round((nowD - d) / 86400000);
    if (diffDays < 1 || diffDays > FREEZE_MAX_DAYS_BACK) return false;
    if (!habit.activeDays.includes(d.getDay())) return false;
    if (habit.records[dateStr]) return false;
    if (habit.frozen && habit.frozen[dateStr]) return false;
    // Todos os dias ativos entre o dia esquecido e hoje precisam estar cobertos
    // (concluídos ou congelados) para não esconder uma quebra de sequência real
    for (let i = 1; i < diffDays; i++) {
        const m = new Date(d);
        m.setDate(d.getDate() + i);
        if (!habit.activeDays.includes(m.getDay())) continue;
        const ms = formatDate(m);
        if (!habit.records[ms] && !(habit.frozen && habit.frozen[ms])) return false;
    }
    return realStreakBefore(habit, d) >= FREEZE_MIN_STREAK;
}

function freezeDay(habitId, dateStr) {
    const habit = state.habits.find(h => h.id === habitId);
    if (!canFreezeDay(habit, dateStr)) return;
    const [, m, d] = dateStr.split('-');
    customConfirm(`Congelar o dia ${d}/${m}? Sua sequência será mantida, mas você precisará de ${FREEZE_MIN_STREAK} dias seguidos para usar outro congelamento.`, (ok) => {
        if (!ok) return;
        if (!habit.frozen) habit.frozen = {};
        habit.frozen[dateStr] = true;
        saveState();
        renderViews();
        triggerHaptic(true);
        showAppToast('Dia congelado! Sequência preservada ❄️', 'fa-snowflake');
    });
}

function calculateStreak(habit) {
    let streak = 0;
    // Checar até 365 dias para trás
    for (let i = 0; i < 365; i++) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        const jsDay = d.getDay();
        const dateStr = formatDate(d);

        const isActiveDay = habit.activeDays.includes(jsDay);
        const isCompleted = habit.records[dateStr];
        const isFrozen = Boolean(habit.frozen && habit.frozen[dateStr]);

        if (isActiveDay) {
            if (i === 0) { // Hoje
                if (isCompleted) {
                    streak++;
                }
                // Se hoje não completou ainda, a sequência não zera, apenas não soma
            } else {
                if (isCompleted) {
                    streak++;
                } else if (isFrozen) {
                    continue; // Dia congelado: mantém a sequência sem somar
                } else {
                    break; // Faltou um dia ativo passado, quebrou a sequência
                }
            }
        }
    }
    return streak;
}

function renderViews() {
    renderWeeklyView();
    renderMonthlyView();
    updateViewportHeight(false);
}

function renderWeeklyView() {
    const container = document.getElementById('weekly-habit-list');
    container.innerHTML = '';

    // Calcular dias da semana atual
    const currentDayOfWeek = today.getDay(); // 0-6 (Sun-Sat)
    // Ajustar para que a semana comece na Segunda (1)
    const distFromMonday = currentDayOfWeek === 0 ? 6 : currentDayOfWeek - 1;

    const weekDates = [];
    for (let i = 0; i < 7; i++) {
        const d = new Date(today);
        d.setDate(today.getDate() - distFromMonday + i);
        weekDates.push(d);
    }

    state.habits.forEach(habit => {
        const card = document.createElement('div');
        card.className = 'habit-card';
        card.setAttribute('data-id', habit.id);
        card.style.setProperty('--habit-color', habit.color);

        let streak = 0;
        let doneThisWeek = 0;
        let activeThisWeek = 0;

        // Gerar HTML da semana
        let weekHtml = '';
        weekDates.forEach((d, index) => {
            const dateStr = formatDate(d);
            const isToday = dateStr === todayStr;
            const jsDay = d.getDay();
            const isActiveDay = habit.activeDays.includes(jsDay);
            const isCompleted = habit.records[dateStr];

            if (isActiveDay) activeThisWeek++;
            if (isActiveDay && isCompleted) doneThisWeek++;

            let boxClasses = 'day-box';
            let innerHtml = '';

            // Regra 1: botão não disponível (desabilitado visualmente)
            let disabledAttr = '';

            if (!isActiveDay) {
                boxClasses += ' disabled blocked';
                disabledAttr = 'disabled';
                innerHtml = '<div class="blocked-line"></div>';
            } else {
                const isFrozen = Boolean(habit.frozen && habit.frozen[dateStr]);
                if (isCompleted) {
                    boxClasses += ' completed';
                    innerHtml = '<i class="fa-solid fa-check"></i>';
                } else if (isFrozen) {
                    boxClasses += ' frozen';
                    innerHtml = '<i class="fa-solid fa-snowflake"></i>';
                } else if (!isToday && canFreezeDay(habit, dateStr)) {
                    boxClasses += ' freezable';
                    innerHtml = '<i class="fa-regular fa-snowflake"></i>';
                }
                // Só o hoje é clicável para marcar/desmarcar (e dias esquecidos congeláveis)
                if (!isToday && !boxClasses.includes('freezable')) {
                    boxClasses += ' disabled';
                    disabledAttr = 'disabled';
                }
            }

            weekHtml += `
                <div class="day ${isToday ? 'active-today' : ''}">
                    <span class="day-label">${weekDays[index]}</span>
                    <button class="${boxClasses}" ${disabledAttr} data-id="${habit.id}" data-date="${dateStr}">
                        ${innerHtml}
                    </button>
                </div>
            `;
        });

        let streakHtml = '';
        if (habit.type === 'tempo') {
            const todaySessions = (habit.sessions || []).filter(s => s.date === todayStr);
            const todayMinutes = todaySessions.reduce((acc, s) => acc + s.minutes, 0);
            const weekSessions = (habit.sessions || []).filter(s => weekDates.some(d => formatDate(d) === s.date));
            const weekMinutes = weekSessions.reduce((acc, s) => acc + s.minutes, 0);
            const todayBadge = todayMinutes > 0 ? `<b style="color:var(--accent-green);"><i class="fa-solid fa-clock"></i> Hoje: ${todayMinutes} min (${todaySessions.length}x)</b> &bull; ` : '';
            streakHtml = `${todayBadge}${weekMinutes} min na semana &bull; Total: ${habit.totalFocusTime || 0} min`;
        } else {
            const streakCount = calculateStreak(habit);
            const fireIcon = streakCount >= 2 ? '<i class="fa-solid fa-fire" style="color: #f97316;"></i> ' : '';
            streakHtml = `${fireIcon}Sequência: ${streakCount} &bull; ${doneThisWeek} na semana`;
        }

        card.innerHTML = `
            <div class="habit-header">
                <div class="drag-handle" data-id="${habit.id}" title="Segure e arraste para reordenar" aria-label="Reordenar hábito">
                    <i class="fa-solid fa-grip-vertical"></i>
                </div>
                <div class="habit-icon-bg" style="background-color: ${habit.color}33;">
                    <i class="fa-solid ${habit.icon}" style="color: ${habit.color};"></i>
                </div>
                <div class="habit-info">
                    <h2>${habit.name}</h2>
                    <span class="streak">
                        ${streakHtml}
                    </span>
                </div>
                <button class="menu-btn edit-habit-btn" data-id="${habit.id}"><i class="fa-solid fa-pencil"></i></button>
            </div>
            <div class="habit-week">
                ${weekHtml}
            </div>
        `;

        container.appendChild(card);
    });

    setupHabitDragAndDrop(container);

    // Lógica de click
    document.querySelectorAll('#weekly-habit-list .day-box:not(.disabled)').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const el = e.currentTarget;
            const habitId = el.getAttribute('data-id');
            const dateStr = el.getAttribute('data-date');

            const habit = state.habits.find(h => h.id === habitId);
            if (habit && dateStr !== todayStr) {
                freezeDay(habitId, dateStr);
                return;
            }
            if (habit) {
                if (habit.type === 'tempo') {
                    // Hábitos de foco: o usuário pode fazer múltiplas sessões por dia
                    // Não remove a marcação existente; direciona para a aba Foco vinculado a este hábito
                    setFocusHabit(habit.id);
                    switchTab(2, true);
                } else {
                    habit.records[dateStr] = !habit.records[dateStr];
                    saveState();
                    renderViews();
                }
            }
        });
    });

    // Lógica de editar
    document.querySelectorAll('.edit-habit-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const habitId = e.currentTarget.getAttribute('data-id');
            openModal(habitId);
        });
    });
}

// === Sistema de Reordenação de Hábitos (Segurar e Arrastar) ===
let isDraggingHabit = false;

function setupHabitDragAndDrop(container) {
    if (!container) return;
    const cards = Array.from(container.querySelectorAll('.habit-card'));
    if (cards.length <= 1) return;

    cards.forEach(card => {
        const handle = card.querySelector('.drag-handle');
        if (!handle) return;

        // --- Suporte a Mouse (Desktop Drag & Drop com FLIP) ---
        card.setAttribute('draggable', 'false');

        handle.addEventListener('mousedown', () => {
            card.setAttribute('draggable', 'true');
        });

        card.addEventListener('dragstart', (e) => {
            isDraggingHabit = true;
            card.classList.add('is-dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', card.getAttribute('data-id'));
            triggerHaptic(true);
        });

        card.addEventListener('dragend', () => {
            card.setAttribute('draggable', 'false');
            card.classList.remove('is-dragging');
            isDraggingHabit = false;
            updateHabitsOrderFromDOM(container);
        });

        card.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            const draggingCard = container.querySelector('.habit-card.is-dragging');
            if (draggingCard && draggingCard !== card) {
                const rect = card.getBoundingClientRect();
                const midY = rect.top + rect.height / 2;
                const targetBefore = (e.clientY < midY) ? card : card.nextSibling;
                if (draggingCard.nextSibling !== targetBefore && draggingCard !== targetBefore) {
                    animateFLIPReorder(container, () => {
                        container.insertBefore(draggingCard, targetBefore);
                    });
                    triggerHaptic(false);
                }
            }
        });

        // --- Suporte a Touch no Celular com Animação FLIP Suave e Estável ---
        handle.addEventListener('touchstart', (e) => {
            if (e.touches.length !== 1) return;
            isDraggingHabit = true;
            let touchStartY = e.touches[0].clientY;
            
            card.classList.add('is-dragging');
            card.style.transition = 'none';
            triggerHaptic(true);

            const onTouchMove = (moveEvent) => {
                if (!isDraggingHabit) return;
                if (moveEvent.cancelable) moveEvent.preventDefault();

                const touch = moveEvent.touches[0];
                const currentY = touch.clientY;
                const deltaY = currentY - touchStartY;

                card.style.transform = `translateY(${deltaY}px) scale(1.025)`;

                // Reordenar suavemente com animação FLIP quando sobrepor outro card
                const otherCards = Array.from(container.querySelectorAll('.habit-card:not(.is-dragging)'));
                for (const other of otherCards) {
                    const rect = other.getBoundingClientRect();
                    if (currentY >= rect.top && currentY <= rect.bottom) {
                        const midY = rect.top + rect.height / 2;
                        const targetBefore = (currentY < midY) ? other : other.nextSibling;
                        if (card.nextSibling !== targetBefore && card !== targetBefore) {
                            const oldVisualTop = card.getBoundingClientRect().top;
                            animateFLIPReorder(container, () => {
                                container.insertBefore(card, targetBefore);
                            });
                            const newVisualTop = card.getBoundingClientRect().top;
                            // Compensa o touchStartY para que o card sob o dedo não sofra nenhum salto visual
                            touchStartY += (newVisualTop - oldVisualTop);
                            card.style.transform = `translateY(${currentY - touchStartY}px) scale(1.025)`;
                            triggerHaptic(false);
                            break;
                        }
                    }
                }
            };

            const onTouchEnd = () => {
                window.removeEventListener('touchmove', onTouchMove);
                window.removeEventListener('touchend', onTouchEnd);
                window.removeEventListener('touchcancel', onTouchEnd);

                card.style.transition = 'transform 0.25s cubic-bezier(0.25, 1, 0.5, 1)';
                card.style.transform = '';
                setTimeout(() => {
                    card.classList.remove('is-dragging');
                    card.style.transition = '';
                }, 250);

                isDraggingHabit = false;
                updateHabitsOrderFromDOM(container);
                triggerHaptic(true);
            };

            window.addEventListener('touchmove', onTouchMove, { passive: false });
            window.addEventListener('touchend', onTouchEnd, { passive: true });
            window.addEventListener('touchcancel', onTouchEnd, { passive: true });
        }, { passive: true });
    });
}

// Animação FLIP para que a troca de posição dos outros cards seja fluida e deslizante
function animateFLIPReorder(container, domMutationFn) {
    if (!container) return;
    const siblings = Array.from(container.querySelectorAll('.habit-card:not(.is-dragging)'));
    const firstPositions = new Map();
    siblings.forEach(el => {
        firstPositions.set(el, el.getBoundingClientRect().top);
    });

    domMutationFn();

    siblings.forEach(el => {
        const first = firstPositions.get(el);
        const last = el.getBoundingClientRect().top;
        const delta = first - last;
        if (delta !== 0) {
            el.style.transition = 'none';
            el.style.transform = `translateY(${delta}px)`;
            requestAnimationFrame(() => {
                el.offsetHeight; // Força reflow
                el.style.transition = 'transform 0.28s cubic-bezier(0.25, 1, 0.5, 1)';
                el.style.transform = '';
            });
        }
    });
}

function updateHabitsOrderFromDOM(container) {
    if (!container) return;
    const cardElements = Array.from(container.querySelectorAll('.habit-card'));
    const newOrderIds = cardElements.map(el => el.getAttribute('data-id')).filter(Boolean);

    const currentIds = state.habits.map(h => h.id);
    const hasChanged = newOrderIds.some((id, idx) => id !== currentIds[idx]);

    if (hasChanged) {
        state.habits.sort((a, b) => newOrderIds.indexOf(a.id) - newOrderIds.indexOf(b.id));
        saveState();
        showAppToast('Ordem dos hábitos atualizada!', 'fa-arrows-up-down');
        renderMonthlyView();
        updateViewportHeight(false);
    }
}

let selectedMonthOffset = 0;

document.getElementById('prev-month-btn').addEventListener('click', () => {
    selectedMonthOffset++;
    renderMonthlyView();
});

document.getElementById('next-month-btn').addEventListener('click', () => {
    if (selectedMonthOffset > 0) {
        selectedMonthOffset--;
        renderMonthlyView();
    }
});

function renderMonthlyView() {
    const container = document.getElementById('monthly-habit-list');
    container.innerHTML = '';

    const date = new Date(today.getFullYear(), today.getMonth() - selectedMonthOffset, 1);
    const year = date.getFullYear();
    const month = date.getMonth();
    const monthName = date.toLocaleString('pt-BR', { month: 'long' });

    document.getElementById('current-month-display').textContent = `${monthName} ${year}`;
    const nextBtn = document.getElementById('next-month-btn');
    if (selectedMonthOffset === 0) {
        nextBtn.disabled = true;
        nextBtn.style.opacity = '0.3';
    } else {
        nextBtn.disabled = false;
        nextBtn.style.opacity = '1';
    }

    // === CARD DE FOCO GERAL (tempo sem celular, sem hábito vinculado) ===
    {
        const fmt = (total) => {
            const h = Math.floor(total / 60);
            const m = total % 60;
            if (h === 0) return `${m} min`;
            return m ? `${h}h ${m}min` : `${h}h`;
        };
        const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}-`;
        const sessions = (state.generalFocus || []).filter(s => s.date.startsWith(monthPrefix));
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const perDay = Array(daysInMonth).fill(0);
        sessions.forEach(s => { perDay[parseInt(s.date.slice(8, 10), 10) - 1] += s.minutes; });
        const totalMins = perDay.reduce((a, b) => a + b, 0);
        const activeDays = perDay.filter(m => m > 0).length;
        const bestDay = Math.max(0, ...perDay);
        const maxBar = Math.max(30, bestDay);
        const barsHtml = perDay.map((m, i) => {
            const h = m > 0 ? Math.max(8, Math.round((m / maxBar) * 100)) : 0;
            return `<div title="Dia ${i + 1}: ${m} min" style="flex:1; display:flex; align-items:flex-end; height:100%;"><div style="width:100%; height:${h}%; min-height:${m > 0 ? 3 : 1}px; border-radius:2px; background:${m > 0 ? 'var(--accent-green)' : 'rgba(255,255,255,0.08)'};"></div></div>`;
        }).join('');
        const gCard = document.createElement('div');
        gCard.className = 'habit-card focus-analytics-card';
        gCard.style.setProperty('--habit-color', '#34d399');
        gCard.innerHTML = `
            <div class="habit-info" style="margin-bottom: 12px;">
                <div class="habit-title" style="display:flex; align-items:center; gap:8px; font-weight:600;">
                    <i class="fa-solid fa-mobile-screen-button" style="color: var(--accent-green);"></i>
                    <span>Foco Geral &bull; Longe do celular</span>
                </div>
            </div>
            <div class="focus-chart-summary">
                <span>Tempo focado no mês</span>
                <strong>${fmt(totalMins)} <span style="font-size: 0.8rem; font-weight: 500; color: var(--text-secondary);">(${sessions.length} sessões)</span></strong>
            </div>
            <div style="display:flex; gap:2px; height:56px; margin:12px 0 6px;">${barsHtml}</div>
            <div style="display:flex; justify-content:space-between; font-size:0.75rem; color: var(--text-secondary);">
                <span>${activeDays} dia${activeDays === 1 ? '' : 's'} com foco</span>
                <span>Melhor dia: ${fmt(bestDay)}</span>
            </div>`;
        container.appendChild(gCard);
    }

    state.habits.forEach(habit => {
        const card = document.createElement('div');
        card.className = 'habit-card';
        card.style.setProperty('--habit-color', habit.color);

        function formatHoursMinutes(total) {
            const h = Math.floor(total / 60);
            const m = total % 60;
            if (h === 0) return `${m} min`;
            return m ? `${h}h ${m}min` : `${h}h`;
        }

        if (habit.type === 'tempo') {
            // === CARD DE HÁBITO DE FOCO (SUBMENU DIA, SEMANA, MÊS, ANO COM GRÁFICOS) ===
            const period = focusChartPeriod[habit.id] || 'semana';
            card.classList.add('focus-analytics-card');

            let chartBodyHtml = '';

            if (period === 'dia') {
                // Modo Dia: Distribuição horária e sessões de hoje
                const todaySessions = (habit.sessions || []).filter(s => s.date === todayStr);
                const todayMins = todaySessions.reduce((acc, s) => acc + s.minutes, 0);

                // 6 faixas horárias do dia (00h-04h, 04h-08h, 08h-12h, 12h-16h, 16h-20h, 20h-24h)
                const slots = [
                    { label: '00h', start: 0, end: 4, mins: 0 },
                    { label: '04h', start: 4, end: 8, mins: 0 },
                    { label: '08h', start: 8, end: 12, mins: 0 },
                    { label: '12h', start: 12, end: 16, mins: 0 },
                    { label: '16h', start: 16, end: 20, mins: 0 },
                    { label: '20h', start: 20, end: 24, mins: 0 }
                ];

                todaySessions.forEach(s => {
                    const sessionHour = s.timestamp ? new Date(s.timestamp).getHours() : 12;
                    const slot = slots.find(sl => sessionHour >= sl.start && sessionHour < sl.end) || slots[3];
                    slot.mins += s.minutes;
                });

                const maxSlotMins = Math.max(30, ...slots.map(sl => sl.mins));

                let slotColsHtml = slots.map(sl => {
                    const heightPct = sl.mins > 0 ? Math.max(8, Math.round((sl.mins / maxSlotMins) * 100)) : 0;
                    return `
                        <div class="chart-column">
                            <span class="chart-col-val">${sl.mins > 0 ? `${sl.mins}m` : '-'}</span>
                            <div class="chart-bar-wrap">
                                <div class="chart-bar ${sl.mins === 0 ? 'empty' : ''}" style="height: ${heightPct}%;"></div>
                            </div>
                            <span class="chart-col-label">${sl.label}</span>
                        </div>
                    `;
                }).join('');

                let sessionsListHtml = '';
                if (todaySessions.length > 0) {
                    sessionsListHtml = todaySessions.map((s, idx) => {
                        const timeStr = s.timestamp ? new Date(s.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '--:--';
                        return `
                            <div class="session-item">
                                <div class="session-item-time">
                                    <i class="fa-solid fa-circle-check" style="color: ${habit.color};"></i>
                                    <span>Sessão ${idx + 1} &bull; ${timeStr}</span>
                                </div>
                                <span class="session-item-duration">${s.minutes} min</span>
                            </div>
                        `;
                    }).join('');
                } else {
                    sessionsListHtml = `<div style="text-align: center; color: var(--text-secondary); padding: 16px 0; font-size: 0.85rem;">Nenhuma sessão hoje. Vá até a aba Foco para iniciar!</div>`;
                }

                chartBodyHtml = `
                    <div class="focus-chart-summary">
                        <span>Tempo Focado Hoje</span>
                        <strong>${todayMins} min <span style="font-size: 0.8rem; font-weight: 500; color: var(--text-secondary);">(${todaySessions.length} sessões)</span></strong>
                    </div>
                    <div class="bar-chart-container">
                        ${slotColsHtml}
                    </div>
                    <div style="margin-top: 16px;">
                        <h4 style="font-size: 0.82rem; color: var(--text-secondary); margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;">Sessões Realizadas</h4>
                        ${sessionsListHtml}
                    </div>
                `;

            } else if (period === 'semana') {
                // Modo Semana: 7 dias da semana atual (Seg a Dom)
                const currentDayOfWeek = today.getDay();
                const distFromMonday = currentDayOfWeek === 0 ? 6 : currentDayOfWeek - 1;
                const weekDates = [];
                for (let i = 0; i < 7; i++) {
                    const d = new Date(today);
                    d.setDate(today.getDate() - distFromMonday + i);
                    weekDates.push(d);
                }

                const dayLabels = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
                const weekDaysData = weekDates.map((d, i) => {
                    const dStr = formatDate(d);
                    const daySessions = (habit.sessions || []).filter(s => s.date === dStr);
                    const mins = daySessions.reduce((acc, s) => acc + s.minutes, 0);
                    return {
                        dateStr: dStr,
                        isToday: dStr === todayStr,
                        label: dayLabels[i],
                        mins: mins
                    };
                });

                const weekTotal = weekDaysData.reduce((acc, d) => acc + d.mins, 0);
                const maxWeekMins = Math.max(30, ...weekDaysData.map(d => d.mins));

                let weekColsHtml = weekDaysData.map(d => {
                    const heightPct = d.mins > 0 ? Math.max(8, Math.round((d.mins / maxWeekMins) * 100)) : 0;
                    let displayVal = '-';
                    if (d.mins > 0) {
                        displayVal = d.mins >= 60 ? `${Math.floor(d.mins / 60)}h${d.mins % 60 ? d.mins % 60 + 'm' : ''}` : `${d.mins}m`;
                    }
                    return `
                        <div class="chart-column ${d.isToday ? 'is-today' : ''}">
                            <span class="chart-col-val">${displayVal}</span>
                            <div class="chart-bar-wrap">
                                <div class="chart-bar ${d.mins === 0 ? 'empty' : ''}" style="height: ${heightPct}%;"></div>
                            </div>
                            <span class="chart-col-label">${d.label}</span>
                        </div>
                    `;
                }).join('');

                chartBodyHtml = `
                    <div class="focus-chart-summary">
                        <span>Total Nesta Semana</span>
                        <strong>${weekTotal} min <span style="font-size: 0.8rem; font-weight: 500; color: var(--text-secondary);">(média ${Math.round(weekTotal / 7)} min/dia)</span></strong>
                    </div>
                    <div class="bar-chart-container">
                        ${weekColsHtml}
                    </div>
                `;

            } else if (period === 'mes') {
                // Modo Mês: Dias do mês selecionado
                const daysInMonth = new Date(year, month + 1, 0).getDate();
                const monthSessions = (habit.sessions || []).filter(s => {
                    const [sY, sM] = s.date.split('-').map(Number);
                    return sY === year && sM === (month + 1);
                });
                const monthTotal = monthSessions.reduce((acc, s) => acc + s.minutes, 0);
                const firstDay = new Date(year, month, 1).getDay();

                let calGridHtml = `
                    <div class="calendar-grid">
                        <div class="cal-day-header">D</div>
                        <div class="cal-day-header">S</div>
                        <div class="cal-day-header">T</div>
                        <div class="cal-day-header">Q</div>
                        <div class="cal-day-header">Q</div>
                        <div class="cal-day-header">S</div>
                        <div class="cal-day-header">S</div>
                `;
                for (let i = 0; i < firstDay; i++) {
                    calGridHtml += `<div class="cal-box empty"></div>`;
                }
                for (let d = 1; d <= daysInMonth; d++) {
                    const currentD = new Date(year, month, d);
                    const dStr = formatDate(currentD);
                    const daySessions = monthSessions.filter(s => s.date === dStr);
                    const dayMins = daySessions.reduce((acc, s) => acc + s.minutes, 0);

                    let boxStyle = 'background-color: rgba(255,255,255,0.05);';
                    let boxClass = 'cal-box';
                    let innerContent = d;

                    if (dayMins > 0) {
                        boxClass += ' completed';
                        boxStyle = `background-color: ${habit.color};`;
                        const boxLabel = dayMins >= 60 ? `${Math.floor(dayMins / 60)}h${dayMins % 60 ? String(dayMins % 60).padStart(2, '0') : ''}` : `${dayMins}m`;
                        innerContent = `<span style="font-size: 0.65rem; font-weight: 700;">${boxLabel}</span>`;
                    }

                    calGridHtml += `<div class="${boxClass}" style="${boxStyle}" title="${dStr}: ${formatHoursMinutes(dayMins)}">${innerContent}</div>`;
                }
                calGridHtml += `</div>`;

                chartBodyHtml = `
                    <div class="focus-chart-summary">
                        <span>Total em ${monthName}</span>
                        <strong>${formatHoursMinutes(monthTotal)} <span style="font-size: 0.8rem; font-weight: 500; color: var(--text-secondary);">(${monthSessions.length} sessões)</span></strong>
                    </div>
                    <div class="month-block" style="padding-top: 0;">
                        ${calGridHtml}
                    </div>
                `;

            } else if (period === 'ano') {
                // Modo Ano: 12 meses do ano selecionado
                const monthLabels = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
                const yearSessions = (habit.sessions || []).filter(s => {
                    const sY = parseInt(s.date.split('-')[0]);
                    return sY === year;
                });
                const yearTotal = yearSessions.reduce((acc, s) => acc + s.minutes, 0);

                const monthsData = monthLabels.map((label, idx) => {
                    const mSessions = yearSessions.filter(s => parseInt(s.date.split('-')[1]) === (idx + 1));
                    const mins = mSessions.reduce((acc, s) => acc + s.minutes, 0);
                    return { label, mins };
                });

                const maxYearMonthMins = Math.max(60, ...monthsData.map(m => m.mins));

                let yearColsHtml = monthsData.map(m => {
                    const heightPct = m.mins > 0 ? Math.max(8, Math.round((m.mins / maxYearMonthMins) * 100)) : 0;
                    const displayVal = m.mins > 0 ? (m.mins >= 60 ? `${Math.round(m.mins / 60)}h` : `${m.mins}m`) : '-';
                    return `
                        <div class="chart-column">
                            <span class="chart-col-val">${displayVal}</span>
                            <div class="chart-bar-wrap">
                                <div class="chart-bar ${m.mins === 0 ? 'empty' : ''}" style="height: ${heightPct}%;"></div>
                            </div>
                            <span class="chart-col-label">${m.label}</span>
                        </div>
                    `;
                }).join('');

                chartBodyHtml = `
                    <div class="focus-chart-summary">
                        <span>Total no Ano (${year})</span>
                        <strong>${Math.floor(yearTotal / 60)}h ${yearTotal % 60}m <span style="font-size: 0.8rem; font-weight: 500; color: var(--text-secondary);">(${yearSessions.length} sessões)</span></strong>
                    </div>
                    <div class="bar-chart-container">
                        ${yearColsHtml}
                    </div>
                `;
            }

            card.innerHTML = `
                <div class="habit-header" style="margin-bottom: 16px;">
                    <div class="habit-icon-bg" style="width:40px; height:40px; background-color: ${habit.color}33;">
                        <i class="fa-solid ${habit.icon}" style="color: ${habit.color}; font-size: 1rem;"></i>
                    </div>
                    <div class="habit-info">
                        <h2 style="font-size: 1.1rem; margin-bottom: 2px;">${habit.name}</h2>
                        <span class="streak" style="font-size: 0.8rem; color: var(--text-secondary);">${habit.totalFocusTime || 0} min total focado &bull; ${(habit.sessions || []).length} sessões</span>
                    </div>
                </div>
                
                <div class="focus-period-nav">
                    <button class="period-btn ${period === 'dia' ? 'active' : ''}" data-id="${habit.id}" data-period="dia">Dia</button>
                    <button class="period-btn ${period === 'semana' ? 'active' : ''}" data-id="${habit.id}" data-period="semana">Semana</button>
                    <button class="period-btn ${period === 'mes' ? 'active' : ''}" data-id="${habit.id}" data-period="mes">Mês</button>
                    <button class="period-btn ${period === 'ano' ? 'active' : ''}" data-id="${habit.id}" data-period="ano">Ano</button>
                </div>

                <div class="focus-chart-body">
                    ${chartBodyHtml}
                </div>
            `;

        } else {
            // === CARD DE HÁBITO SIM / NÃO (GRADE MENSAL CLÁSSICA) ===
            let html = '';
            let doneTotal = 0;

            const firstDay = new Date(year, month, 1).getDay();
            const daysInMonth = new Date(year, month + 1, 0).getDate();
                
            html += `<div class="month-block" style="padding-top: 0;">
                        <div class="calendar-grid">
                            <div class="cal-day-header">D</div>
                            <div class="cal-day-header">S</div>
                            <div class="cal-day-header">T</div>
                            <div class="cal-day-header">Q</div>
                            <div class="cal-day-header">Q</div>
                            <div class="cal-day-header">S</div>
                            <div class="cal-day-header">S</div>`;
                                
            for (let i = 0; i < firstDay; i++) {
                html += `<div class="cal-box empty"></div>`;
            }
                
            for (let d = 1; d <= daysInMonth; d++) {
                const currentD = new Date(year, month, d);
                const dateStr = formatDate(currentD);
                const jsDay = currentD.getDay();
                const isActiveDay = habit.activeDays.includes(jsDay);
                const isCompleted = habit.records[dateStr];
                    
                if (isCompleted) doneTotal++;
                    
                let color = 'rgba(255,255,255,0.05)';
                let extraClass = '';
                let inner = d;
                let dataAttr = '';
                if (!isActiveDay) {
                    extraClass = 'inactive';
                    color = 'rgba(0,0,0,0.3)';
                } else if (isCompleted) {
                    color = habit.color;
                    extraClass = 'completed';
                } else if (habit.frozen && habit.frozen[dateStr]) {
                    color = '#38bdf8';
                    extraClass = 'frozen';
                    inner = '<i class="fa-solid fa-snowflake" style="font-size:0.7rem;"></i>';
                } else if (canFreezeDay(habit, dateStr)) {
                    extraClass = 'freezable';
                    inner = '<i class="fa-regular fa-snowflake" style="font-size:0.7rem;"></i>';
                    dataAttr = `data-freeze-id="${habit.id}" data-freeze-date="${dateStr}"`;
                }
                    
                html += `<div class="cal-box ${extraClass}" style="background-color: ${color};" title="${dateStr}" ${dataAttr}>${inner}</div>`;
            }
                
            html += `</div></div>`;

            const streakCount = calculateStreak(habit);
            const fireIcon = streakCount >= 2 ? '<i class="fa-solid fa-fire" style="color: #f97316;"></i> ' : '';
            const streakHtml = `${doneTotal} concluídos &bull; ${fireIcon}Sequência: ${streakCount}`;

            card.innerHTML = `
                <div class="habit-header" style="margin-bottom: 12px;">
                    <div class="habit-icon-bg" style="width:40px; height:40px; background-color: ${habit.color}33;">
                        <i class="fa-solid ${habit.icon}" style="color: ${habit.color}; font-size: 1rem;"></i>
                    </div>
                    <div class="habit-info">
                        <h2 style="font-size: 1.1rem; margin-bottom: 4px;">${habit.name}</h2>
                        <span class="streak" style="font-size: 0.8rem; color: var(--text-secondary);">${streakHtml}</span>
                    </div>
                </div>
                <div class="months-container">
                    ${html}
                </div>
            `;
        }

        container.appendChild(card);
    });

    document.querySelectorAll('#monthly-habit-list .cal-box.freezable').forEach(box => {
        box.addEventListener('click', () => {
            freezeDay(box.getAttribute('data-freeze-id'), box.getAttribute('data-freeze-date'));
        });
    });

    // Event listener para alternar submenus Dia, Semana, Mês, Ano
    document.querySelectorAll('#monthly-habit-list .period-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const habitId = e.currentTarget.getAttribute('data-id');
            const period = e.currentTarget.getAttribute('data-period');
            focusChartPeriod[habitId] = period;
            renderMonthlyView();
        });
    });

    updateViewportHeight(false);
}

// === Modal de Hábito ===
const modal = document.getElementById('habit-modal');
const modalTitle = document.getElementById('modal-title');
const habitForm = document.getElementById('habit-form');

const reminderCheckbox = document.getElementById('habit-reminder-enabled');
const reminderTimeGroup = document.getElementById('reminder-time-group');
reminderCheckbox.addEventListener('change', async (e) => {
    reminderTimeGroup.style.display = e.target.checked ? 'block' : 'none';
    if (e.target.checked) {
        if ('Notification' in window) {
            if (Notification.permission === 'default') {
                const perm = await Notification.requestPermission();
                if (perm !== 'granted') {
                    customAlert('As notificações não foram autorizadas. Ative as notificações nas configurações do seu navegador para receber os avisos.');
                }
            } else if (Notification.permission === 'denied') {
                customAlert('As notificações estão bloqueadas nas configurações do seu navegador. Por favor, autorize as notificações para que os lembretes funcionem.');
            }
        } else {
            customAlert('Seu dispositivo ou navegador não suporta notificações.');
        }
    }
});

// === Seletor de Horário Customizado Estilo Cadeado de Senha Numérica ===
let customReminderHour = 9;
let customReminderMinute = 0;

function getTimePeriodLabel(hour) {
    if (hour >= 0 && hour < 6) return 'Madrugada';
    if (hour >= 6 && hour < 12) return 'Manhã';
    if (hour >= 12 && hour < 18) return 'Tarde';
    return 'Noite';
}

function updateCustomTimePickerUI() {
    const hh = String(customReminderHour).padStart(2, '0');
    const mm = String(customReminderMinute).padStart(2, '0');
    const timeStr = `${hh}:${mm}`;

    const prevHr = String((customReminderHour - 1 + 24) % 24).padStart(2, '0');
    const nextHr = String((customReminderHour + 1) % 24).padStart(2, '0');

    const prevMin = String((customReminderMinute - 1 + 60) % 60).padStart(2, '0');
    const nextMin = String((customReminderMinute + 1) % 60).padStart(2, '0');

    const hourPrev = document.getElementById('hour-prev');
    const hourDisplay = document.getElementById('hour-display');
    const hourNext = document.getElementById('hour-next');

    const minPrev = document.getElementById('minute-prev');
    const minDisplay = document.getElementById('minute-display');
    const minNext = document.getElementById('minute-next');

    const reminderTimeInput = document.getElementById('habit-reminder-time');

    if (hourPrev) hourPrev.textContent = prevHr;
    if (hourDisplay) hourDisplay.textContent = hh;
    if (hourNext) hourNext.textContent = nextHr;

    if (minPrev) minPrev.textContent = prevMin;
    if (minDisplay) minDisplay.textContent = mm;
    if (minNext) minNext.textContent = nextMin;

    if (reminderTimeInput) reminderTimeInput.value = timeStr;
}

function setCustomReminderTime(timeStr) {
    if (!timeStr || typeof timeStr !== 'string') timeStr = '09:00';
    const parts = timeStr.split(':').map(Number);
    customReminderHour = isNaN(parts[0]) ? 9 : Math.max(0, Math.min(23, parts[0]));
    customReminderMinute = isNaN(parts[1]) ? 0 : Math.max(0, Math.min(59, parts[1]));
    updateCustomTimePickerUI();
}

function initCustomTimePickerEvents() {
    const hourPrev = document.getElementById('hour-prev');
    const hourNext = document.getElementById('hour-next');
    const minutePrev = document.getElementById('minute-prev');
    const minuteNext = document.getElementById('minute-next');

    const hourWheel = document.getElementById('hour-wheel');
    const minuteWheel = document.getElementById('minute-wheel');
    const hourTrack = document.getElementById('hour-wheel-track');
    const minuteTrack = document.getElementById('minute-wheel-track');

    const animateStep = (track, dir, onCommit) => {
        if (!track) {
            onCommit();
            return;
        }
        const targetY = dir > 0 ? -44 : 44;
        track.style.transition = 'transform 0.16s cubic-bezier(0.25, 1, 0.5, 1)';
        track.style.transform = `translateY(${targetY}px)`;
        setTimeout(() => {
            onCommit();
            track.style.transition = 'none';
            track.style.transform = 'translateY(0)';
        }, 160);
    };

    const stepHour = (dir) => {
        animateStep(hourTrack, dir, () => {
            customReminderHour = (customReminderHour + dir + 24) % 24;
            triggerHaptic();
            updateCustomTimePickerUI();
        });
    };

    const stepMinute = (dir) => {
        animateStep(minuteTrack, dir, () => {
            customReminderMinute = (customReminderMinute + dir + 60) % 60;
            triggerHaptic();
            updateCustomTimePickerUI();
        });
    };

    if (hourPrev) hourPrev.addEventListener('click', () => stepHour(-1));
    if (hourNext) hourNext.addEventListener('click', () => stepHour(1));
    if (minutePrev) minutePrev.addEventListener('click', () => stepMinute(-1));
    if (minuteNext) minuteNext.addEventListener('click', () => stepMinute(1));

    // Suporte a arrasto vertical contínuo, suave e fluido com barra verde FIXA no centro
    const attachTumblerDrag = (wheelEl, trackEl, onStep) => {
        if (!wheelEl || !trackEl) return;
        let startY = 0;
        let isDragging = false;
        let isWheelLocked = false;
        const STEP_HEIGHT = 44; // Altura para troca suave de cada número

        const onPointerDown = (e) => {
            isDragging = true;
            startY = e.clientY;
            trackEl.style.transition = 'none';
            try {
                wheelEl.setPointerCapture(e.pointerId);
            } catch (err) {}
            triggerHaptic();
        };

        const onPointerMove = (e) => {
            if (!isDragging) return;
            const currentY = e.clientY;
            let deltaY = currentY - startY;

            // Se arrastou para cima o suficiente (próximo número)
            if (deltaY <= -STEP_HEIGHT) {
                onStep(1);
                startY -= STEP_HEIGHT;
                deltaY = currentY - startY;
                triggerHaptic();
            } 
            // Se arrastou para baixo o suficiente (número anterior)
            else if (deltaY >= STEP_HEIGHT) {
                onStep(-1);
                startY += STEP_HEIGHT;
                deltaY = currentY - startY;
                triggerHaptic();
            }

            // Acompanha o dedo de forma fluida e suave sob a barra verde fixa
            trackEl.style.transform = `translateY(${deltaY * 0.75}px)`;
        };

        const onPointerUp = (e) => {
            if (!isDragging) return;
            isDragging = false;
            try {
                wheelEl.releasePointerCapture(e.pointerId);
            } catch (err) {}

            // Retorna suavemente para alinhar perfeitamente com a barra verde central fixa
            trackEl.style.transition = 'transform 0.22s cubic-bezier(0.25, 1, 0.5, 1)';
            trackEl.style.transform = 'translateY(0)';
        };

        wheelEl.addEventListener('pointerdown', onPointerDown);
        wheelEl.addEventListener('pointermove', onPointerMove);
        wheelEl.addEventListener('pointerup', onPointerUp);
        wheelEl.addEventListener('pointercancel', onPointerUp);

        // Scroll com roda do mouse cadenciado e com animação fluida
        wheelEl.addEventListener('wheel', (e) => {
            e.preventDefault();
            if (isWheelLocked) return;
            isWheelLocked = true;
            const dir = e.deltaY > 0 ? 1 : -1;
            trackEl.style.transition = 'transform 0.16s cubic-bezier(0.25, 1, 0.5, 1)';
            trackEl.style.transform = dir > 0 ? 'translateY(-44px)' : 'translateY(44px)';
            setTimeout(() => {
                onStep(dir);
                trackEl.style.transition = 'none';
                trackEl.style.transform = 'translateY(0)';
                isWheelLocked = false;
            }, 160);
        }, { passive: false });
    };

    attachTumblerDrag(hourWheel, hourTrack, (dir) => {
        customReminderHour = (customReminderHour + dir + 24) % 24;
        triggerHaptic();
        updateCustomTimePickerUI();
    });

    attachTumblerDrag(minuteWheel, minuteTrack, (dir) => {
        customReminderMinute = (customReminderMinute + dir + 60) % 60;
        triggerHaptic();
        updateCustomTimePickerUI();
    });
}

// === Gerenciador dos Dias da Semana do Modal ===
function updateDaysSummaryBadge() {
    const checkboxes = Array.from(document.querySelectorAll('input[name="active-days"]'));
    const checkedBoxes = checkboxes.filter(cb => cb.checked);
    const count = checkedBoxes.length;
    const badge = document.getElementById('days-summary-badge');
    const btnAll = document.getElementById('shortcut-all-days');
    const btnWeekdays = document.getElementById('shortcut-weekdays');
    const btnWeekend = document.getElementById('shortcut-weekend');

    const selectedValues = checkedBoxes.map(cb => parseInt(cb.value));
    const isWeekdays = selectedValues.length === 5 && [1, 2, 3, 4, 5].every(v => selectedValues.includes(v));
    const isWeekend = selectedValues.length === 2 && [6, 0].every(v => selectedValues.includes(v));
    const isAll = count === 7;

    if (badge) {
        if (isAll) badge.textContent = 'Todos os dias';
        else if (isWeekdays) badge.textContent = 'Dias úteis (5 dias)';
        else if (isWeekend) badge.textContent = 'Fim de semana (2 dias)';
        else if (count === 0) badge.textContent = 'Nenhum dia';
        else badge.textContent = `${count} dias / semana`;
    }

    if (btnAll) btnAll.classList.toggle('active', isAll);
    if (btnWeekdays) btnWeekdays.classList.toggle('active', isWeekdays);
    if (btnWeekend) btnWeekend.classList.toggle('active', isWeekend);
}

function initDaysSelectorEvents() {
    const checkboxes = document.querySelectorAll('input[name="active-days"]');
    checkboxes.forEach(cb => {
        cb.addEventListener('change', () => {
            triggerHaptic();
            updateDaysSummaryBadge();
        });
    });

    const btnAll = document.getElementById('shortcut-all-days');
    const btnWeekdays = document.getElementById('shortcut-weekdays');
    const btnWeekend = document.getElementById('shortcut-weekend');

    if (btnAll) {
        btnAll.addEventListener('click', () => {
            checkboxes.forEach(cb => cb.checked = true);
            triggerHaptic(true);
            updateDaysSummaryBadge();
        });
    }

    if (btnWeekdays) {
        btnWeekdays.addEventListener('click', () => {
            checkboxes.forEach(cb => {
                const val = parseInt(cb.value);
                cb.checked = (val >= 1 && val <= 5);
            });
            triggerHaptic(true);
            updateDaysSummaryBadge();
        });
    }

    if (btnWeekend) {
        btnWeekend.addEventListener('click', () => {
            checkboxes.forEach(cb => {
                const val = parseInt(cb.value);
                cb.checked = (val === 6 || val === 0);
            });
            triggerHaptic(true);
            updateDaysSummaryBadge();
        });
    }
}

// Modal UI Logic
const ICONS = ['fa-check', 'fa-book-open', 'fa-dumbbell', 'fa-person-running', 'fa-burger', 'fa-music', 'fa-moon', 'fa-droplet', 'fa-lightbulb',
    'fa-heart', 'fa-brain', 'fa-bed', 'fa-bicycle', 'fa-person-swimming', 'fa-apple-whole', 'fa-carrot', 'fa-mug-hot', 'fa-pills', 'fa-tooth',
    'fa-pen', 'fa-graduation-cap', 'fa-code', 'fa-laptop', 'fa-language', 'fa-guitar', 'fa-palette', 'fa-camera', 'fa-broom', 'fa-shower',
    'fa-dog', 'fa-leaf', 'fa-sun', 'fa-star', 'fa-fire', 'fa-bullseye', 'fa-wallet', 'fa-piggy-bank', 'fa-phone', 'fa-people-group',
    'fa-spa', 'fa-ban-smoking', 'fa-utensils', 'fa-seedling', 'fa-clock', 'fa-list-check', 'fa-gamepad', 'fa-hands-praying', 'fa-walking'];
const COLORS = ['#ef4444', '#f97316', '#f59e0b', '#34d399', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6'];

let selectedIcon = 'fa-check';
let selectedColor = '#34d399';

const iconGrid = document.getElementById('icon-picker');
const colorGrid = document.getElementById('color-picker');

const typeRadios = document.querySelectorAll('input[name="habit-type"]');

typeRadios.forEach(r => {
    r.addEventListener('change', (e) => {
        document.querySelectorAll('.type-btn').forEach(btn => btn.classList.remove('active'));
        e.target.parentElement.classList.add('active');
    });
});

function renderPickerGrids() {
    iconGrid.innerHTML = ICONS.map(i => `<div class="picker-item ${i === selectedIcon ? 'selected' : ''}" data-val="${i}"><i class="fa-solid ${i}"></i></div>`).join('');
    colorGrid.innerHTML = COLORS.map(c => `<div class="color-item ${c === selectedColor ? 'selected' : ''}" data-val="${c}" style="background-color: ${c}"></div>`).join('');
}

function updatePreview() {
    const previewIcon = document.getElementById('preview-icon');
    const previewBg = document.getElementById('preview-bg');
    previewIcon.className = `fa-solid ${selectedIcon}`;
    previewBg.style.backgroundColor = selectedColor + '33';
    previewIcon.style.color = selectedColor;
}

iconGrid.addEventListener('click', (e) => {
    const item = e.target.closest('.picker-item');
    if (item) {
        selectedIcon = item.getAttribute('data-val');
        renderPickerGrids();
        updatePreview();
    }
});

colorGrid.addEventListener('click', (e) => {
    const item = e.target.closest('.color-item');
    if (item) {
        selectedColor = item.getAttribute('data-val');
        renderPickerGrids();
        updatePreview();
    }
});

document.getElementById('add-habit-btn').addEventListener('click', () => {
    openModal();
});

document.querySelector('.close-modal-btn').addEventListener('click', () => {
    modal.classList.add('hidden');
});

function openModal(habitId = null) {
    habitForm.reset();
    document.getElementById('habit-id').value = '';
    const deleteBtn = document.getElementById('delete-habit-btn');
    const submitBtn = document.querySelector('.submit-habit-btn');

    if (habitId) {
        const habit = state.habits.find(h => h.id === habitId);
        if (habit) {
            modalTitle.textContent = 'Editar Hábito';
            submitBtn.textContent = 'Salvar';
            deleteBtn.style.display = 'block';
            document.getElementById('habit-id').value = habit.id;
            document.getElementById('habit-name').value = habit.name;
            selectedIcon = habit.icon;
            selectedColor = habit.color;

            const isTempo = habit.type === 'tempo';
            document.querySelector(`input[name="habit-type"][value="${isTempo ? 'tempo' : 'sim_nao'}"]`).checked = true;
            document.querySelectorAll('.type-btn').forEach(btn => btn.classList.remove('active'));
            document.querySelector(`input[name="habit-type"][value="${isTempo ? 'tempo' : 'sim_nao'}"]`).parentElement.classList.add('active');

            document.querySelectorAll('input[name="active-days"]').forEach(cb => {
                cb.checked = habit.activeDays.includes(parseInt(cb.value));
            });
            updateDaysSummaryBadge();

            reminderCheckbox.checked = habit.reminderEnabled || false;
            setCustomReminderTime(habit.reminderTime || '09:00');
            reminderTimeGroup.style.display = habit.reminderEnabled ? 'block' : 'none';
        }
    } else {
        modalTitle.textContent = 'Novo Hábito';
        submitBtn.textContent = 'Continuar';
        deleteBtn.style.display = 'none';

        document.querySelector(`input[name="habit-type"][value="sim_nao"]`).checked = true;
        document.querySelectorAll('.type-btn').forEach(btn => btn.classList.remove('active'));
        document.querySelector(`input[name="habit-type"][value="sim_nao"]`).parentElement.classList.add('active');

        document.querySelectorAll('input[name="active-days"]').forEach(cb => cb.checked = true);
        updateDaysSummaryBadge();
        reminderCheckbox.checked = false;
        setCustomReminderTime('09:00');
        reminderTimeGroup.style.display = 'none';
        selectedIcon = 'fa-check';
        selectedColor = '#34d399';
    }

    renderPickerGrids();
    updatePreview();
    modal.classList.remove('hidden');
}

// Evita disparo imediato se o horário já passou hoje ao salvar; e limita o "forçar hoje" ao dia atual
function markReminderPassedToday(habit) {
    if (!habit) return;
    const now = new Date();
    habit.forceAlarmDate = formatDate(now);
    if (habit.reminderEnabled && habit.reminderTime) {
        const [h, m] = habit.reminderTime.split(':').map(Number);
        if (now.getHours() * 60 + now.getMinutes() > h * 60 + m) {
            habit.lastNotifiedKey = `${formatDate(now)}_${habit.reminderTime}`;
            habit.lastNotified = formatDate(now);
        }
    }
}

habitForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    // Solicitar permissão de notificação se a pessoa ativou o lembrete
    if (reminderCheckbox.checked && 'Notification' in window && Notification.permission === 'default') {
        await Notification.requestPermission();
    }

    const id = document.getElementById('habit-id').value || Date.now().toString();
    const name = document.getElementById('habit-name').value;
    const icon = selectedIcon;
    const color = selectedColor;

    const activeDays = Array.from(document.querySelectorAll('input[name="active-days"]:checked'))
        .map(cb => parseInt(cb.value));

    const reminderEnabled = reminderCheckbox.checked;
    const reminderTime = document.getElementById('habit-reminder-time').value;

    const habitType = document.querySelector('input[name="habit-type"]:checked').value;

    const existingIndex = state.habits.findIndex(h => h.id === id);
    if (existingIndex > -1) {
        state.habits[existingIndex] = {
            ...state.habits[existingIndex],
            name,
            icon,
            color,
            activeDays,
            reminderEnabled,
            reminderTime,
            type: habitType,
            forceAlarmToday: reminderEnabled
        };
        // Limpar travas de notificação anteriores para permitir testes no mesmo dia
        delete state.habits[existingIndex].lastNotified;
        delete state.habits[existingIndex].lastNotifiedKey;
        delete state.habits[existingIndex].snoozedUntil;
        markReminderPassedToday(state.habits[existingIndex]);
    } else {
        state.habits.push({
            id,
            name,
            icon,
            color,
            activeDays,
            records: {},
            reminderEnabled,
            reminderTime,
            type: habitType,
            sessions: [],
            totalFocusTime: 0,
            forceAlarmToday: reminderEnabled
        });
        markReminderPassedToday(state.habits[state.habits.length - 1]);
    }

    saveState();
    renderViews();
    modal.classList.add('hidden');
    if (reminderEnabled) {
        showAppToast(`Lembrete definido para as ${reminderTime}! ⏰`, 'fa-bell');
    }
});

document.getElementById('delete-habit-btn').addEventListener('click', () => {
    const id = document.getElementById('habit-id').value;
    if (id) {
        customConfirm('Tem certeza que deseja excluir este hábito? Todos os dados serão perdidos.', (confirmed) => {
            if (confirmed) {
                state.habits = state.habits.filter(h => h.id !== id);
                saveState();
                renderViews();
                modal.classList.add('hidden');
            }
        });
    }
});

// === Temporizador de Foco e Régua Interativa Centralizada ===
const startTimerBtn = document.querySelector('.start-timer-btn');
const timeDisplay = document.querySelector('.time-display');
const timerSublabel = document.getElementById('timer-sublabel');
const focusDescText = document.getElementById('focus-desc-text');
const timerInput = document.getElementById('timer-input');
const timerCircle = document.getElementById('timer-circle-clickable');
const timerProgressRing = document.getElementById('timer-progress-ring');
const timerDotGroup = document.getElementById('timer-dot-group');
const CIRCUMFERENCE = 596.9; // 2 * PI * 95

// Active Focus Habit Reference
window.currentFocusHabitId = null;
window.currentFocusDateStr = todayStr;

const focusHabitTag = document.getElementById('focus-habit-tag');
const focusHabitIcon = document.getElementById('focus-habit-icon');
const focusHabitName = document.getElementById('focus-habit-name');
const focusHabitSelectModal = document.getElementById('focus-habit-select-modal');
const focusHabitOptionsList = document.getElementById('focus-habit-options-list');
const closeFocusHabitSelectBtn = document.getElementById('close-focus-habit-select-btn');

function setFocusHabit(habitId) {
    window.currentFocusHabitId = habitId;
    window.currentFocusDateStr = todayStr;
    updateFocusHabitDisplay();
}

function updateFocusHabitDisplay() {
    if (!focusHabitTag) return;
    if (window.currentFocusHabitId) {
        const habit = state.habits.find(h => h.id === window.currentFocusHabitId);
        if (habit) {
            focusHabitIcon.className = `fa-solid ${habit.icon}`;
            focusHabitIcon.style.color = habit.color;
            const todaySessions = (habit.sessions || []).filter(s => s.date === todayStr);
            const todayMins = todaySessions.reduce((acc, s) => acc + s.minutes, 0);
            focusHabitName.textContent = todayMins > 0 ? `${habit.name} (${todayMins}m hoje)` : habit.name;
            return;
        }
    }
    focusHabitIcon.className = 'fa-solid fa-bullseye';
    focusHabitIcon.style.color = 'var(--accent-green)';
    focusHabitName.textContent = 'Foco Geral';
}

if (focusHabitTag) {
    focusHabitTag.addEventListener('click', () => {
        if (isTimerRunning) return;
        renderFocusHabitOptions();
        focusHabitSelectModal.classList.remove('hidden');
    });
}

if (closeFocusHabitSelectBtn) {
    closeFocusHabitSelectBtn.addEventListener('click', () => {
        focusHabitSelectModal.classList.add('hidden');
    });
}

if (focusHabitSelectModal) {
    focusHabitSelectModal.addEventListener('click', (e) => {
        if (e.target === focusHabitSelectModal) {
            focusHabitSelectModal.classList.add('hidden');
        }
    });
}

function renderFocusHabitOptions() {
    if (!focusHabitOptionsList) return;
    focusHabitOptionsList.innerHTML = '';

    // Opção: Foco Geral (sem vincular a hábito específico)
    const generalOpt = document.createElement('div');
    generalOpt.className = `focus-habit-option-item ${!window.currentFocusHabitId ? 'selected' : ''}`;
    generalOpt.innerHTML = `
        <div style="width: 36px; height: 36px; border-radius: 50%; background: rgba(52, 211, 153, 0.2); display: flex; align-items: center; justify-content: center; color: var(--accent-green);">
            <i class="fa-solid fa-bullseye"></i>
        </div>
        <div style="flex: 1;">
            <div style="font-weight: 600;">Foco Geral</div>
            <div style="font-size: 0.75rem; color: var(--text-secondary);">Sem vincular a nenhum hábito</div>
        </div>
    `;
    generalOpt.addEventListener('click', () => {
        setFocusHabit(null);
        focusHabitSelectModal.classList.add('hidden');
    });
    focusHabitOptionsList.appendChild(generalOpt);

    // Listar hábitos de foco
    const tempoHabits = state.habits.filter(h => h.type === 'tempo');
    tempoHabits.forEach(h => {
        const todaySessions = (h.sessions || []).filter(s => s.date === todayStr);
        const todayMins = todaySessions.reduce((acc, s) => acc + s.minutes, 0);
        const opt = document.createElement('div');
        opt.className = `focus-habit-option-item ${window.currentFocusHabitId === h.id ? 'selected' : ''}`;
        opt.innerHTML = `
            <div style="width: 36px; height: 36px; border-radius: 50%; background: ${h.color}33; display: flex; align-items: center; justify-content: center; color: ${h.color};">
                <i class="fa-solid ${h.icon}"></i>
            </div>
            <div style="flex: 1;">
                <div style="font-weight: 600;">${h.name}</div>
                <div style="font-size: 0.75rem; color: var(--text-secondary);">${todayMins} min hoje &bull; ${h.totalFocusTime || 0} min total</div>
            </div>
        `;
        opt.addEventListener('click', () => {
            setFocusHabit(h.id);
            focusHabitSelectModal.classList.add('hidden');
        });
        focusHabitOptionsList.appendChild(opt);
    });
}

// Audio & Haptic Feedback (Triplo suporte: Android nativo, iOS Taptic Engine e Ressonância de Graves)
let audioCtx = null;
function triggerHaptic(isMajor = false) {
    // 1. Android / PWA standard Vibration API
    if ('vibrate' in navigator) {
        try {
            navigator.vibrate(isMajor ? [120] : [85]);
        } catch (e) {}
    }

    // 2. iOS Safari Taptic Engine Switch Trigger (dispara Taptic nativo no iPhone)
    try {
        const iosLabel = document.getElementById('ios-haptic-trigger');
        if (iosLabel) iosLabel.click();
    } catch (e) {}

    // 3. Ressonância acústica sub-grave e clique tátil no alto-falante
    try {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
        const now = audioCtx.currentTime;

        // Pulso sub-grave de 55Hz (faz o diafragma do falante vibrar fisicamente na mão)
        const bassOsc = audioCtx.createOscillator();
        const bassGain = audioCtx.createGain();
        bassOsc.type = 'sine';
        bassOsc.frequency.setValueAtTime(55, now);
        bassGain.gain.setValueAtTime(isMajor ? 0.35 : 0.22, now);
        bassGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.055);
        bassOsc.connect(bassGain);
        bassGain.connect(audioCtx.destination);
        bassOsc.start(now);
        bassOsc.stop(now + 0.055);

        // Clique de confirmação nítido
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(isMajor ? 660 : 540, now);
        gain.gain.setValueAtTime(isMajor ? 0.06 : 0.035, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.035);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now);
        osc.stop(now + 0.035);
    } catch (e) {}
}

// === Régua Interativa com Agulha Central Fixa ===
const timerModal = document.getElementById('timer-slider-modal');
const rulerViewport = document.getElementById('ruler-viewport');
const rulerTrack = document.getElementById('ruler-track');
const timerSliderDisplay = document.getElementById('timer-slider-display');
const timerSliderConfirmBtn = document.getElementById('timer-slider-confirm-btn');

const TICK_SPACING = 20; // 20px entre cada intervalo de 5 minutos
const TOTAL_TICKS = 37;  // 0 a 180 min (36 passos de 5m -> índices 0 a 36)
let currentTrackX = 0;
let currentRulerVal = parseInt(timerInput.value) || 25;
let isRulerDragging = false;
let rulerStartX = 0;
let rulerStartTrackX = 0;

function initRuler() {
    if (!rulerTrack) return;
    rulerTrack.innerHTML = '';
    rulerTrack.style.width = `${(TOTAL_TICKS - 1) * TICK_SPACING}px`;

    for (let i = 0; i < TOTAL_TICKS; i++) {
        const val = i * 5;
        const tickEl = document.createElement('div');
        tickEl.className = 'ruler-tick-item';
        tickEl.dataset.idx = i;
        tickEl.dataset.val = val;
        tickEl.style.left = `${i * TICK_SPACING}px`;

        let typeClass = 'small';
        let labelHtml = '';

        if (i === 0) {
            typeClass = 'large';
            labelHtml = '<span class="ruler-tick-label" style="color: var(--accent-green); font-weight:700;">Livre</span>';
        } else if (val % 30 === 0) {
            typeClass = 'large';
            labelHtml = `<span class="ruler-tick-label">${val}</span>`;
        } else if (val % 15 === 0) {
            typeClass = 'medium';
        }

        tickEl.classList.add(typeClass);
        tickEl.innerHTML = `
            <div class="ruler-tick-bar"></div>
            ${labelHtml}
        `;

        tickEl.addEventListener('click', (e) => {
            e.stopPropagation();
            snapRulerToTick(i, true);
            triggerHaptic();
        });

        rulerTrack.appendChild(tickEl);
    }

    setupRulerEvents();
}

function updateRulerUI(val, index) {
    if (!timerSliderDisplay) return;
    if (val === 0) {
        timerSliderDisplay.innerHTML = `
            <span style="color: var(--accent-green); font-size: 2.15rem; font-weight: 700;">Foco Livre</span>
            <span style="font-size: 0.85rem; font-weight: 500; color: var(--text-secondary); margin-top: 4px;">Sem limite prévio &bull; até 180 min</span>
        `;
    } else {
        timerSliderDisplay.innerHTML = `
            <span style="font-size: 2.35rem; font-weight: 700;">${val} min</span>
        `;
    }

    if (rulerTrack) {
        const ticks = rulerTrack.querySelectorAll('.ruler-tick-item');
        ticks.forEach(t => {
            const idx = parseInt(t.dataset.idx);
            t.classList.toggle('active', idx === index);
        });
    }

    document.querySelectorAll('.preset-btn').forEach(btn => {
        btn.classList.toggle('active', parseInt(btn.dataset.preset) === val);
    });
}

function snapRulerToTick(index, animate = true) {
    if (!rulerViewport || !rulerTrack) return;
    const W = rulerViewport.offsetWidth || 320;
    const X_c = W / 2;
    currentTrackX = X_c - (index * TICK_SPACING);

    if (animate) {
        rulerTrack.style.transition = 'transform 0.28s cubic-bezier(0.25, 1, 0.5, 1)';
    } else {
        rulerTrack.style.transition = 'none';
    }
    rulerTrack.style.transform = `translateX(${currentTrackX}px)`;

    const val = index * 5;
    currentRulerVal = val;
    updateRulerUI(val, index);
}

function setupRulerEvents() {
    if (!rulerViewport) return;

    const onPointerDown = (e) => {
        isRulerDragging = true;
        rulerStartX = e.clientX;
        rulerStartTrackX = currentTrackX;
        rulerTrack.style.transition = 'none';
        try {
            rulerViewport.setPointerCapture(e.pointerId);
        } catch (err) {}
        // Aciona vibração imediatamente ao tocar (User Activation essencial no Android)
        triggerHaptic(true);
    };

    const onPointerMove = (e) => {
        if (!isRulerDragging) return;
        const deltaX = e.clientX - rulerStartX;
        let newX = rulerStartTrackX + deltaX;

        const W = rulerViewport.offsetWidth || 320;
        const X_c = W / 2;
        const maxX = X_c;
        const minX = X_c - ((TOTAL_TICKS - 1) * TICK_SPACING);

        // Resistência elástica nas pontas
        if (newX > maxX) {
            newX = maxX + (newX - maxX) * 0.25;
        } else if (newX < minX) {
            newX = minX + (newX - minX) * 0.25;
        }

        currentTrackX = newX;
        rulerTrack.style.transform = `translateX(${currentTrackX}px)`;

        // Calcular tick sob a agulha central
        const rawIdx = (X_c - currentTrackX) / TICK_SPACING;
        const clampedIdx = Math.max(0, Math.min(TOTAL_TICKS - 1, Math.round(rawIdx)));
        const val = clampedIdx * 5;

        if (val !== currentRulerVal) {
            currentRulerVal = val;
            updateRulerUI(val, clampedIdx);
            triggerHaptic(val % 15 === 0);
        }
    };

    const onPointerUp = (e) => {
        if (!isRulerDragging) return;
        isRulerDragging = false;
        try {
            rulerViewport.releasePointerCapture(e.pointerId);
        } catch (err) {}

        const W = rulerViewport.offsetWidth || 320;
        const X_c = W / 2;
        const rawIdx = (X_c - currentTrackX) / TICK_SPACING;
        const clampedIdx = Math.max(0, Math.min(TOTAL_TICKS - 1, Math.round(rawIdx)));
        snapRulerToTick(clampedIdx, true);
    };

    rulerViewport.addEventListener('pointerdown', onPointerDown);
    rulerViewport.addEventListener('pointermove', onPointerMove);
    rulerViewport.addEventListener('pointerup', onPointerUp);
    rulerViewport.addEventListener('pointercancel', onPointerUp);

    // Suporte a scroll com mouse wheel
    rulerViewport.addEventListener('wheel', (e) => {
        e.preventDefault();
        const delta = Math.sign(e.deltaX || e.deltaY);
        const currentIdx = Math.round(currentRulerVal / 5);
        const newIdx = Math.max(0, Math.min(TOTAL_TICKS - 1, currentIdx + delta));
        if (newIdx !== currentIdx) {
            snapRulerToTick(newIdx, true);
            triggerHaptic(true);
        }
    }, { passive: false });

    // Botões de preset rápido
    document.querySelectorAll('.preset-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const val = parseInt(btn.dataset.preset);
            const idx = val / 5;
            snapRulerToTick(idx, true);
            triggerHaptic(true);
        });
    });
}

// Abrir modal da régua
if (timerCircle) {
    timerCircle.addEventListener('click', () => {
        if (!isTimerRunning) {
            const currentVal = parseInt(timerInput.value) || 0;
            currentRulerVal = currentVal;
            timerModal.classList.remove('hidden');
            setTimeout(() => {
                const idx = Math.round(currentVal / 5);
                snapRulerToTick(idx, false);
            }, 50);
        }
    });
}

// Confirmar tempo na régua
if (timerSliderConfirmBtn) {
    timerSliderConfirmBtn.addEventListener('click', () => {
        timerInput.value = currentRulerVal;
        totalTimerSeconds = currentRulerVal * 60;
        timeLeft = totalTimerSeconds;
        elapsedSeconds = 0;
        updateTimeDisplay();
        timerModal.classList.add('hidden');
    });
}

if (timerModal) {
    timerModal.addEventListener('click', (e) => {
        if (e.target === timerModal) {
            timerModal.classList.add('hidden');
        }
    });
}

// === Motor do Temporizador (Contagem Regressiva e Modo Livre / Cronômetro Crescente) ===
let timerInterval;
let totalTimerSeconds = parseInt(timerInput.value) * 60;
let timeLeft = totalTimerSeconds;
let elapsedSeconds = 0;
let focusStartTs = 0;
let isTimerRunning = false;
let isCancelPeriod = false;
let cancelTimeout;

function updateTimeDisplay() {
    const isStopwatch = parseInt(timerInput.value) === 0;

    if (isStopwatch) {
        // MODO LIVRE (CRONÔMETRO CRESCENTE ATÉ 180 MIN)
        timerCircle.classList.toggle('stopwatch-running', isTimerRunning);
        timerSublabel.textContent = 'Modo Livre';
        focusDescText.textContent = isTimerRunning
            ? 'Foco Livre ativo. Contabilizando seu tempo...'
            : 'Sem limite predefinido. O relógio contabilizará até 180 min.';

        const currentSecs = isTimerRunning ? elapsedSeconds : 0;
        const mins = Math.floor(currentSecs / 60);
        const secs = currentSecs % 60;

        if (currentSecs < 3600) {
            timeDisplay.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        } else {
            const hrs = Math.floor(currentSecs / 3600);
            const remMins = Math.floor((currentSecs % 3600) / 60);
            timeDisplay.textContent = `${hrs}:${remMins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        }

        // Esquema de movimento para o Modo Livre:
        // O anel e a bolinha viajam proporcionalmente à meta de 180 min (10800s)
        const progress = Math.min(1, currentSecs / (180 * 60));
        const offset = CIRCUMFERENCE * (1 - progress);
        if (timerProgressRing) timerProgressRing.style.strokeDashoffset = offset;
        const angle = progress * 360;
        if (timerDotGroup) timerDotGroup.style.transform = `rotate(${angle}deg)`;

    } else {
        // MODO CONTAGEM REGRESSIVA (TEMPO FIXO ESCOLHIDO NA RÉGUA)
        timerCircle.classList.remove('stopwatch-running');
        const chosenMins = parseInt(timerInput.value) || 25;
        timerSublabel.textContent = '';
        focusDescText.textContent = '';

        const minutes = Math.floor(timeLeft / 60);
        const seconds = timeLeft % 60;
        timeDisplay.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

        const total = (totalTimerSeconds > 0) ? totalTimerSeconds : (chosenMins * 60);
        const elapsed = Math.max(0, total - timeLeft);
        const progress = total > 0 ? (elapsed / total) : 0;

        const offset = CIRCUMFERENCE * (1 - progress);
        if (timerProgressRing) timerProgressRing.style.strokeDashoffset = offset;
        const angle = progress * 360;
        if (timerDotGroup) timerDotGroup.style.transform = `rotate(${angle}deg)`;
    }
}

// Função central para registrar sessão de foco
function recordFocusSession(minutes, seconds) {
    if (minutes <= 0) return;
    if (window.currentFocusHabitId) {
        const habit = state.habits.find(h => h.id === window.currentFocusHabitId);
        if (habit) {
            if (!Array.isArray(habit.sessions)) habit.sessions = [];
            habit.sessions.push({
                id: Date.now().toString(),
                date: todayStr,
                minutes: minutes,
                seconds: seconds,
                timestamp: Date.now()
            });
            habit.records[todayStr] = true;
            habit.totalFocusTime = (habit.totalFocusTime || 0) + minutes;
            saveState();
            renderViews();
            updateFocusHabitDisplay();
        }
    } else {
        if (!Array.isArray(state.generalFocus)) state.generalFocus = [];
        state.generalFocus.push({
            id: Date.now().toString(),
            date: todayStr,
            minutes: minutes,
            seconds: seconds,
            timestamp: Date.now()
        });
        saveState();
        renderViews();
    }
}

// Feedback de conclusão: mensagem com minutos e nome do hábito (alerta no app + notificação)
function notifyFocusCompleted(minutes, tag) {
    const habit = window.currentFocusHabitId
        ? state.habits.find(h => h.id === window.currentFocusHabitId)
        : null;
    const habitPart = habit ? ` em "${habit.name}"` : '';
    const message = `Parabéns! Você ficou ${minutes} min em foco${habitPart}! 🎉`;
    showAppNotification('Foco concluído! 🎯', { body: message, tag });
    customAlert(message);
}

function resetTimerState() {
    pushFocusCancel();
    clearInterval(timerInterval);
    clearTimeout(cancelTimeout);
    focusStartTs = 0;
    isTimerRunning = false;
    isCancelPeriod = false;
    elapsedSeconds = 0;
    startTimerBtn.textContent = 'Iniciar Foco';
    startTimerBtn.classList.remove('btn-danger', 'btn-finish-focus');
    timerInput.disabled = false;
    if (timerProgressRing) timerProgressRing.style.transition = 'stroke-dashoffset 0.3s ease';
    if (timerDotGroup) timerDotGroup.style.transition = 'transform 0.3s ease';

    const chosenMins = parseInt(timerInput.value) || 0;
    if (chosenMins === 0) {
        timeLeft = 0;
    } else {
        totalTimerSeconds = chosenMins * 60;
        timeLeft = totalTimerSeconds;
    }
    updateTimeDisplay();
}

startTimerBtn.addEventListener('click', () => {
    const isStopwatch = parseInt(timerInput.value) === 0;

    if (isTimerRunning) {
        if (isCancelPeriod) {
            // Cancelar dentro dos 10s iniciais sem registrar
            resetTimerState();
        } else {
            if (isStopwatch) {
                // No modo Livre, o botão é "Finalizar Foco" e REGISTRA o tempo focado!
                const minsFocused = Math.max(1, Math.round(elapsedSeconds / 60));
                recordFocusSession(minsFocused, elapsedSeconds);

                notifyFocusCompleted(minsFocused, 'focus-stopwatch-completed');
                resetTimerState();

            } else {
                // Modo contagem regressiva: desistir ou salvar tempo decorrido
                const elapsedSecs = totalTimerSeconds - timeLeft;
                const elapsedMins = Math.round(elapsedSecs / 60);

                if (elapsedMins >= 1) {
                    customConfirm(`Deseja salvar os ${elapsedMins} min de foco realizados até agora?`, (save) => {
                        if (save) {
                            recordFocusSession(elapsedMins, elapsedSecs);
                            notifyFocusCompleted(elapsedMins, 'focus-partial-completed');
                        }
                        resetTimerState();
                    });
                } else {
                    customConfirm('Tem certeza que deseja desistir? Menos de 1 min foi focado e não será registrado.', (confirmed) => {
                        if (confirmed) {
                            resetTimerState();
                        }
                    });
                }
            }
        }
    } else {
        // INICIAR TEMPORIZADOR
        if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission();
        }

        isTimerRunning = true;
        isCancelPeriod = true;
        elapsedSeconds = 0;
        startTimerBtn.textContent = 'Cancelar (5s)';
        startTimerBtn.classList.remove('btn-danger', 'btn-finish-focus');
        timerInput.disabled = true;

        if (timerProgressRing) timerProgressRing.style.transition = 'stroke-dashoffset 0.9s linear';
        if (timerDotGroup) timerDotGroup.style.transition = 'transform 0.9s linear';

        let cancelSeconds = 5;
        const cancelTextInterval = setInterval(() => {
            if (isCancelPeriod) {
                cancelSeconds--;
                if (cancelSeconds > 0) {
                    startTimerBtn.textContent = `Cancelar (${cancelSeconds}s)`;
                } else {
                    clearInterval(cancelTextInterval);
                }
            } else {
                clearInterval(cancelTextInterval);
            }
        }, 1000);

        cancelTimeout = setTimeout(() => {
            if (isTimerRunning) {
                isCancelPeriod = false;
                if (isStopwatch) {
                    startTimerBtn.textContent = 'Finalizar Foco';
                    startTimerBtn.classList.add('btn-finish-focus');
                } else {
                    startTimerBtn.textContent = 'Desistir';
                    startTimerBtn.classList.add('btn-danger');
                }
            }
        }, 5000);

        if (isStopwatch) {
            // Cronômetro Crescente (Modo Livre até 180 min = 10800s)
            // Baseado no relógio real: continua correto mesmo com a tela bloqueada
            focusStartTs = Date.now();
            timerInterval = setInterval(tickFocusTimer, 1000);

        } else {
            // Contagem Regressiva (Tempo definido na régua)
            totalTimerSeconds = parseInt(timerInput.value) * 60;
            timeLeft = totalTimerSeconds;
            focusStartTs = Date.now();
            timerInterval = setInterval(tickFocusTimer, 1000);
            pushFocusStart(parseInt(timerInput.value));
        }
    }
});

// Atualiza o temporizador a partir do relógio real (não conta ticks do setInterval,
// que são pausados pelo navegador quando a tela do celular é bloqueada)
function tickFocusTimer() {
    if (!isTimerRunning || !focusStartTs) return;
    const isStopwatch = parseInt(timerInput.value) === 0;
    const realElapsed = Math.max(0, Math.floor((Date.now() - focusStartTs) / 1000));

    if (isStopwatch) {
        elapsedSeconds = Math.min(realElapsed, 180 * 60);
        updateTimeDisplay();

        if (realElapsed >= 180 * 60) {
            clearInterval(timerInterval);
            recordFocusSession(180, 180 * 60);
            notifyFocusCompleted(180, 'focus-max-reached');
            resetTimerState();
        }
    } else {
        elapsedSeconds = realElapsed;
        timeLeft = Math.max(0, totalTimerSeconds - realElapsed);
        updateTimeDisplay();

        if (timeLeft <= 0) {
            clearInterval(timerInterval);
            const chosenMins = parseInt(timerInput.value) || 25;
            recordFocusSession(chosenMins, chosenMins * 60);

            notifyFocusCompleted(chosenMins, 'focus-completed');

            resetTimerState();
        }
    }
}

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') tickFocusTimer();
});

// Inicialização
function initApp() {
    document.getElementById('main-date-title').textContent = `Hoje, ${today.getDate()} de ${today.toLocaleString('pt-BR', { month: 'short' }).replace('.', '')}`;
    loadState();
    renderViews();
    initRuler();
    initCustomTimePickerEvents();
    initDaysSelectorEvents();
    initAlarmScreenEvents();
    updateFocusHabitDisplay();
    updateTimeDisplay();
    switchTab(0, false);
    setupBackupHandlers();
    checkUrlAlarmParams();
    syncPushSchedule();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}

// === Modal de Diálogo Customizado (Alert / Confirm) ===
function customConfirm(message, callback) {
    const dialog = document.getElementById('custom-dialog-modal');
    const msgEl = document.getElementById('custom-dialog-message');
    const cancelBtn = document.getElementById('custom-dialog-cancel-btn');
    const confirmBtn = document.getElementById('custom-dialog-confirm-btn');
    
    msgEl.textContent = message;
    cancelBtn.style.display = 'block';
    
    // Clonar para remover event listeners antigos
    const newConfirm = confirmBtn.cloneNode(true);
    const newCancel = cancelBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newConfirm, confirmBtn);
    cancelBtn.parentNode.replaceChild(newCancel, cancelBtn);
    
    newConfirm.addEventListener('click', () => {
        dialog.classList.add('hidden');
        if (callback) callback(true);
    });
    
    newCancel.addEventListener('click', () => {
        dialog.classList.add('hidden');
        if (callback) callback(false);
    });
    
    dialog.classList.remove('hidden');
}

function customAlert(message) {
    const dialog = document.getElementById('custom-dialog-modal');
    const msgEl = document.getElementById('custom-dialog-message');
    const cancelBtn = document.getElementById('custom-dialog-cancel-btn');
    const confirmBtn = document.getElementById('custom-dialog-confirm-btn');
    
    msgEl.textContent = message;
    cancelBtn.style.display = 'none';
    
    // Clonar para remover event listeners antigos
    const newConfirm = confirmBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newConfirm, confirmBtn);
    
    newConfirm.addEventListener('click', () => {
        dialog.classList.add('hidden');
    });
    
    dialog.classList.remove('hidden');
}

// === Sistema de Notificações Unificado (Suporte PWA / Android Mobile) ===
async function showAppNotification(title, options = {}) {
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;

    const defaultOptions = {
        icon: './icon-192.png',
        badge: './icon-192.png',
        vibrate: [200, 100, 200],
        ...options
    };

    if ('serviceWorker' in navigator) {
        try {
            const reg = await navigator.serviceWorker.ready;
            if (reg && reg.showNotification) {
                await reg.showNotification(title, defaultOptions);
                return;
            }
        } catch (e) {
            console.warn('Falha ao exibir notificacao via Service Worker:', e);
        }
    }

    try {
        new Notification(title, defaultOptions);
    } catch (e) {
        console.warn('Falha no construtor Notification:', e);
    }
}

// === Sistema de Alarme em Tela Cheia (Full-Screen Mobile Alarm) ===
let activeAlarmHabit = null;
let alarmAudioLoopInterval = null;
let alarmVibrateLoopInterval = null;
let alarmClockInterval = null;
let toastTimeout = null;

function showAppToast(message, iconClass = 'fa-circle-check') {
    const toast = document.getElementById('app-toast');
    const msgEl = document.getElementById('app-toast-msg');
    const iconEl = document.getElementById('app-toast-icon');
    if (!toast || !msgEl) return;

    if (toastTimeout) clearTimeout(toastTimeout);
    msgEl.textContent = message;
    if (iconEl) iconEl.className = `fa-solid ${iconClass}`;
    toast.classList.remove('hidden');

    toastTimeout = setTimeout(() => {
        toast.classList.add('hidden');
    }, 3400);
}

// Síntese de áudio para som melodioso de despertar/alarme sem depender de arquivos externos
function playMelodicAlarmBeep() {
    try {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }

        const now = audioCtx.currentTime;
        // Padrão de 4 notas alegres e chamativas (E5, G#5, B5, E6)
        const notes = [659.25, 830.61, 987.77, 1318.51];
        notes.forEach((freq, idx) => {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            const startTime = now + (idx * 0.12);
            const endTime = startTime + 0.18;

            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, startTime);

            gain.gain.setValueAtTime(0, startTime);
            gain.gain.linearRampToValueAtTime(0.08, startTime + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.0001, endTime);

            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.start(startTime);
            osc.stop(endTime);
        });
    } catch (e) {
        console.warn('Falha no áudio do alarme:', e);
    }
}

function playSuccessMelody() {
    try {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
        const now = audioCtx.currentTime;
        // Fanfarra triunfal de comemoração: C5, E5, G5, C6
        const notes = [523.25, 659.25, 783.99, 1046.50];
        notes.forEach((freq, idx) => {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            const startTime = now + (idx * 0.08);
            const duration = idx === 3 ? 0.6 : 0.25;

            osc.type = 'triangle';
            osc.frequency.setValueAtTime(freq, startTime);

            gain.gain.setValueAtTime(0, startTime);
            gain.gain.linearRampToValueAtTime(0.09, startTime + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.start(startTime);
            osc.stop(startTime + duration);
        });
    } catch (e) {}
}

function updateAlarmLiveClock() {
    const clockEl = document.getElementById('alarm-clock-display');
    const dateEl = document.getElementById('alarm-date-display');
    if (!clockEl || !dateEl) return;

    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    clockEl.textContent = `${hh}:${mm}`;

    // Estilo idêntico à imagem de referência: "qua., outubro 14"
    const weekdays = ['dom.', 'seg.', 'ter.', 'qua.', 'qui.', 'sex.', 'sáb.'];
    const months = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
    const wd = weekdays[now.getDay()];
    const mo = months[now.getMonth()];
    dateEl.textContent = `${wd}, ${mo} ${now.getDate()}`;
}

let alarmSnoozeMinutes = 10;

function updateSnoozeDurationUI() {
    const snoozeText = document.getElementById('alarm-snooze-text');
    if (snoozeText) {
        snoozeText.textContent = `Adiar ${alarmSnoozeMinutes} minutos`;
    }
}

function stopAlarmSoundAndVibration() {
    if (alarmAudioLoopInterval) {
        clearInterval(alarmAudioLoopInterval);
        alarmAudioLoopInterval = null;
    }
    if (alarmVibrateLoopInterval) {
        clearInterval(alarmVibrateLoopInterval);
        alarmVibrateLoopInterval = null;
    }
    if (alarmClockInterval) {
        clearInterval(alarmClockInterval);
        alarmClockInterval = null;
    }
    if ('vibrate' in navigator) {
        try {
            navigator.vibrate(0);
        } catch (e) {}
    }
}

function triggerAlarmScreen(habit) {
    if (!habit) return;
    activeAlarmHabit = habit;

    const alarmModal = document.getElementById('full-alarm-modal');
    const habitNameEl = document.getElementById('alarm-habit-name');
    const iconEl = document.getElementById('alarm-habit-icon');
    const iconCircle = document.getElementById('alarm-habit-icon-circle');
    const glowEl = document.getElementById('alarm-backdrop-glow');

    if (!alarmModal) return;

    // Customizar visual com a cor e ícone do hábito
    const habitColor = habit.color || '#34d399';
    alarmModal.style.setProperty('--alarm-accent', habitColor);
    alarmModal.style.setProperty('--alarm-accent-bg', habitColor + '28');
    alarmModal.style.setProperty('--alarm-accent-glow', habitColor + '40');

    if (habitNameEl) habitNameEl.textContent = habit.name || 'Meu Hábito';
    if (iconEl) iconEl.className = `fa-solid ${habit.icon || 'fa-bell'}`;
    if (iconCircle) {
        iconCircle.style.color = habitColor;
        iconCircle.style.borderColor = habitColor;
        iconCircle.style.transition = 'none';
        iconCircle.style.transform = 'translate(0px, 0px)';
        iconCircle.classList.remove('is-dragging', 'ready-to-confirm');
    }
    const targetZone = document.getElementById('alarm-target-zone');
    if (targetZone) targetZone.classList.remove('active-target');
    if (glowEl) {
        glowEl.style.background = `radial-gradient(circle, ${habitColor} 0%, transparent 70%)`;
    }

    alarmSnoozeMinutes = 10;
    updateSnoozeDurationUI();

    updateAlarmLiveClock();
    if (alarmClockInterval) clearInterval(alarmClockInterval);
    alarmClockInterval = setInterval(updateAlarmLiveClock, 1000);

    // Iniciar som e vibração contínuos
    stopAlarmSoundAndVibration();
    playMelodicAlarmBeep();
    alarmAudioLoopInterval = setInterval(playMelodicAlarmBeep, 2000);

    if ('vibrate' in navigator) {
        try {
            navigator.vibrate([400, 150, 400, 150, 600]);
            alarmVibrateLoopInterval = setInterval(() => {
                try {
                    navigator.vibrate([400, 150, 400, 150, 600]);
                } catch (e) {}
            }, 2600);
        } catch (e) {}
    }

    alarmModal.classList.remove('hidden');
}

function dismissAlarmScreen() {
    stopAlarmSoundAndVibration();
    const alarmModal = document.getElementById('full-alarm-modal');
    if (alarmModal) alarmModal.classList.add('hidden');
    activeAlarmHabit = null;
}

function completeHabitFromAlarm() {
    if (!activeAlarmHabit) {
        dismissAlarmScreen();
        return;
    }

    const habit = activeAlarmHabit;
    dismissAlarmScreen();

    // Se for modo preview/teste
    if (habit.isPreview) {
        playSuccessMelody();
        triggerHaptic(true);
        showAppToast('Teste de alarme concluído com sucesso! 🎉', 'fa-circle-check');
        return;
    }

    const todayDateStr = formatDate(new Date());
    habit.records[todayDateStr] = true;
    delete habit.snoozedUntil;
    saveState();
    renderViews();

    playSuccessMelody();
    triggerHaptic(true);
    showAppToast(`"${habit.name}" marcado como concluído! 🎉`, 'fa-circle-check');
}

function snoozeHabitFromAlarm() {
    if (!activeAlarmHabit) {
        dismissAlarmScreen();
        return;
    }

    const habit = activeAlarmHabit;
    dismissAlarmScreen();

    if (habit.isPreview) {
        showAppToast(`Lembrete adiado por ${alarmSnoozeMinutes} minutos (modo de teste) ⏰`, 'fa-clock-rotate-left');
        return;
    }

    // Adiar pelos minutos selecionados a partir de agora
    const snoozeTime = new Date(Date.now() + alarmSnoozeMinutes * 60 * 1000);
    habit.snoozedUntil = snoozeTime.getTime();
    saveState();

    const hh = String(snoozeTime.getHours()).padStart(2, '0');
    const mm = String(snoozeTime.getMinutes()).padStart(2, '0');
    showAppToast(`Lembrete adiado para as ${hh}:${mm} (${alarmSnoozeMinutes} min) ⏰`, 'fa-clock-rotate-left');
}

function initAlarmScreenEvents() {
    const habitCircle = document.getElementById('alarm-habit-icon-circle');
    const targetZone = document.getElementById('alarm-target-zone');
    const snoozeBtn = document.getElementById('alarm-action-snooze');
    const snoozeMinus = document.getElementById('alarm-snooze-minus');
    const snoozePlus = document.getElementById('alarm-snooze-plus');
    const dismissBtn = document.getElementById('alarm-action-dismiss');

    if (snoozeMinus) {
        snoozeMinus.addEventListener('click', (e) => {
            e.stopPropagation();
            if (alarmSnoozeMinutes > 5) {
                alarmSnoozeMinutes -= 5;
                updateSnoozeDurationUI();
                triggerHaptic();
            }
        });
    }

    if (snoozePlus) {
        snoozePlus.addEventListener('click', (e) => {
            e.stopPropagation();
            if (alarmSnoozeMinutes < 60) {
                alarmSnoozeMinutes += 5;
                updateSnoozeDurationUI();
                triggerHaptic();
            }
        });
    }

    if (snoozeBtn) {
        snoozeBtn.addEventListener('click', snoozeHabitFromAlarm);
    }
    if (dismissBtn) {
        dismissBtn.addEventListener('click', dismissAlarmScreen);
    }

    if (!habitCircle) return;

    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let currentDist = 0;
    let hasAlertedReady = false;
    const CONFIRM_THRESHOLD = 60; // Pixels de distância do centro para confirmar a tarefa

    const onPointerDown = (e) => {
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        currentDist = 0;
        hasAlertedReady = false;
        habitCircle.classList.add('is-dragging');
        habitCircle.style.transition = 'none';
        try {
            habitCircle.setPointerCapture(e.pointerId);
        } catch (err) {}
        triggerHaptic(true);
    };

    const onPointerMove = (e) => {
        if (!isDragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        currentDist = Math.hypot(dx, dy);

        // Move a bola acompanhando o dedo
        habitCircle.style.transform = `translate(${dx}px, ${dy}px) scale(${1 + Math.min(0.18, currentDist / 320)})`;

        const isReady = currentDist >= CONFIRM_THRESHOLD;
        if (targetZone) targetZone.classList.toggle('active-target', isReady);
        habitCircle.classList.toggle('ready-to-confirm', isReady);

        if (isReady && !hasAlertedReady) {
            hasAlertedReady = true;
            triggerHaptic(true);
        } else if (!isReady && hasAlertedReady) {
            hasAlertedReady = false;
        }
    };

    const onPointerUp = (e) => {
        if (!isDragging) return;
        isDragging = false;
        try {
            habitCircle.releasePointerCapture(e.pointerId);
        } catch (err) {}

        habitCircle.classList.remove('is-dragging');

        if (currentDist >= CONFIRM_THRESHOLD) {
            // Arrastou para fora com sucesso: conclui o hábito!
            completeHabitFromAlarm();
        } else {
            // Soltou antes de atingir o limiar: retorna com elasticidade suave ao centro
            habitCircle.style.transition = 'transform 0.35s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
            habitCircle.style.transform = 'translate(0px, 0px)';
            if (targetZone) targetZone.classList.remove('active-target');
            habitCircle.classList.remove('ready-to-confirm');
        }
        currentDist = 0;
        hasAlertedReady = false;
    };

    habitCircle.addEventListener('pointerdown', onPointerDown);
    habitCircle.addEventListener('pointermove', onPointerMove);
    habitCircle.addEventListener('pointerup', onPointerUp);
    habitCircle.addEventListener('pointercancel', onPointerUp);
}

// === Verificador de Alarmes (Notificações e Tela Cheia) ===
setInterval(checkAlarms, 3000); // Roda a cada 3 segundos

function checkAlarms() {
    const now = new Date();
    const currentHr = String(now.getHours()).padStart(2, '0');
    const currentMin = String(now.getMinutes()).padStart(2, '0');
    const timeStr = `${currentHr}:${currentMin}`;
    const currentMinutesOfDay = now.getHours() * 60 + now.getMinutes();

    const todayJsDay = now.getDay();
    const todayDateStr = formatDate(now);
    const nowTimestamp = now.getTime();

    let changed = false;

    state.habits.forEach(habit => {
        if (!habit.reminderEnabled) return;

        // "Forçar hoje" só vale no dia em que o hábito foi salvo
        if (habit.forceAlarmToday && habit.forceAlarmDate !== todayDateStr) {
            delete habit.forceAlarmToday;
            changed = true;
        }

        // Verificar se é dia ativo e não foi completado hoje (permitir se forceAlarmToday estiver ativo para teste)
        const isDayActive = habit.activeDays && habit.activeDays.includes(todayJsDay);
        const isAlreadyDone = Boolean(habit.records && habit.records[todayDateStr]);

        if (!isDayActive && !habit.forceAlarmToday) return;
        if (isAlreadyDone && !habit.forceAlarmToday) return;

        let shouldTrigger = false;

        // 1. Verificar se estava em modo soneca (adiado por 10 min)
        if (habit.snoozedUntil && nowTimestamp >= habit.snoozedUntil) {
            shouldTrigger = true;
            delete habit.snoozedUntil;
            changed = true;
        } else if (habit.reminderTime) {
            // 2. Horário normal do lembrete diário
            const [rHr, rMin] = habit.reminderTime.split(':').map(Number);
            const reminderMinutes = rHr * 60 + rMin;
            const isExactTime = habit.reminderTime === timeStr;
            // Janela de recuperação: se o app estava fechado/suspenso na hora exata,
            // dispara assim que for aberto, até o fim do dia
            const isRecentWindow = currentMinutesOfDay >= reminderMinutes;
            const alarmKey = `${todayDateStr}_${habit.reminderTime}`;

            if ((isExactTime || isRecentWindow) && habit.lastNotifiedKey !== alarmKey) {
                shouldTrigger = true;
                habit.lastNotifiedKey = alarmKey;
                habit.lastNotified = todayDateStr;
                delete habit.forceAlarmToday;
                changed = true;
            }
        }

        if (shouldTrigger) {
            // Exibir Alarme de Tela Cheia no App
            triggerAlarmScreen(habit);

            // Exibir Notificação no Sistema/Service Worker com botões de ação
            if ('Notification' in window && Notification.permission === 'granted') {
                showAppNotification(`Lembrete: ${habit.name}`, {
                    body: `Hora de cumprir sua meta: ${habit.name}! Toque para ver o alarme.`,
                    tag: `reminder-${habit.id}-${todayDateStr}-${habit.reminderTime || ''}`,
                    data: { habitId: habit.id },
                    actions: [
                        { action: 'done', title: '✓ Marcar Concluído' },
                        { action: 'snooze', title: '⏱ Adiar 10 min' }
                    ]
                });
            }
        }
    });

    if (changed) saveState();
}

setTimeout(checkAlarms, 1000);
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        // Se o app ficou aberto/em memória durante a virada do dia, recarrega para atualizar "hoje"
        if (formatDate(new Date()) !== todayStr) {
            window.location.reload();
            return;
        }
        checkAlarms();
    }
});

// Dia virou com o app aberto em primeiro plano
setInterval(() => {
    if (formatDate(new Date()) !== todayStr && !isTimerRunning) {
        window.location.reload();
    }
}, 60000);

// Suporte a mensagens do Service Worker e parâmetros na URL
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'NOTIFICATION_ACTION') {
            const { action, habitId } = event.data;
            const habit = state.habits.find(h => h.id === habitId);
            if (habit) {
                if (action === 'done') {
                    activeAlarmHabit = habit;
                    completeHabitFromAlarm();
                } else if (action === 'snooze') {
                    activeAlarmHabit = habit;
                    snoozeHabitFromAlarm();
                } else {
                    triggerAlarmScreen(habit);
                }
            }
        }
    });
}

function checkUrlAlarmParams() {
    try {
        const urlParams = new URLSearchParams(window.location.search);
        const alarmHabitId = urlParams.get('alarmHabitId');
        const action = urlParams.get('action');

        if (alarmHabitId) {
            const habit = state.habits.find(h => h.id === alarmHabitId);
            if (habit) {
                if (action === 'done') {
                    activeAlarmHabit = habit;
                    completeHabitFromAlarm();
                } else if (action === 'snooze') {
                    activeAlarmHabit = habit;
                    snoozeHabitFromAlarm();
                } else {
                    triggerAlarmScreen(habit);
                }
            }
            window.history.replaceState({}, document.title, window.location.pathname);
        }
    } catch (e) {}
}

// === Transição Gradual ao Deslizar Entre Abas (Estilo Celulares Samsung) ===
// Suporta deslizar em qualquer espaço em branco da tela (inclusive abaixo de um único hábito)
let dragStartX = 0;
let dragStartY = 0;
let dragCurrentX = 0;
let dragStartTime = 0;
let isHorizontalDrag = null;
let isTouchActive = false;

const swipeContainer = document.querySelector('.app-container') || tabViewport;

if (swipeContainer) {
    swipeContainer.addEventListener('touchstart', (e) => {
        // Ignora gestos se qualquer modal estiver aberto
        const modal = document.getElementById('habit-modal');
        const tModal = document.getElementById('timer-slider-modal');
        const cModal = document.getElementById('custom-dialog-modal');
        const bModal = document.getElementById('backup-modal');
        const aModal = document.getElementById('full-alarm-modal');
        const fModal = document.getElementById('focus-habit-select-modal');
        if (modal && !modal.classList.contains('hidden')) return;
        if (tModal && !tModal.classList.contains('hidden')) return;
        if (cModal && !cModal.classList.contains('hidden')) return;
        if (bModal && !bModal.classList.contains('hidden')) return;
        if (aModal && !aModal.classList.contains('hidden')) return;
        if (fModal && !fModal.classList.contains('hidden')) return;

        if (isDraggingHabit) return;

        // Não interceptar cliques no header, abas, botões de ação, inputs ou drag handle
        if (e.target.closest('.app-header, .tabs, .fab-btn, button, input, select, textarea, .day-box, .picker-item, .color-item, .time-adjust-btn, .preset-btn, .time-preset-pill, .ruler-viewport, .month-nav-header, .drag-handle')) return;

        const touch = e.touches[0];
        dragStartX = touch.clientX;
        dragStartY = touch.clientY;
        dragCurrentX = dragStartX;
        dragStartTime = Date.now();
        isHorizontalDrag = null;
        isTouchActive = true;
    }, { passive: true });

    window.addEventListener('touchmove', (e) => {
        if (!isTouchActive) return;

        const touch = e.touches[0];
        dragCurrentX = touch.clientX;
        const deltaX = dragCurrentX - dragStartX;
        const deltaY = touch.clientY - dragStartY;

        // Determina se o gesto é primariamente horizontal após pequeno limiar
        if (isHorizontalDrag === null) {
            if (Math.abs(deltaX) > 8 || Math.abs(deltaY) > 8) {
                isHorizontalDrag = Math.abs(deltaX) > Math.abs(deltaY);
            }
        }

        // Se for deslizamento horizontal, move as telas gradativamente em tempo real
        if (isHorizontalDrag) {
            if (e.cancelable) e.preventDefault();

            const W = tabViewport.offsetWidth || window.innerWidth;
            const pageSpan = W + TAB_GAP;
            let effectiveDelta = deltaX;

            // Efeito elástico (rubber-band) nas extremidades para evitar puxar além dos limites
            if ((currentTabIndex === 0 && deltaX > 0) || (currentTabIndex === tabBtns.length - 1 && deltaX < 0)) {
                effectiveDelta = deltaX * 0.28;
            }

            // Move o track das abas em tempo real acompanhando o dedo com espaçamento
            const baseOffset = -currentTabIndex * pageSpan;
            const currentOffset = baseOffset + effectiveDelta;
            if (tabTrack) {
                tabTrack.style.transition = 'none';
                tabTrack.style.transform = `translateX(${currentOffset}px)`;
            }

            // Move a barrinha indicadora das abas sincronizada com o dedo
            if (tabIndicator && tabBtns.length > 0) {
                const progress = -currentOffset / pageSpan;
                const clampedProgress = Math.max(0, Math.min(tabBtns.length - 1, progress));
                tabIndicator.style.transition = 'none';
                updateTabIndicator(clampedProgress);
            }

            // Transição gradual de altura ao deslizar entre abas adjacentes
            if (currentTabIndex !== 2 && tabPages.length > 0) {
                const targetIdx = deltaX < 0 ? Math.min(tabBtns.length - 1, currentTabIndex + 1) : Math.max(0, currentTabIndex - 1);
                if (targetIdx !== 2) {
                    const hCurrent = Math.max(160, (tabPages[currentTabIndex].offsetHeight || 200) + 24);
                    const hTarget = Math.max(160, (tabPages[targetIdx].offsetHeight || 200) + 24);
                    const dragRatio = Math.min(1, Math.abs(effectiveDelta) / W);
                    const interpHeight = hCurrent + (hTarget - hCurrent) * dragRatio;
                    tabViewport.style.transition = 'none';
                    tabViewport.style.height = `${interpHeight}px`;
                }
            }
        }
    }, { passive: false });

    const finishSwipe = () => {
        if (!isTouchActive) return;
        isTouchActive = false;

        if (isHorizontalDrag) {
            const W = tabViewport.offsetWidth || window.innerWidth;
            const deltaX = dragCurrentX - dragStartX;
            const timeElapsed = Date.now() - dragStartTime;
            const velocity = deltaX / (timeElapsed || 1); // px por ms

            const distanceThreshold = W * 0.22; // 22% da largura da tela para confirmar
            const isFlick = Math.abs(velocity) > 0.35 && Math.abs(deltaX) > 30;

            if ((deltaX < -distanceThreshold || (isFlick && velocity < -0.35)) && currentTabIndex < tabBtns.length - 1) {
                // Deslizou para esquerda -> próxima aba
                switchTab(currentTabIndex + 1, true);
            } else if ((deltaX > distanceThreshold || (isFlick && velocity > 0.35)) && currentTabIndex > 0) {
                // Deslizou para direita -> aba anterior
                switchTab(currentTabIndex - 1, true);
            } else {
                // Não atingiu o limiar -> retorna suavemente para a aba atual (evita deslizes acidentais)
                switchTab(currentTabIndex, true);
            }
        }
        isHorizontalDrag = null;
    };

    window.addEventListener('touchend', finishSwipe, { passive: true });
    window.addEventListener('touchcancel', finishSwipe, { passive: true });
}

// === Backup & Restauração de Dados ===
function setupBackupHandlers() {
    const backupBtn = document.getElementById('backup-btn');
    const backupModal = document.getElementById('backup-modal');
    const closeBackupModalBtn = document.getElementById('close-backup-modal-btn');
    const exportBtn = document.getElementById('export-backup-btn');
    const importBtn = document.getElementById('import-backup-btn');
    const fileInput = document.getElementById('import-backup-file-input');

    if (!backupBtn || !backupModal) return;

    backupBtn.addEventListener('click', () => {
        backupModal.classList.remove('hidden');
    });

    if (closeBackupModalBtn) {
        closeBackupModalBtn.addEventListener('click', () => {
            backupModal.classList.add('hidden');
        });
    }

    backupModal.addEventListener('click', (e) => {
        if (e.target === backupModal) {
            backupModal.classList.add('hidden');
        }
    });

    if (exportBtn) {
        exportBtn.addEventListener('click', () => {
            try {
                const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state, null, 2));
                const downloadAnchor = document.createElement('a');
                downloadAnchor.setAttribute("href", dataStr);
                const d = new Date();
                const filename = `habit-tick-backup-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.json`;
                downloadAnchor.setAttribute("download", filename);
                document.body.appendChild(downloadAnchor);
                downloadAnchor.click();
                downloadAnchor.remove();
                if (typeof customAlert === 'function') {
                    customAlert('Backup exportado com sucesso! Salve este arquivo em um local seguro.');
                }
            } catch (err) {
                console.error('Erro ao exportar backup:', err);
                if (typeof customAlert === 'function') {
                    customAlert('Falha ao exportar backup.');
                }
            }
        });
    }

    if (importBtn && fileInput) {
        importBtn.addEventListener('click', () => {
            fileInput.click();
        });

        fileInput.addEventListener('change', (e) => {
            const file = e.target.files && e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const imported = JSON.parse(event.target.result);
                    if (!imported || !Array.isArray(imported.habits)) {
                        throw new Error('Arquivo de backup inválido.');
                    }

                    const confirmRestore = () => {
                        state = imported;
                        saveState();
                        renderViews();
                        backupModal.classList.add('hidden');
                        fileInput.value = '';
                        if (typeof customAlert === 'function') {
                            customAlert('Progresso restaurado com sucesso!');
                        }
                    };

                    if (typeof customConfirm === 'function') {
                        customConfirm('Deseja restaurar este backup? Os dados atuais serão substituídos pelos do arquivo.', (ok) => {
                            if (ok) confirmRestore();
                            else fileInput.value = '';
                        });
                    } else if (confirm('Deseja restaurar este backup? Os dados atuais serão substituídos.')) {
                        confirmRestore();
                    } else {
                        fileInput.value = '';
                    }
                } catch (err) {
                    console.error('Erro ao importar backup:', err);
                    if (typeof customAlert === 'function') {
                        customAlert('Erro ao ler o arquivo de backup. Certifique-se de que é um JSON válido exportado do Habit Tick.');
                    }
                    fileInput.value = '';
                }
            };
            reader.readAsText(file);
        });
    }
}
