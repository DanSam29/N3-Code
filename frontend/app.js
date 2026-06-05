const API_URL = 'http://localhost:3001/api';
const FILTERS_STORAGE_KEY = 'schedule_filters_v1';

const ICON_COPY = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>`;
const ICON_JOIN = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>`;

const WEEK_DAYS = [
    { key: 'ПОНЕДІЛОК', short: 'Пн', full: 'Понеділок', theme: 'mon' },
    { key: 'ВІВТОРОК', short: 'Вт', full: 'Вівторок', theme: 'tue' },
    { key: 'СЕРЕДА', short: 'Ср', full: 'Середа', theme: 'wed' },
    { key: 'ЧЕТВЕР', short: 'Чт', full: 'Четвер', theme: 'thu' },
    { key: "П'ЯТНИЦЯ", short: 'Пт', full: "П'ятниця", theme: 'fri' }
];

document.addEventListener('DOMContentLoaded', () => {
    const fileInput = document.getElementById('fileInput');
    const fileLabel = document.getElementById('fileLabel');
    const uploadStatus = document.getElementById('uploadStatus');
    const filePick = document.querySelector('.file-pick');
    const searchSection = document.getElementById('searchSection');
    const searchSep = document.getElementById('searchSep');

    const groupSelect = document.getElementById('group');
    const teacherSelect = document.getElementById('teacher');
    const daySelect = document.getElementById('day');
    const searchBtn = document.getElementById('searchBtn');

    const resultsCard = document.getElementById('resultsCard');
    const recommendationsDiv = document.getElementById('recommendations');
    const resultsPre = document.getElementById('results');
    const loading = document.getElementById('loading');
    const toggleRaw = document.getElementById('toggleRaw');
    const toastEl = document.getElementById('toast');

    initCustomSelects();
    initSavedSchedule();
    document.addEventListener('click', closeAllCustomSelects);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeAllCustomSelects();
    });

    fileInput.addEventListener('change', () => {
        const file = fileInput.files[0];
        if (!file) {
            fileLabel.textContent = 'Обрати файл';
            return;
        }
        fileLabel.textContent = file.name;
        uploadSchedule(file);
    });

    async function uploadSchedule(file) {
        const formData = new FormData();
        formData.append('schedule', file);

        fileInput.disabled = true;
        if (filePick) filePick.classList.add('is-loading');
        showStatus('Обробка файлу розкладу…', 'success');

        try {
            const response = await fetch(`${API_URL}/upload`, {
                method: 'POST',
                body: formData
            });

            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Помилка завантаження');

            showStatus('Файл успішно оброблено!', 'success');
            loadMetadata(data.metadata);
            showSearchPanel();
            localStorage.removeItem(FILTERS_STORAGE_KEY);
        } catch (err) {
            showStatus('Помилка: ' + err.message, 'error');
            fileInput.value = '';
            fileLabel.textContent = 'Обрати файл';
        } finally {
            fileInput.disabled = false;
            if (filePick) filePick.classList.remove('is-loading');
        }
    }

    function loadMetadata(metadata) {
        groupSelect.innerHTML = '<option value="">Оберіть</option>';
        teacherSelect.innerHTML = '<option value="">Усі</option>';
        daySelect.innerHTML = '<option value="">Тиждень</option>';

        metadata.groups.sort().forEach(g => {
            const opt = document.createElement('option');
            opt.value = g;
            opt.textContent = g;
            groupSelect.appendChild(opt);
        });

        metadata.teachers.sort().forEach(t => {
            const opt = document.createElement('option');
            opt.value = t;
            opt.textContent = t;
            teacherSelect.appendChild(opt);
        });

        metadata.days.forEach(d => {
            const opt = document.createElement('option');
            opt.value = d;
            opt.textContent = d;
            daySelect.appendChild(opt);
        });

        refreshAllCustomSelects();
    }

    function initCustomSelects() {
        [groupSelect, daySelect, teacherSelect].forEach(setupCustomSelect);
    }

    function refreshAllCustomSelects() {
        [groupSelect, daySelect, teacherSelect].forEach(refreshCustomSelectMenu);
    }

    function closeAllCustomSelects() {
        document.querySelectorAll('.custom-select.open').forEach(el => el.classList.remove('open'));
    }

    function setupCustomSelect(select) {
        if (select.dataset.customReady === '1') {
            refreshCustomSelectMenu(select);
            return;
        }

        const wrap = document.createElement('div');
        wrap.className = 'custom-select';
        select.parentNode.insertBefore(wrap, select);
        wrap.appendChild(select);
        select.classList.add('native-select-hidden');

        const trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = 'custom-select-trigger';
        trigger.setAttribute('aria-haspopup', 'listbox');

        const menu = document.createElement('ul');
        menu.className = 'custom-select-menu';
        menu.setAttribute('role', 'listbox');

        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = wrap.classList.contains('open');
            closeAllCustomSelects();
            if (!isOpen) wrap.classList.add('open');
        });

        wrap.appendChild(trigger);
        wrap.appendChild(menu);
        select.dataset.customReady = '1';
        select._customWrap = wrap;
        select._customTrigger = trigger;
        select._customMenu = menu;

        refreshCustomSelectMenu(select);
    }

    function refreshCustomSelectMenu(select) {
        if (!select._customMenu) return;

        const menu = select._customMenu;
        const trigger = select._customTrigger;
        menu.innerHTML = '';

        [...select.options].forEach(opt => {
            const li = document.createElement('li');
            li.className = 'custom-select-option' + (opt.selected ? ' selected' : '');
            li.textContent = opt.textContent;
            li.dataset.value = opt.value;
            li.setAttribute('role', 'option');
            li.addEventListener('click', (e) => {
                e.stopPropagation();
                select.value = opt.value;
                select.dispatchEvent(new Event('change', { bubbles: true }));
                refreshCustomSelectMenu(select);
                closeAllCustomSelects();
            });
            menu.appendChild(li);
        });

        const selected = select.options[select.selectedIndex];
        trigger.textContent = selected ? selected.textContent : '';
    }

    function showSearchPanel() {
        searchSection.style.display = 'block';
        if (searchSep) searchSep.style.display = 'block';
    }

    function showStatus(msg, type) {
        uploadStatus.textContent = msg;
        uploadStatus.className = 'status-chip ' + type;
    }

    searchBtn.addEventListener('click', () => runSearch());

    async function initSavedSchedule() {
        try {
            const response = await fetch(`${API_URL}/metadata`);
            const data = await response.json();
            if (!response.ok || !data.loaded) return;

            loadMetadata(data.metadata);
            showSearchPanel();
            const count = data.metadata.lessonCount || 0;
            showStatus(
                count
                    ? `Збережений розклад (${count} занять) — можна одразу шукати`
                    : 'Збережений розклад — можна одразу шукати',
                'success'
            );

            const saved = readSavedFilters();
            if (saved?.group) {
                applyFilters(saved);
                await runSearch({ silent: true });
            }
        } catch {
            /* сервер не запущено */
        }
    }

    function readSavedFilters() {
        try {
            const raw = localStorage.getItem(FILTERS_STORAGE_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch {
            return null;
        }
    }

    function saveFilters() {
        localStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify({
            group: groupSelect.value,
            day: daySelect.value,
            teacher: teacherSelect.value
        }));
    }

    function applyFilters(filters) {
        if (filters.group && [...groupSelect.options].some(o => o.value === filters.group)) {
            groupSelect.value = filters.group;
        }
        if (filters.day && [...daySelect.options].some(o => o.value === filters.day)) {
            daySelect.value = filters.day;
        }
        if (filters.teacher && [...teacherSelect.options].some(o => o.value === filters.teacher)) {
            teacherSelect.value = filters.teacher;
        }
        refreshAllCustomSelects();
    }

    async function runSearch(options = {}) {
        if (!groupSelect.value) {
            if (!options.silent) alert('Вибір групи є обов\'язковим!');
            return;
        }

        loading.style.display = 'block';
        resultsCard.style.display = 'none';
        recommendationsDiv.innerHTML = '';

        const payload = {
            group: groupSelect.value,
            day: daySelect.value || null,
            teacher: teacherSelect.value || null
        };

        try {
            const response = await fetch(`${API_URL}/query`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Помилка сервера');

            saveFilters();

            loading.style.display = 'none';
            resultsCard.style.display = 'block';
            resultsPre.textContent = data.result;
            resultsPre.style.display = 'none';

            renderWeekCalendar(parseLessonsFromN3(data.result), {
                group: groupSelect.value,
                day: daySelect.value,
                teacher: teacherSelect.value
            });
            scrollToSchedule();
        } catch (err) {
            loading.style.display = 'none';
            if (!options.silent) alert('Помилка при виконанні запиту: ' + err.message);
        }
    }

    toggleRaw.addEventListener('click', () => {
        const visible = resultsPre.style.display === 'block';
        resultsPre.style.display = visible ? 'none' : 'block';
        toggleRaw.textContent = visible ? 'Сирий N3' : 'Приховати N3';
    });

    function buildTeacherMap(n3) {
        const map = {};
        const re = /ex:([^\s]+)\s+ex:fullName\s+"([^"]+)"/g;
        let m;
        while ((m = re.exec(n3)) !== null) {
            map[`ex:${m[1]}`] = m[2];
        }
        return map;
    }

    function resolveTeacherName(block, teacherMap) {
        const teacherRef = block.match(/ex:hasTeacher\s+(ex:[^\s.;]+)/);
        if (teacherRef && teacherMap[teacherRef[1]]) {
            return teacherMap[teacherRef[1]];
        }

        const direct = block.match(/ex:fullName\s+"([^"]+)"/);
        if (direct) return direct[1];

        if (teacherRef) {
            const id = teacherRef[1].replace(/^ex:/, '').replace(/_/g, ' ');
            if (id !== 'Невідомий викладач') {
                return id.replace(/\s+/g, ' ').trim();
            }
        }

        return 'Невідомий викладач';
    }

    function parseLessonsFromN3(n3) {
        const blocks = n3.split('ex:recommendedLesson').slice(1);
        const teacherMap = buildTeacherMap(n3);
        const seen = new Set();
        const lessons = [];

        blocks.forEach(block => {
            const subjectMatch = block.match(/ex:subject\s+"([^"]+)"/);
            const dayMatch = block.match(/ex:dayOfWeek\s+"([^"]+)"/);
            const timeMatch = block.match(/ex:timeStart\s+"([^"]+)"/);
            const linkMatch = block.match(/ex:link\s+"([^"]+)"/);

            if (!subjectMatch || !dayMatch || !timeMatch) return;

            const lesson = {
                subject: subjectMatch[1],
                day: dayMatch[1],
                time: timeMatch[1],
                link: linkMatch ? linkMatch[1] : '',
                teacher: resolveTeacherName(block, teacherMap),
                slot: extractSlotNumber(timeMatch[1])
            };

            const key = `${lesson.day}|${lesson.slot}|${lesson.subject}|${lesson.teacher}`;
            if (seen.has(key)) return;
            seen.add(key);
            lessons.push(lesson);
        });

        return lessons.sort((a, b) => {
            const dayDiff = WEEK_DAYS.findIndex(d => d.key === a.day) - WEEK_DAYS.findIndex(d => d.key === b.day);
            if (dayDiff !== 0) return dayDiff;
            return a.slot - b.slot;
        });
    }

    function extractSlotNumber(timeStr) {
        const m = timeStr.match(/Пара\s*(\d+)/i);
        return m ? parseInt(m[1], 10) : 99;
    }

    function scrollToSchedule() {
        requestAnimationFrame(() => {
            resultsCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
    }

    function renderWeekCalendar(lessons, filters) {
        if (lessons.length === 0) {
            recommendationsDiv.innerHTML = '<p style="text-align:center;color:#64748b;">Занять не знайдено за вашим запитом.</p>';
            return;
        }

        const filterParts = [];
        if (filters.teacher) filterParts.push(`викладач: ${escapeHtml(filters.teacher)}`);
        if (filters.day) filterParts.push(`день: ${escapeHtml(filters.day)}`);

        const meta = document.createElement('div');
        meta.className = 'schedule-meta';
        meta.innerHTML = `
            <div>
                <h3>Група ${escapeHtml(filters.group)}</h3>
                ${filterParts.length ? `<p class="filters">Фільтр: ${filterParts.join(' · ')}</p>` : ''}
            </div>
            <span class="badge">${lessons.length} занять</span>
        `;
        recommendationsDiv.appendChild(meta);

        const calendar = document.createElement('div');
        calendar.className = 'week-calendar';

        const daysToShow = filters.day
            ? WEEK_DAYS.filter(d => d.key === filters.day)
            : WEEK_DAYS;

        daysToShow.forEach(dayInfo => {
            const dayLessons = lessons.filter(l => l.day === dayInfo.key);
            const col = document.createElement('div');
            col.className = 'day-column';
            col.dataset.day = dayInfo.theme;
            if (filters.day === dayInfo.key) col.classList.add('highlight');

            col.innerHTML = `
                <div class="day-header">
                    <div class="short">${dayInfo.short}</div>
                    <div class="full">${dayInfo.full}</div>
                </div>
            `;

            const lessonsContainer = document.createElement('div');
            lessonsContainer.className = 'day-lessons';

            if (dayLessons.length === 0) {
                lessonsContainer.innerHTML = '<div class="day-empty">Немає занять</div>';
            } else {
                dayLessons.forEach(lesson => {
                    lessonsContainer.appendChild(createLessonCard(lesson));
                });
            }

            col.appendChild(lessonsContainer);
            calendar.appendChild(col);
        });

        recommendationsDiv.appendChild(calendar);
    }

    function createLessonCard(lesson) {
        const card = document.createElement('div');
        card.className = 'lesson-card';

        const timeParts = parseTimeParts(lesson.time);
        const hasLink = lesson.link && lesson.link.startsWith('http');

        const actionsHtml = hasLink
            ? `<div class="lesson-actions">
                <a href="${escapeAttr(lesson.link)}" target="_blank" rel="noopener noreferrer" class="btn-join-text">${ICON_JOIN}<span>Підключитись</span></a>
                <button type="button" class="btn-icon btn-copy" title="Копіювати посилання" aria-label="Копіювати посилання" data-link="${escapeAttr(lesson.link)}">${ICON_COPY}</button>
               </div>`
            : `<p class="no-link-hint">${escapeHtml(lesson.link || 'Посилання не вказано')}</p>`;

        card.innerHTML = `
            <div class="lesson-time">
                <div class="lesson-slot">
                    <span class="lesson-slot-num">${escapeHtml(timeParts.num)}</span>
                    <span class="lesson-slot-label">пара</span>
                </div>
                ${timeParts.start ? `
                <div class="lesson-clock">
                    <span class="lesson-clock-times">
                        <span class="t-start">${escapeHtml(timeParts.start)}</span><span class="t-sep">–</span><span class="t-end">${escapeHtml(timeParts.end)}</span>
                    </span>
                    <span class="lesson-clock-duration">${escapeHtml(timeParts.duration)}</span>
                </div>` : ''}
            </div>
            <p class="lesson-subject" title="${escapeAttr(lesson.subject)}">${escapeHtml(lesson.subject)}</p>
            <p class="lesson-teacher">${escapeHtml(lesson.teacher)}</p>
            ${actionsHtml}
        `;

        const copyBtn = card.querySelector('.btn-copy');
        if (copyBtn) {
            copyBtn.addEventListener('click', () => copyToClipboard(lesson.link));
        }

        return card;
    }

    function parseTimeParts(timeStr) {
        const slotMatch = timeStr.match(/Пара\s*(\d+)/i);
        const rangeMatch = timeStr.match(/(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})/);
        const start = rangeMatch ? rangeMatch[1] : '';
        const end = rangeMatch ? rangeMatch[2] : '';
        let duration = '';
        if (start && end) {
            const [sh, sm] = start.split(':').map(Number);
            const [eh, em] = end.split(':').map(Number);
            const mins = (eh * 60 + em) - (sh * 60 + sm);
            if (mins > 0) {
                const h = Math.floor(mins / 60);
                const m = mins % 60;
                duration = h ? (m ? `${h} год ${m} хв` : `${h} год`) : `${m} хв`;
            }
        }
        return {
            num: slotMatch ? slotMatch[1] : '?',
            start,
            end,
            duration
        };
    }

    async function copyToClipboard(text) {
        try {
            await navigator.clipboard.writeText(text);
            showToast('Посилання скопійовано!');
        } catch {
            const ta = document.createElement('textarea');
            ta.value = text;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            showToast('Посилання скопійовано!');
        }
    }

    function showToast(message) {
        toastEl.textContent = message;
        toastEl.classList.add('show');
        setTimeout(() => toastEl.classList.remove('show'), 2200);
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function escapeAttr(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }
});
