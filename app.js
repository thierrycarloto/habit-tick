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

// Carregar estado inicial
function loadState() {
    const saved = localStorage.getItem('habitTickStateV2');
    if (saved) {
        state = JSON.parse(saved);
    } else {
        // Mock data inicial se estiver vazio
        state.habits = [
            {
                id: '1',
                name: 'Estudo',
                icon: 'fa-book-open',
                color: '#fca5a5',
                activeDays: [1, 2, 3, 4, 5], // Seg a Sex
                records: {}
            },
            {
                id: '2',
                name: 'Remédio',
                icon: 'fa-heart',
                color: '#fb7185',
                activeDays: [0, 1, 2, 3, 4, 5, 6], // Todos os dias
                records: {}
            }
        ];
        saveState();
    }
}

function saveState() {
    localStorage.setItem('habitTickStateV2', JSON.stringify(state));
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

// === Gerenciamento de Abas ===
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));

        const targetId = e.target.getAttribute('data-target');
        e.target.classList.add('active');
        document.getElementById(targetId).classList.remove('hidden');

        // Esconder o FAB apenas na aba Foco
        if (targetId === 'tab-foco') {
            document.getElementById('add-habit-btn').style.display = 'none';
        } else {
            document.getElementById('add-habit-btn').style.display = 'flex';
        }

        renderViews();
    });
});

