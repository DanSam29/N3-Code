const API_URL = 'http://localhost:3001/api';

document.addEventListener('DOMContentLoaded', () => {
    const fileInput = document.getElementById('fileInput');
    const uploadBtn = document.getElementById('uploadBtn');
    const uploadStatus = document.getElementById('uploadStatus');
    const searchSection = document.getElementById('searchSection');
    
    const groupSelect = document.getElementById('group');
    const teacherSelect = document.getElementById('teacher');
    const daySelect = document.getElementById('day');
    const searchBtn = document.getElementById('searchBtn');
    
    const resultsCard = document.getElementById('resultsCard');
    const recommendationsDiv = document.getElementById('recommendations');
    const resultsPre = document.getElementById('results');
    const loading = document.getElementById('loading');
    const toggleRaw = document.getElementById('toggleRaw');

    // Обробка завантаження файлу
    uploadBtn.addEventListener('click', async () => {
        const file = fileInput.files[0];
        if (!file) {
            showStatus('Будь ласка, оберіть файл', 'error');
            return;
        }

        const formData = new FormData();
        formData.append('schedule', file);

        uploadBtn.disabled = true;
        showStatus('Обробка файлу AI-парсером...', 'success');

        try {
            const response = await fetch(`${API_URL}/upload`, {
                method: 'POST',
                body: formData
            });

            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Помилка завантаження');

            showStatus('Файл успішно оброблено та конвертовано в RDF/N3!', 'success');
            loadMetadata(data.metadata);
            searchSection.style.display = 'block';
        } catch (err) {
            showStatus('Помилка: ' + err.message, 'error');
        } finally {
            uploadBtn.disabled = false;
        }
    });

    function loadMetadata(metadata) {
        // Очищення існуючих опцій, крім першої
        groupSelect.innerHTML = '<option value="">-- Оберіть групу --</option>';
        teacherSelect.innerHTML = '<option value="">-- Всі викладачі --</option>';
        daySelect.innerHTML = '<option value="">-- Всі дні --</option>';

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
    }

    function showStatus(msg, type) {
        uploadStatus.textContent = msg;
        uploadStatus.className = 'status-msg ' + type;
        uploadStatus.style.display = 'block';
    }

    // Обробка пошуку
    searchBtn.addEventListener('click', async () => {
        if (!groupSelect.value) {
            alert('Вибір групи є обов\'язковим!');
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

            loading.style.display = 'none';
            resultsCard.style.display = 'block';
            resultsPre.textContent = data.result;

            parseAndShowRecommendations(data.result);
        } catch (err) {
            loading.style.display = 'none';
            alert('Помилка при виконанні запиту: ' + err.message);
        }
    });

    toggleRaw.addEventListener('click', () => {
        resultsPre.style.display = resultsPre.style.display === 'none' ? 'block' : 'none';
    });

    function parseAndShowRecommendations(n3) {
        // Розділення N3 на окремі блоки занять (розділювач 'ex:recommendedLesson')
        const blocks = n3.split('ex:recommendedLesson').slice(1);
        
        if (blocks.length === 0) {
            recommendationsDiv.innerHTML = '<p>Занять не знайдено за вашим запитом.</p>';
            return;
        }

        recommendationsDiv.innerHTML = `<h3>Знайдено занять: ${blocks.length}</h3>`;
        
        blocks.forEach(block => {
            // Надійніше витягування даних за допомогою регулярних виразів для кожного поля
            const subjectMatch = block.match(/ex:subject\s+"([^"]+)"/);
            const dayMatch = block.match(/ex:dayOfWeek\s+"([^"]+)"/);
            const timeMatch = block.match(/ex:timeStart\s+"([^"]+)"/);
            const linkMatch = block.match(/ex:link\s+"([^"]+)"/);
            
            // Шукаємо властивість fullName викладача замість просто ID
            const teacherNameMatch = block.match(/ex:fullName\s+"([^"]+)"/);

            if (subjectMatch && dayMatch && timeMatch) {
                const subject = subjectMatch[1];
                const day = dayMatch[1];
                const time = timeMatch[1];
                const link = linkMatch ? linkMatch[1] : "Не вказано";
                const teacherName = teacherNameMatch ? teacherNameMatch[1] : "Невідомий викладач";

                const div = document.createElement('div');
                div.className = 'recommendation';
                div.innerHTML = `
                    <p><strong>📖 Дисципліна:</strong> ${subject}</p>
                    <p><strong>📅 День:</strong> ${day}</p>
                    <p><strong>⏰ Час:</strong> ${time}</p>
                    <p><strong>👤 Викладач:</strong> ${teacherName}</p>
                    <p><strong>🔗 Посилання:</strong> ${link.startsWith('http') ? `<a href="${link}" target="_blank">${link}</a>` : link}</p>
                `;
                recommendationsDiv.appendChild(div);
            }
        });
    }
});
