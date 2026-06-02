const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const XLSX = require('xlsx');
const { n3reasoner } = require('eyereasoner');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'frontend')));

const PORT = 3001;
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

// Допоміжна функція для очищення рядків для літералів N3
function sanitize(str) {
    if (!str) return "";
    return str.toString()
        .replace(/\\/g, '\\\\') // екранування зворотних слешів
        .replace(/"/g, '\\"')   // екранування подвійних лапок
        .replace(/\n/g, ' ')    // заміна переносів рядків пробілами
        .replace(/\r/g, '')     // видалення повернення каретки
        .trim();
}

// Шляхи до N3 файлів
const ONTOLOGY_PATH = path.join(__dirname, '..', 'rdf', 'ontology.n3');
const DATA_PATH = path.join(__dirname, '..', 'rdf', 'data.n3');
const RULES_PATH = path.join(__dirname, '..', 'rdf', 'rules.n3');

const TIME_MAPPING = {
    "1": "09:00 - 10:20",
    "2": "10:40 - 12:00",
    "3": "12:20 - 13:40",
    "4": "14:00 - 15:20",
    "5": "15:40 - 17:00",
    "6": "17:20 - 18:40",
    "7": "19:00 - 20:20"
};

// Метадані в пам'яті, щоб уникнути повторного парсингу data.n3 щоразу
let currentMetadata = { groups: [], teachers: [], days: ["ПОНЕДІЛОК", "ВІВТОРОК", "СЕРЕДА", "ЧЕТВЕР", "П'ЯТНИЦЯ"] };

app.post('/api/upload', upload.single('schedule'), (req, res) => {
    try {
        const workbook = XLSX.readFile(req.file.path);
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        
        // Крок 0: заповнення об'єднаних комірок
        if (sheet['!merges']) {
            sheet['!merges'].forEach(merge => {
                const startCell = sheet[XLSX.utils.encode_cell(merge.s)];
                if (startCell) {
                    for (let r = merge.s.r; r <= merge.e.r; r++) {
                        for (let c = merge.s.c; c <= merge.e.c; c++) {
                            if (r === merge.s.r && c === merge.s.c) continue;
                            sheet[XLSX.utils.encode_cell({ r, c })] = { ...startCell };
                        }
                    }
                }
            });
        }

        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

        let n3Data = '@prefix ex: <http://example.org#> .\n@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .\n\n';
        
        console.log('Початок обробки файлу...');
        // Пошук заголовків груп (шукаємо рядок, що починається з "Група")
        let groupRowIdx = -1;
        for (let r = 0; r < Math.min(rows.length, 30); r++) {
            if (rows[r] && rows[r].some(cell => cell && typeof cell === 'string' && cell.trim().startsWith('Група'))) {
                groupRowIdx = r;
                console.log(`Знайдено рядок "Група" на індексі ${r}`);
                break;
            }
        }

        if (groupRowIdx === -1) {
            console.warn('Не вдалося знайти рядок "Група", використовуємо стандартний індекс 10');
            groupRowIdx = 10;
        }

        const groupRow = rows[groupRowIdx];
        const nextRow = rows[groupRowIdx + 1] || [];
        const groups = [];
        const colMap = {};

        console.log('Парсинг груп з рядка:', groupRowIdx);
        groupRow.forEach((cell, idx) => {
            let groupName = null;
            const groupRegex = /(\d+-\d+[а-я]*)/i; // Гнучкий регулярний вираз для назв груп

            if (cell && typeof cell === 'string' && groupRegex.test(cell)) {
                const match = cell.match(groupRegex);
                groupName = match[1].trim();
            } else if (nextRow[idx] && typeof nextRow[idx] === 'string' && groupRegex.test(nextRow[idx])) {
                const match = nextRow[idx].match(groupRegex);
                groupName = match[1].trim();
            }

            if (groupName) {
                console.log(`Знайдено групу "${groupName}" у колонці ${idx}`);
                groups.push(groupName);
                colMap[idx] = groupName;
            }
        });

        // Крок 1: групування рядків за слотами занять
        const slots = [];
        let currentDay = 'ПОНЕДІЛОК';
        let currentLessonNum = '';
        const dayNames = ["ПОНЕДІЛОК", "ВІВТОРОК", "СЕРЕДА", "ЧЕТВЕР", "П'ЯТНИЦЯ"];

        for (let i = groupRowIdx + 1; i < rows.length; i++) {
            const row = rows[i];
            if (!row || row.length === 0) continue;

            // Визначення дня
            let detectedDay = '';
            for (let c = 0; c < Math.min(row.length, 5); c++) {
                if (row[c] && typeof row[c] === 'string') {
                    const potentialDay = row[c].trim().toUpperCase();
                    if (dayNames.some(d => potentialDay.includes(d))) {
                        detectedDay = dayNames.find(d => potentialDay.includes(d));
                        break;
                    }
                }
            }

            // Визначення номера пари
            let foundPara = '';
            [1, 11, 19, 27].forEach(colIdx => {
                if (!foundPara && row[colIdx] !== undefined && row[colIdx] !== null && row[colIdx] !== '') {
                    const val = row[colIdx].toString().trim();
                    if (val.match(/^\d+$/)) foundPara = val;
                }
            });

            // Початок нового слоту лише якщо змінився день або номер пари
            if (foundPara && (foundPara !== currentLessonNum || (detectedDay && detectedDay !== currentDay))) {
                currentLessonNum = foundPara;
                if (detectedDay) currentDay = detectedDay;
                
                slots.push({
                    day: currentDay,
                    num: currentLessonNum,
                    rows: [row]
                });
            } else if (slots.length > 0) {
                // Якщо день змінився, але номер пари ще не знайдено - оновлення currentDay
                if (detectedDay && detectedDay !== currentDay) currentDay = detectedDay;
                
                slots[slots.length - 1].rows.push(row);
            }
        }

        const teachers = new Set();
        let lessonCount = 0;
        // Регулярний вираз для українських імен викладачів
        const teacherRegex = /(проф\.|доц\.|ст\.викл\.|викл\.|ас\.|асист\.)\s*([А-ЯЁІЇЄҐ][а-яёіїєґ\-]+\s+[А-ЯЁІЇЄҐ]\.\s*[А-ЯЁІЇЄҐ]\.?)?|([А-ЯЁІЇЄҐ][а-яёіїєґ\-]+\s+[А-ЯЁІЇЄҐ]\.\s*[А-ЯЁІЇЄҐ]\.?)/gi;
        const linkRegex = /(https?:\/\/[^\s]+)/gi;
        const garbageKeywords = ['пароль', 'ідентифікатор', 'код доступу', 'zoom', 'конференції', 'п:', 'ідентифікатор:'];

        console.log(`Обробка ${slots.length} слотів занять...`);

        // Щоб уникнути дублікатів через об'єднані комірки, відстежуємо оброблені заняття для кожної групи/слоту
        const processedLessons = new Set();

        // Крок 2: обробка кожного слоту
        slots.forEach(slot => {
            Object.keys(colMap).forEach(colIdx => {
                const groupName = colMap[colIdx];
                const slotKey = `${groupName}_${slot.day}_${slot.num}`;
                
                // Об'єднання всіх значень комірок для цієї групи в цьому слоті
                const cellValues = slot.rows
                    .map(r => r[colIdx])
                    .filter(v => v && typeof v === 'string' && v.trim().length > 0);
                
                if (cellValues.length === 0) return;

                const combinedText = cellValues.join('\n');
                
                // Використання хешу контенту, щоб уникнути повторної обробки тих самих даних
                const contentHash = `${slotKey}_${combinedText.trim()}`;
                if (processedLessons.has(contentHash)) return;
                processedLessons.add(contentHash);

                // Пошук всіх викладачів
                const tMatches = combinedText.match(teacherRegex) || [];
                const foundTeachers = tMatches.map(m => m.replace(/(проф\.|доц\.|ст\.викл\.|викл\.|ас\.|асист\.)/gi, '').trim());
                
                // Пошук всіх посилань Zoom
                const foundLinks = combinedText.match(linkRegex) || [];
                
                // Очищення тексту, щоб знайти назву дисципліни
                let cleanedText = combinedText;
                foundLinks.forEach(l => cleanedText = cleanedText.replace(l, ' '));
                tMatches.forEach(t => cleanedText = cleanedText.replace(t, ' '));
                
                cleanedText = cleanedText
                    .replace(/\(тільки\s+[^)]+\)/gi, ' ')
                    .replace(/\(крім\s+[^)]+\)/gi, ' ')
                    .replace(/ідентифікатор:?\s*[^\n]*/gi, ' ')
                    .replace(/код доступу:?\s*[^\n]*/gi, ' ')
                    .replace(/meeting id:?\s*[^\n]*/gi, ' ')
                    .replace(/passcode:?\s*[^\n]*/gi, ' ')
                    .replace(/пароль:?\s*[^\n]*/gi, ' ')
                    .replace(/^\d+-\d+[а-я]*$/gim, ' ')
                    .replace(/["'«»]/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim();

                // Якщо залишилося щось змістовне - це потрібна дисципліна
                if (cleanedText.length > 3 || foundTeachers.length > 0) {
                    const finalSubject = cleanedText.length > 3 ? cleanedText : "Дисципліна (не вдалося розпізнати)";
                    const teacherName = foundTeachers[0] || "Невідомий викладач";
                    const zoomLink = foundLinks[0] || "Дистанційно (посилання не знайдено)";

                    const lessonId = `lesson_${++lessonCount}`;
                    const timeRange = TIME_MAPPING[slot.num] || "";
                    const displayTime = timeRange ? `Пара ${slot.num} (${timeRange})` : `Пара ${slot.num}`;

                    if (teacherName !== "Невідомий викладач") {
                        teachers.add(teacherName);
                    }

                    const cleanGroupName = groupName.replace(/[^a-zA-Z0-9а-яА-ЯёЁіїєґІЇЄҐ]/g, '_');
                    const cleanTeacherId = teacherName.replace(/[^a-zA-Z0-9а-яА-ЯёЁіїєґІЇЄҐ]/g, '_');

                    n3Data += `ex:${lessonId} a ex:Lesson ;\n`;
                    n3Data += `    ex:subject "${sanitize(finalSubject)}" ;\n`;
                    n3Data += `    ex:dayOfWeek "${sanitize(slot.day)}" ;\n`;
                    n3Data += `    ex:timeStart "${sanitize(displayTime)}" ;\n`;
                    n3Data += `    ex:hasTeacher ex:${cleanTeacherId} ;\n`;
                    n3Data += `    ex:link "${sanitize(zoomLink)}" ;\n`;
                    n3Data += `    ex:belongsToGroup ex:group_${cleanGroupName} .\n\n`;
                    
                    n3Data += `ex:group_${cleanGroupName} a ex:Group ; ex:groupName "${sanitize(groupName)}" .\n`;
                    n3Data += `ex:${cleanTeacherId} a ex:Teacher ; ex:fullName "${sanitize(teacherName)}" .\n\n`;
                }
            });
        });

        console.log(`Обробка завершена. Всього занять: ${lessonCount}, груп: ${groups.length}, викладачів: ${teachers.size}`);
        
        fs.writeFileSync(DATA_PATH, n3Data);
        
        currentMetadata = {
            groups: [...new Set(groups)],
            teachers: Array.from(teachers).sort(),
            days: ["ПОНЕДІЛОК", "ВІВТОРОК", "СЕРЕДА", "ЧЕТВЕР", "П'ЯТНИЦЯ"]
        };

        res.json({ success: true, metadata: currentMetadata });
    } catch (error) {
        console.error('Помилка обробки Excel:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/query', async (req, res) => {
    try {
        const { group, teacher, day } = req.body;

        const ontology = fs.readFileSync(ONTOLOGY_PATH, 'utf8');
        const data = fs.readFileSync(DATA_PATH, 'utf8');
        const rules = fs.readFileSync(RULES_PATH, 'utf8');

        let queryN3 = `
@prefix ex: <http://example.org#> .
ex:user_1 ex:hasQuery ex:dynamic_query .
ex:user_1 ex:hasRecommendation ex:rec_1 .
ex:rec_1 a ex:Recommendation .
ex:dynamic_query a ex:ScheduleQuery ;
    ex:queryGroup ex:group_${group.replace(/[^a-zA-Z0-9а-яА-ЯёЁіїєґІЇЄҐ]/g, '_')} .
`;

        if (day) {
            // Перевірка на точну відповідність формату дня в Excel
            const cleanDay = day.trim().toUpperCase();
            queryN3 += `ex:dynamic_query ex:queryDay "${cleanDay}" .\n`;
            queryN3 += `ex:dynamic_query ex:hasDayFilter "true" .\n`;
        } else {
            queryN3 += `ex:dynamic_query ex:noDayFilter "true" .\n`;
        }

        if (teacher) {
            const cleanTeacherId = teacher.replace(/[^a-zA-Z0-9а-яА-ЯёЁіїєґІЇЄҐ]/g, '_');
            queryN3 += `ex:dynamic_query ex:queryTeacher ex:${cleanTeacherId} .\n`;
            queryN3 += `ex:dynamic_query ex:hasTeacherFilter "true" .\n`;
        } else {
            queryN3 += `ex:dynamic_query ex:noTeacherFilter "true" .\n`;
        }

        const fullData = `${ontology}\n${data}\n${rules}\n${queryN3}`;
        
        console.log('--- ПОЧАТОК REASONING ---');
        console.log('Активні фільтри:', { day: !!day, teacher: !!teacher });

        // Оновлений запит для отримання повного імені викладача разом з деталями заняття
        const query = `
@prefix ex: <http://example.org#> .
{ 
  ?rec ex:recommendedLesson ?lesson . 
  ?lesson ?p ?o .
  ?lesson ex:hasTeacher ?t . 
  ?t ex:fullName ?name .
} => { 
  ?rec ex:recommendedLesson ?lesson . 
  ?lesson ?p ?o .
  ?t ex:fullName ?name .
} .
`;
        
        const result = await n3reasoner(fullData, query);
        console.log('Довжина результату:', result ? result.length : 0);
        res.json({ result });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Сервер запущено на http://localhost:${PORT}`);
});
