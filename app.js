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
        const h = activePage.offsetHeight;
        if (h > 0) {
            tabViewport.style.transition = animate ? 'height 0.3s cubic-bezier(0.25, 1, 0.5, 1)' : 'none';
            tabViewport.style.height = `${h}px`;
        }
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

    // Lógica de click
    document.querySelectorAll('#weekly-habit-list .day-box:not(.disabled)').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const el = e.currentTarget;
            const habitId = el.getAttribute('data-id');
            const dateStr = el.getAttribute('data-date');

            const habit = state.habits.find(h => h.id === habitId);
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
                        innerContent = `<span style="font-size: 0.7rem; font-weight: 700;">${dayMins}m</span>`;
                    }

                    calGridHtml += `<div class="${boxClass}" style="${boxStyle}" title="${dStr}: ${dayMins} min">${innerContent}</div>`;
                }
                calGridHtml += `</div>`;

                chartBodyHtml = `
                    <div class="focus-chart-summary">
                        <span>Total em ${monthName}</span>
                        <strong>${monthTotal} min <span style="font-size: 0.8rem; font-weight: 500; color: var(--text-secondary);">(${Math.floor(monthTotal / 60)}h ${monthTotal % 60}m &bull; ${monthSessions.length} sessões)</span></strong>
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
                if (!isActiveDay) {
                    color = 'rgba(0,0,0,0.3)';
                } else if (isCompleted) {
                    color = habit.color;
                    extraClass = 'completed';
                }
                    
                html += `<div class="cal-box ${extraClass}" style="background-color: ${color};" title="${dateStr}">${d}</div>`;
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

// Modal UI Logic
const ICONS = ['fa-check', 'fa-book-open', 'fa-dumbbell', 'fa-person-running', 'fa-burger', 'fa-music', 'fa-moon', 'fa-droplet', 'fa-lightbulb'];
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
            type: habitType
        };
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
            totalFocusTime: 0
        });
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

// Audio & Haptic Feedback
let audioCtx = null;
function triggerHaptic() {
    if ('vibrate' in navigator) {
        try {
            navigator.vibrate(15);
        } catch (e) {}
    }
    try {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(520, audioCtx.currentTime);
        gain.gain.setValueAtTime(0.025, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.02);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.02);
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
            triggerHaptic();
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
            triggerHaptic();
        }
    }, { passive: false });

    // Botões de preset rápido
    document.querySelectorAll('.preset-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const val = parseInt(btn.dataset.preset);
            const idx = val / 5;
            snapRulerToTick(idx, true);
            triggerHaptic();
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
        timerSublabel.textContent = `${chosenMins} min`;
        focusDescText.textContent = 'Fique longe do celular e foque no que importa.';

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
    }
}

function resetTimerState() {
    clearInterval(timerInterval);
    clearTimeout(cancelTimeout);
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

                showAppNotification('Foco concluído!', {
                    body: `Excelente! Você focou por ${minsFocused} min no modo livre!`,
                    tag: 'focus-stopwatch-completed'
                });
                customAlert(`Parabéns! Você concluiu ${minsFocused} min de foco!`);
                resetTimerState();

            } else {
                // Modo contagem regressiva: desistir ou salvar tempo decorrido
                const elapsedSecs = totalTimerSeconds - timeLeft;
                const elapsedMins = Math.round(elapsedSecs / 60);

                if (elapsedMins >= 1) {
                    customConfirm(`Deseja salvar os ${elapsedMins} min de foco realizados até agora?`, (save) => {
                        if (save) {
                            recordFocusSession(elapsedMins, elapsedSecs);
                            customAlert(`Sessão finalizada! ${elapsedMins} min foram registrados.`);
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
        startTimerBtn.textContent = 'Cancelar (10s)';
        startTimerBtn.classList.remove('btn-danger', 'btn-finish-focus');
        timerInput.disabled = true;

        if (timerProgressRing) timerProgressRing.style.transition = 'stroke-dashoffset 0.9s linear';
        if (timerDotGroup) timerDotGroup.style.transition = 'transform 0.9s linear';

        let cancelSeconds = 10;
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
        }, 10000);

        if (isStopwatch) {
            // Cronômetro Crescente (Modo Livre até 180 min = 10800s)
            timerInterval = setInterval(() => {
                elapsedSeconds++;
                updateTimeDisplay();

                if (elapsedSeconds >= 180 * 60) {
                    // Limite máximo atingido
                    clearInterval(timerInterval);
                    recordFocusSession(180, 180 * 60);
                    showAppNotification('Limite máximo atingido!', {
                        body: 'Você atingiu o limite máximo de 180 min de foco! Incrível!',
                        tag: 'focus-max-reached'
                    });
                    customAlert('Limite máximo de 180 min de foco atingido! Parabéns pelo seu foco!');
                    resetTimerState();
                }
            }, 1000);

        } else {
            // Contagem Regressiva (Tempo definido na régua)
            totalTimerSeconds = parseInt(timerInput.value) * 60;
            timeLeft = totalTimerSeconds;

            timerInterval = setInterval(() => {
                if (timeLeft > 0) {
                    timeLeft--;
                    updateTimeDisplay();
                } else {
                    clearInterval(timerInterval);
                    const chosenMins = parseInt(timerInput.value) || 25;
                    recordFocusSession(chosenMins, chosenMins * 60);

                    showAppNotification('Tempo de foco concluído!', {
                        body: `Você manteve o foco por ${chosenMins} min! Hora de uma pequena pausa.`,
                        tag: 'focus-completed'
                    });
                    if (!('Notification' in window) || Notification.permission !== 'granted') {
                        customAlert(`Tempo de foco concluído! Você manteve o foco por ${chosenMins} min.`);
                    }

                    resetTimerState();
                }
            }, 1000);
        }
    }
});

// Inicialização
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('main-date-title').textContent = `Hoje, ${today.getDate()} de ${today.toLocaleString('pt-BR', { month: 'short' }).replace('.', '')}`;
    loadState();
    renderViews();
    initRuler();
    updateFocusHabitDisplay();
    updateTimeDisplay();
    switchTab(0, false);
    setupBackupHandlers();
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

// === Verificador de Alarmes (Notificações) ===
setInterval(checkAlarms, 20000); // Roda a cada 20 segundos

function checkAlarms() {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;

    const now = new Date();
    const currentHr = String(now.getHours()).padStart(2, '0');
    const currentMin = String(now.getMinutes()).padStart(2, '0');
    const timeStr = `${currentHr}:${currentMin}`;
    const currentMinutesOfDay = now.getHours() * 60 + now.getMinutes();

    const todayJsDay = now.getDay();
    const todayDateStr = formatDate(now);

    let changed = false;

    state.habits.forEach(habit => {
        if (habit.reminderEnabled && habit.reminderTime) {
            // Verificar se é dia ativo e não foi completado hoje
            if (habit.activeDays && habit.activeDays.includes(todayJsDay) && !habit.records[todayDateStr]) {
                const [rHr, rMin] = habit.reminderTime.split(':').map(Number);
                const reminderMinutes = rHr * 60 + rMin;

                const isExactTime = habit.reminderTime === timeStr;
                const isRecentWindow = (currentMinutesOfDay >= reminderMinutes && currentMinutesOfDay <= reminderMinutes + 3);

                if ((isExactTime || isRecentWindow) && habit.lastNotified !== todayDateStr) {
                    showAppNotification(`Lembrete: ${habit.name}`, {
                        body: `Está na hora de concluir o seu hábito: ${habit.name}!`,
                        tag: `reminder-${habit.id}-${todayDateStr}`
                    });
                    habit.lastNotified = todayDateStr;
                    changed = true;
                }
            }
        }
    });

    if (changed) saveState();
}

setTimeout(checkAlarms, 1000);
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        checkAlarms();
    }
});

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
        const bModal = document.getElementById('backup-modal');
        if (modal && !modal.classList.contains('hidden')) return;
        if (tModal && !tModal.classList.contains('hidden')) return;
        if (cModal && !cModal.classList.contains('hidden')) return;
        if (bModal && !bModal.classList.contains('hidden')) return;

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
                    const hCurrent = tabPages[currentTabIndex].offsetHeight;
                    const hTarget = tabPages[targetIdx].offsetHeight;
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

    tabViewport.addEventListener('touchend', finishSwipe, { passive: true });
    tabViewport.addEventListener('touchcancel', finishSwipe, { passive: true });
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
