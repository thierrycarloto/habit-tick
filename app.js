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

// === Gerenciamento de Abas e Transição Suave (Estilo Samsung / ViewPager) ===
let currentTabIndex = 0;
const tabTrack = document.getElementById('tab-track');
const tabViewport = document.getElementById('tab-viewport');
const tabIndicator = document.getElementById('tab-indicator');
const tabBtns = Array.from(document.querySelectorAll('.tab-btn'));

function updateTabIndicator(progress) {
    if (!tabIndicator || tabBtns.length === 0) return;
    const tabWidth = tabBtns[0].offsetWidth;
    const indicatorWidth = tabWidth * 0.6;
    const indicatorOffset = tabWidth * 0.2;
    const x = (progress * tabWidth) + indicatorOffset;
    tabIndicator.style.width = `${indicatorWidth}px`;
    tabIndicator.style.transform = `translateX(${x}px)`;
}

function switchTab(index, animate = true) {
    if (index < 0) index = 0;
    if (index >= tabBtns.length) index = tabBtns.length - 1;
    currentTabIndex = index;

    if (tabTrack) {
        if (animate) {
            tabTrack.style.transition = 'transform 0.32s cubic-bezier(0.25, 1, 0.5, 1)';
        } else {
            tabTrack.style.transition = 'none';
        }
        tabTrack.style.transform = `translateX(-${index * 100}%)`;
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

    const fabBtn = document.getElementById('add-habit-btn');
    if (fabBtn) {
        fabBtn.style.display = index === 2 ? 'none' : 'flex';
    }

    renderViews();
}

tabBtns.forEach((btn, index) => {
    btn.addEventListener('click', () => {
        switchTab(index, true);
    });
});

window.addEventListener('resize', () => {
    updateTabIndicator(currentTabIndex);
});

// === Renderização ===
const weekDays = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
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
                    // Manda pra aba de foco com animação fluida
                    switchTab(2, true);

                    // Configura o cronômetro
                    const timerInput = document.getElementById('timer-input');
                    const targetMinutes = habit.targetTime || 20;
                    timerInput.value = targetMinutes;
                    totalTimerSeconds = targetMinutes * 60;
                    timeLeft = totalTimerSeconds;
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

    state.habits.forEach(habit => {
        const card = document.createElement('div');
        card.className = 'habit-card';
        card.style.setProperty('--habit-color', habit.color);

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
            if (!isActiveDay) {
                color = 'rgba(0,0,0,0.3)';
            } else if (isCompleted) {
                color = habit.color;
                extraClass = 'completed';
            }
                
            html += `<div class="cal-box ${extraClass}" style="background-color: ${color};" title="${dateStr}">${d}</div>`;
        }
            
        html += `</div></div>`;

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
                    <span class="streak" style="font-size: 0.8rem; color: var(--text-secondary);">${doneTotal} concluídos &bull; <i class="fa-solid fa-fire" style="color: #f97316;"></i> ${streakCountText}</span>
                </div>
            </div>
            <div class="months-container">
                ${html}
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
const timerProgressRing = document.getElementById('timer-progress-ring');
const timerDotGroup = document.getElementById('timer-dot-group');
const CIRCUMFERENCE = 596.9; // 2 * PI * 95

let timerInterval;
let totalTimerSeconds = parseInt(timerInput.value) * 60;
let timeLeft = totalTimerSeconds;
let isTimerRunning = false;
let isCancelPeriod = false;
let cancelTimeout;

// Ruler Ticks e Slider Modal
const timerModal = document.getElementById('timer-slider-modal');
const modalTimerRange = document.getElementById('modal-timer-range');
const timerSliderDisplay = document.getElementById('timer-slider-display');
const timerSliderConfirmBtn = document.getElementById('timer-slider-confirm-btn');
const rulerTicks = document.getElementById('ruler-ticks');

let lastVibratedVal = parseInt(timerInput.value) || 25;

function initRulerTicks() {
    if (!rulerTicks) return;
    rulerTicks.innerHTML = '';
    // Gera exatamente 36 barras de 5 em 5 minutos (5 a 180 min)
    for (let min = 5; min <= 180; min += 5) {
        const tick = document.createElement('div');
        tick.className = 'ruler-tick';
        tick.dataset.val = min;
        if (min % 30 === 0) {
            tick.classList.add('tick-large');
        } else if (min % 15 === 0) {
            tick.classList.add('tick-medium');
        } else {
            tick.classList.add('tick-small');
        }
        rulerTicks.appendChild(tick);
    }
}

function updateRulerTicks(currentVal) {
    if (!rulerTicks) return;
    const ticks = rulerTicks.querySelectorAll('.ruler-tick');
    ticks.forEach(tick => {
        const val = parseInt(tick.dataset.val);
        tick.classList.toggle('passed', val <= currentVal);
        tick.classList.toggle('active-tick', val === currentVal);
    });
}

function updateTimeDisplay() {
    const minutes = Math.floor(timeLeft / 60);
    const seconds = timeLeft % 60;
    timeDisplay.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

    // Atualiza anel circular e bolinha viajante
    if (timerProgressRing && timerDotGroup) {
        const total = (totalTimerSeconds > 0) ? totalTimerSeconds : (parseInt(timerInput.value) * 60);
        const elapsed = Math.max(0, total - timeLeft);
        const progress = total > 0 ? (elapsed / total) : 0;

        // O anel preenche no sentido horário conforme o tempo passa
        const offset = CIRCUMFERENCE * (1 - progress);
        timerProgressRing.style.strokeDashoffset = offset;

        // A bolinha viaja gradativamente pelo círculo todo
        const angle = progress * 360;
        timerDotGroup.setAttribute('transform', `rotate(${angle} 110 110)`);
    }
}

timerInput.addEventListener('change', () => {
    if (!isTimerRunning) {
        let val = parseInt(timerInput.value);
        if (val > 180) val = 180;
        if (val < 5) val = 5;
        timerInput.value = val;
        totalTimerSeconds = val * 60;
        timeLeft = totalTimerSeconds;
        if (timerProgressRing) timerProgressRing.style.transition = 'stroke-dashoffset 0.3s ease';
        if (timerDotGroup) timerDotGroup.style.transition = 'transform 0.3s ease';
        updateTimeDisplay();
    }
});

document.getElementById('timer-circle-clickable').addEventListener('click', () => {
    if (!isTimerRunning) {
        const val = parseInt(timerInput.value) || 25;
        modalTimerRange.value = val;
        lastVibratedVal = val;
        timerSliderDisplay.textContent = `${val} min`;
        updateRulerTicks(val);
        timerModal.classList.remove('hidden');
    }
});

modalTimerRange.addEventListener('input', (e) => {
    const val = parseInt(e.target.value);
    timerSliderDisplay.textContent = `${val} min`;
    updateRulerTicks(val);

    // Vibração suave no celular a cada mudança de 5 em 5 minutos
    if (val !== lastVibratedVal) {
        lastVibratedVal = val;
        if ('vibrate' in navigator) {
            try {
                navigator.vibrate(10);
            } catch (err) {}
        }
    }
});

timerSliderConfirmBtn.addEventListener('click', () => {
    const val = parseInt(modalTimerRange.value);
    timerInput.value = val;
    totalTimerSeconds = val * 60;
    timeLeft = totalTimerSeconds;
    if (timerProgressRing) timerProgressRing.style.transition = 'stroke-dashoffset 0.3s ease';
    if (timerDotGroup) timerDotGroup.style.transition = 'transform 0.3s ease';
    updateTimeDisplay();
    timerModal.classList.add('hidden');
});

timerModal.addEventListener('click', (e) => {
    if (e.target === timerModal) {
        timerModal.classList.add('hidden');
    }
});

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
            if (timerProgressRing) timerProgressRing.style.transition = 'stroke-dashoffset 0.3s ease';
            if (timerDotGroup) timerDotGroup.style.transition = 'transform 0.3s ease';
            totalTimerSeconds = parseInt(timerInput.value) * 60;
            timeLeft = totalTimerSeconds;
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
                    if (timerProgressRing) timerProgressRing.style.transition = 'stroke-dashoffset 0.3s ease';
                    if (timerDotGroup) timerDotGroup.style.transition = 'transform 0.3s ease';
                    totalTimerSeconds = parseInt(timerInput.value) * 60;
                    timeLeft = totalTimerSeconds;
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

        if (timerProgressRing) timerProgressRing.style.transition = 'stroke-dashoffset 0.9s linear';
        if (timerDotGroup) timerDotGroup.style.transition = 'transform 0.9s linear';

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

                if (timerProgressRing) timerProgressRing.style.transition = 'stroke-dashoffset 0.3s ease';
                if (timerDotGroup) timerDotGroup.style.transition = 'transform 0.3s ease';
                totalTimerSeconds = parseInt(timerInput.value) * 60;
                timeLeft = totalTimerSeconds;
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
    initRulerTicks();
    updateRulerTicks(parseInt(timerInput.value) || 25);
    updateTimeDisplay();
    switchTab(0, false);
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

// === Transição Gradual ao Deslizar Entre Abas (Estilo Celulares Samsung) ===
let dragStartX = 0;
let dragStartY = 0;
let dragCurrentX = 0;
let dragStartTime = 0;
let isHorizontalDrag = null;
let isTouchActive = false;

if (tabViewport) {
    tabViewport.addEventListener('touchstart', (e) => {
        // Ignora gestos se qualquer modal estiver aberto
        const modal = document.getElementById('habit-modal');
        const tModal = document.getElementById('timer-slider-modal');
        const cModal = document.getElementById('custom-dialog-modal');
        if (modal && !modal.classList.contains('hidden')) return;
        if (tModal && !tModal.classList.contains('hidden')) return;
        if (cModal && !cModal.classList.contains('hidden')) return;

        // Não interceptar sliders internos
        if (e.target.closest('#modal-timer-range, input[type="range"]')) return;

        const touch = e.touches[0];
        dragStartX = touch.clientX;
        dragStartY = touch.clientY;
        dragCurrentX = dragStartX;
        dragStartTime = Date.now();
        isHorizontalDrag = null;
        isTouchActive = true;
    }, { passive: true });

    tabViewport.addEventListener('touchmove', (e) => {
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
            let effectiveDelta = deltaX;

            // Efeito elástico (rubber-band) nas extremidades para evitar puxar além dos limites
            if ((currentTabIndex === 0 && deltaX > 0) || (currentTabIndex === tabBtns.length - 1 && deltaX < 0)) {
                effectiveDelta = deltaX * 0.28;
            }

            // Move o track das abas em tempo real acompanhando o dedo
            const basePercent = -currentTabIndex * 100;
            const dragPercent = (effectiveDelta / W) * 100;
            if (tabTrack) {
                tabTrack.style.transition = 'none';
                tabTrack.style.transform = `translateX(${basePercent + dragPercent}%)`;
            }

            // Move a barrinha indicadora das abas sincronizada com o dedo
            if (tabIndicator && tabBtns.length > 0) {
                const tabWidth = tabBtns[0].offsetWidth;
                const progress = currentTabIndex - (effectiveDelta / W);
                const clampedProgress = Math.max(0, Math.min(tabBtns.length - 1, progress));
                tabIndicator.style.transition = 'none';
                updateTabIndicator(clampedProgress);
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

            const distanceThreshold = W * 0.25; // 25% da largura da tela para confirmar
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

    tabViewport.addEventListener('touchend', finishSwipe, { passive: true });
    tabViewport.addEventListener('touchcancel', finishSwipe, { passive: true });
}