// === Renderização ===
const weekDays = ['M', 'Tu', 'W', 'Th', 'F', 'Sa', 'Su'];
const weekDayMap = [1, 2, 3, 4, 5, 6, 0]; // JS Date.getDay(): 0 is Sunday, so map to match labels: M=1, Tu=2, ..., Su=0

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

        if (isActiveDay) {
            if (i === 0) { // Hoje
                if (isCompleted) {
                    streak++;
                }
                // Se hoje não completou ainda, a sequência não zera, apenas não soma
            } else {
                if (isCompleted) {
                    streak++;
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
                if (isCompleted) {
                    boxClasses += ' completed';
                    innerHtml = '<i class="fa-solid fa-check"></i>';
                }
                // Só o hoje é clicável para marcar/desmarcar
                if (!isToday) {
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

        let streakCountText = '';
        if (habit.type === 'tempo') {
            streakCountText = `${habit.totalFocusTime || 0} min focados`;
        } else {
            const streakCount = calculateStreak(habit);
            streakCountText = `Sequência: ${streakCount}`;
        }

        card.innerHTML = `
            <div class="habit-header">
                <div class="habit-icon-bg" style="background-color: ${habit.color}33;">
                    <i class="fa-solid ${habit.icon}" style="color: ${habit.color};"></i>
                </div>
                <div class="habit-info">
                    <h2>${habit.name}</h2>
                    <span class="streak">
                        <i class="fa-solid fa-fire" style="color: #f97316;"></i> 
                        ${streakCountText} &bull; ${doneThisWeek} na semana
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

    // Lógica de click
    document.querySelectorAll('#weekly-habit-list .day-box:not(.disabled)').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const el = e.currentTarget;
            const habitId = el.getAttribute('data-id');
            const dateStr = el.getAttribute('data-date');

            const habit = state.habits.find(h => h.id === habitId);
            if (habit) {
                if (habit.type === 'tempo' && !habit.records[dateStr]) {
                    // Manda pra aba de foco
                    document.querySelector('.tab-btn[data-target="tab-foco"]').click();

                    // Configura o cronômetro
                    const timerInput = document.getElementById('timer-input');
                    timerInput.value = habit.targetTime || 20;
                    timeLeft = (habit.targetTime || 20) * 60;
                    updateTimeDisplay();

                    // Guarda referência
                    window.currentFocusHabitId = habit.id;
                    window.currentFocusDateStr = dateStr;
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

function renderMonthlyView() {
    const container = document.getElementById('monthly-habit-list');
    container.innerHTML = '';

    // Renderizar os últimos 28 dias
    const pastDates = [];
    for (let i = 27; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        pastDates.push(d);
    }

    state.habits.forEach(habit => {
        const card = document.createElement('div');
        card.className = 'habit-card';
        card.style.setProperty('--habit-color', habit.color);

        let gridHtml = '';
        let doneThisMonth = 0;
        pastDates.forEach(d => {
            const dateStr = formatDate(d);
            const jsDay = d.getDay();
            const isActiveDay = habit.activeDays.includes(jsDay);
            const isCompleted = habit.records[dateStr];

            if (isCompleted) doneThisMonth++;

            let color = 'rgba(255,255,255,0.05)'; // vazio
            if (!isActiveDay) color = 'rgba(0,0,0,0.3)'; // bloqueado
            if (isCompleted) color = habit.color; // completo

            gridHtml += `<div class="month-box" style="background-color: ${color};" title="${dateStr}"></div>`;
        });

        let streakCountText = '';
        if (habit.type === 'tempo') {
            streakCountText = `${habit.totalFocusTime || 0} min focados`;
        } else {
            const streakCount = calculateStreak(habit);
            streakCountText = `Sequência: ${streakCount}`;
        }

        card.innerHTML = `
            <div class="habit-header" style="margin-bottom: 12px;">
                <div class="habit-icon-bg" style="width:40px; height:40px; background-color: ${habit.color}33;">
                    <i class="fa-solid ${habit.icon}" style="color: ${habit.color}; font-size: 1rem;"></i>
                </div>
                <div class="habit-info">
                    <h2 style="font-size: 1.1rem; margin-bottom: 4px;">${habit.name}</h2>
                    <span class="streak" style="font-size: 0.8rem; color: var(--text-secondary);">${doneThisMonth} neste mês &bull; <i class="fa-solid fa-fire" style="color: #f97316;"></i> ${streakCountText}</span>
                </div>
            </div>
            <div class="month-grid">
                ${gridHtml}
            </div>
        `;
        container.appendChild(card);
    });
}

// === Modal de Hábito ===
const modal = document.getElementById('habit-modal');
const modalTitle = document.getElementById('modal-title');
const habitForm = document.getElementById('habit-form');

const reminderCheckbox = document.getElementById('habit-reminder-enabled');
const reminderTimeGroup = document.getElementById('reminder-time-group');
reminderCheckbox.addEventListener('change', (e) => {
    reminderTimeGroup.style.display = e.target.checked ? 'block' : 'none';
});

// Modal UI Logic
const ICONS = ['fa-check', 'fa-book-open', 'fa-dumbbell', 'fa-person-running', 'fa-burger', 'fa-music', 'fa-moon', 'fa-droplet', 'fa-lightbulb'];
const COLORS = ['#ef4444', '#f97316', '#f59e0b', '#34d399', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6'];

let selectedIcon = 'fa-check';
let selectedColor = '#34d399';

const iconGrid = document.getElementById('icon-picker');
const colorGrid = document.getElementById('color-picker');

const typeRadios = document.querySelectorAll('input[name="habit-type"]');
const targetTimeGroup = document.getElementById('target-time-group');

typeRadios.forEach(r => {
    r.addEventListener('change', (e) => {
        document.querySelectorAll('.type-btn').forEach(btn => btn.classList.remove('active'));
        e.target.parentElement.classList.add('active');
        if (e.target.value === 'tempo') {
            targetTimeGroup.style.display = 'block';
        } else {
            targetTimeGroup.style.display = 'none';
        }
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
            document.getElementById('habit-target-time').value = habit.targetTime || 20;
            targetTimeGroup.style.display = isTempo ? 'block' : 'none';

            document.querySelectorAll('input[name="active-days"]').forEach(cb => {
                cb.checked = habit.activeDays.includes(parseInt(cb.value));
            });

            reminderCheckbox.checked = habit.reminderEnabled || false;
            document.getElementById('habit-reminder-time').value = habit.reminderTime || '12:00';
            reminderTimeGroup.style.display = habit.reminderEnabled ? 'block' : 'none';
        }
    } else {
        modalTitle.textContent = 'Novo Hábito';
        submitBtn.textContent = 'Continuar';
        deleteBtn.style.display = 'none';

        document.querySelector(`input[name="habit-type"][value="sim_nao"]`).checked = true;
        document.querySelectorAll('.type-btn').forEach(btn => btn.classList.remove('active'));
        document.querySelector(`input[name="habit-type"][value="sim_nao"]`).parentElement.classList.add('active');
        document.getElementById('habit-target-time').value = 20;
        targetTimeGroup.style.display = 'none';

        document.querySelectorAll('input[name="active-days"]').forEach(cb => cb.checked = true);
        reminderCheckbox.checked = false;
        document.getElementById('habit-reminder-time').value = '12:00';
        reminderTimeGroup.style.display = 'none';
        selectedIcon = 'fa-check';
        selectedColor = '#34d399';
    }

    renderPickerGrids();
    updatePreview();
    modal.classList.remove('hidden');
}

habitForm.addEventListener('submit', (e) => {
    e.preventDefault();

    // Solicitar permissão de notificação se a pessoa ativou o lembrete
    if (reminderCheckbox.checked && 'Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
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
    const targetTime = parseInt(document.getElementById('habit-target-time').value) || 20;

    const existingIndex = state.habits.findIndex(h => h.id === id);
    if (existingIndex > -1) {
        state.habits[existingIndex] = { ...state.habits[existingIndex], name, icon, color, activeDays, reminderEnabled, reminderTime, type: habitType, targetTime };
    } else {
        state.habits.push({ id, name, icon, color, activeDays, records: {}, reminderEnabled, reminderTime, type: habitType, targetTime, totalFocusTime: 0 });
    }

    saveState();
    renderViews();
    modal.classList.add('hidden');
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

// === Temporizador de Foco ===
const startTimerBtn = document.querySelector('.start-timer-btn');
const timeDisplay = document.querySelector('.time-display');
const timerInput = document.getElementById('timer-input');

let timerInterval;
let timeLeft = parseInt(timerInput.value) * 60;
let isTimerRunning = false;
let isCancelPeriod = false;
let cancelTimeout;

timerInput.addEventListener('change', () => {
    if (!isTimerRunning) {
        timeLeft = parseInt(timerInput.value) * 60;
        updateTimeDisplay();
    }
});

function updateTimeDisplay() {
    const minutes = Math.floor(timeLeft / 60);
    const seconds = timeLeft % 60;
    timeDisplay.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

startTimerBtn.addEventListener('click', () => {
    if (isTimerRunning) {
        if (isCancelPeriod) {
            // Clicou dentro dos 10 segundos iniciais, cancelar cronômetro.
            clearInterval(timerInterval);
            clearTimeout(cancelTimeout);
            isTimerRunning = false;
            isCancelPeriod = false;
            startTimerBtn.textContent = 'Iniciar Foco';
            startTimerBtn.classList.remove('btn-danger');
            timerInput.disabled = false;
            timeLeft = parseInt(timerInput.value) * 60;
            updateTimeDisplay();
        } else {
            // Já passou os 10 segundos, clicou em "Desistir"
            customConfirm("Tem certeza que deseja desistir do seu momento de foco? O foco não será registrado.", (confirmed) => {
                if (confirmed) {
                    clearInterval(timerInterval);
                    isTimerRunning = false;
                    startTimerBtn.textContent = 'Iniciar Foco';
                    startTimerBtn.classList.remove('btn-danger');
                    timerInput.disabled = false;
                    timeLeft = parseInt(timerInput.value) * 60;
                    updateTimeDisplay();

                    window.currentFocusHabitId = null;
                    window.currentFocusDateStr = null;
                }
            });
        }
    } else {
        // Iniciar temporizador
        if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission();
        }

        isTimerRunning = true;
        isCancelPeriod = true;
        startTimerBtn.textContent = 'Cancelar (10s)';
        startTimerBtn.classList.remove('btn-danger');
        timerInput.disabled = true;

        let cancelSeconds = 10;

        // Intervalo apenas para decrescer a string do botão "Cancelar (Xs)"
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

        // Timeout que transforma Cancelar em Desistir
        cancelTimeout = setTimeout(() => {
            if (isTimerRunning) {
                isCancelPeriod = false;
                startTimerBtn.textContent = 'Desistir';
                startTimerBtn.classList.add('btn-danger');
            }
        }, 10000);

        // Intervalo real do cronômetro
        timerInterval = setInterval(() => {
            if (timeLeft > 0) {
                timeLeft--;
                updateTimeDisplay();
            } else {
                clearInterval(timerInterval);
                isTimerRunning = false;
                isCancelPeriod = false;
                startTimerBtn.textContent = 'Iniciar Foco';
                startTimerBtn.classList.remove('btn-danger');
                timerInput.disabled = false;

                if ('Notification' in window && Notification.permission === 'granted') {
                    new Notification('Tempo de foco concluído!', {
                        body: 'Você conseguiu manter o foco! Hora de uma pequena pausa.',
                        icon: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="%2334d399"/><text x="50" y="65" font-size="40" font-family="sans-serif" font-weight="bold" fill="%23fff" text-anchor="middle">H</text></svg>'
                    });
                } else {
                    customAlert('Tempo de foco concluído!');
                }

                // Salvar dados se foi um cronômetro atrelado a um hábito
                if (window.currentFocusHabitId) {
                    const focusHabit = state.habits.find(h => h.id === window.currentFocusHabitId);
                    if (focusHabit) {
                        focusHabit.records[window.currentFocusDateStr] = true;
                        focusHabit.totalFocusTime = (focusHabit.totalFocusTime || 0) + focusHabit.targetTime;
                        saveState();
                        renderViews();
                    }
                    window.currentFocusHabitId = null;
                    window.currentFocusDateStr = null;
                }

                timeLeft = parseInt(timerInput.value) * 60;
                updateTimeDisplay();
            }
        }, 1000);
    }
});

// Inicialização
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('main-date-title').textContent = `Hoje, ${today.getDate()} de ${today.toLocaleString('pt-BR', { month: 'short' }).replace('.', '')}`;
    loadState();
    renderViews();
    updateTimeDisplay();
});

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

// === Verificador de Alarmes (Notificações) ===
setInterval(checkAlarms, 60000); // Roda a cada minuto

function checkAlarms() {
    const now = new Date();
    const currentHr = String(now.getHours()).padStart(2, '0');
    const currentMin = String(now.getMinutes()).padStart(2, '0');
    const timeStr = `${currentHr}:${currentMin}`;

    const todayJsDay = now.getDay();
    const todayDateStr = formatDate(now);

    let changed = false;

    state.habits.forEach(habit => {
        if (habit.reminderEnabled && habit.reminderTime === timeStr) {
            // Verificar se é dia ativo e não foi completado hoje
            if (habit.activeDays.includes(todayJsDay) && !habit.records[todayDateStr]) {
                // Notificar apenas uma vez no dia (previne múltiplos envios no mesmo minuto)
                if (habit.lastNotified !== todayDateStr) {
                    if ('Notification' in window && Notification.permission === 'granted') {
                        new Notification(`Lembrete: ${habit.name}`, {
                            body: `Está na hora de concluir o seu hábito: ${habit.name}!`,
                            icon: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="%2334d399"/><text x="50" y="65" font-size="40" font-family="sans-serif" font-weight="bold" fill="%23fff" text-anchor="middle">H</text></svg>'
                        });
                        habit.lastNotified = todayDateStr;
                        changed = true;
                    }
                }
            }
        }
    });

    if (changed) saveState();
}

// Chamar uma vez no inicio
setTimeout(checkAlarms, 2000);
