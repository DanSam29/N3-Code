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

// Paths to N3 files
const ONTOLOGY_PATH = path.join(__dirname, '..', 'rdf', 'ontology.n3');
const DATA_PATH = path.join(__dirname, '..', 'rdf', 'data.n3');
const RULES_PATH = path.join(__dirname, '..', 'rdf', 'rules.n3');

// In-memory metadata to avoid re-parsing data.n3 every time
let currentMetadata = { groups: [], teachers: [], days: ["ПОНЕДІЛОК", "ВІВТОРОК", "СЕРЕДА", "ЧЕТВЕР", "П'ЯТНИЦЯ"] };

app.post('/api/upload', upload.single('schedule'), (req, res) => {
    try {
        const workbook = XLSX.readFile(req.file.path);
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

        let n3Data = '@prefix ex: <http://example.org#> .\n@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .\n\n';
        
        console.log('Starting file processing...');
        // Find group headers (Looking for row with "Група")
        let groupRowIdx = -1;
        for (let r = 0; r < Math.min(rows.length, 30); r++) {
            if (rows[r] && rows[r].some(cell => cell && typeof cell === 'string' && cell.trim().startsWith('Група'))) {
                groupRowIdx = r;
                console.log(`Found "Група" at row ${r}`);
                break;
            }
        }

        if (groupRowIdx === -1) {
            console.warn('Could not find "Група" row, using default index 10');
            groupRowIdx = 10;
        }

        const groupRow = rows[groupRowIdx];
        const nextRow = rows[groupRowIdx + 1] || [];
        const groups = [];
        const colMap = {};

        console.log('Parsing groups from row:', groupRowIdx);
        groupRow.forEach((cell, idx) => {
            let groupName = null;
            const groupRegex = /(\d+-\d+[а-я]*)/i; // More flexible regex for group names

            if (cell && typeof cell === 'string' && groupRegex.test(cell)) {
                const match = cell.match(groupRegex);
                groupName = match[1].trim();
            } else if (nextRow[idx] && typeof nextRow[idx] === 'string' && groupRegex.test(nextRow[idx])) {
                const match = nextRow[idx].match(groupRegex);
                groupName = match[1].trim();
            }

            if (groupName) {
                console.log(`Found group "${groupName}" at column ${idx}`);
                groups.push(groupName);
                colMap[idx] = groupName;
            }
        });

        const teachers = new Set();
        let lessonCount = 0;
        let currentDay = 'ПОНЕДІЛОК';
        let currentLessonNum = '';

        console.log(`Starting lesson parsing from row ${groupRowIdx + 1}`);
        // Parse lessons
        for (let i = groupRowIdx + 1; i < rows.length; i++) {
            const row = rows[i];
            if (!row || row.length === 0) continue;

            // Day detection
            const dayNames = ["ПОНЕДІЛОК", "ВІВТОРОК", "СЕРЕДА", "ЧЕТВЕР", "П'ЯТНИЦЯ"];
            if (row[0] && typeof row[0] === 'string') {
                const potentialDay = row[0].trim().toUpperCase();
                if (dayNames.some(d => potentialDay.includes(d))) {
                    currentDay = dayNames.find(d => potentialDay.includes(d));
                    console.log(`Detected day: ${currentDay} at row ${i}`);
                }
            }

            // Lesson number carry over (merged cells)
            if (row[1] !== undefined && row[1] !== null && row[1] !== '') {
                currentLessonNum = row[1];
            }
            
            if (!currentLessonNum) continue;

            // For each group column, check if there's a lesson
            Object.keys(colMap).forEach(colIdx => {
                const cellValue = row[colIdx];
                if (cellValue && typeof cellValue === 'string' && cellValue.trim().length > 3) {
                    const groupName = colMap[colIdx];
                    
                    // --- STRICT LESSON VALIDATION ---
                    const lowerVal = cellValue.toLowerCase();
                    const garbageKeywords = ['пароль', 'ідентифікатор', 'код доступу', 'zoom', 'http', 'конференції', 'п:', 'ідентифікатор:'];
                    
                    // 1. Skip if contains garbage keywords as main content
                    if (garbageKeywords.some(k => lowerVal.includes(k))) return;
                    
                    // 2. Skip if it's just a group name (metadata caught in rows)
                    if (cellValue.trim().match(/^\d+-\d+[а-я]*$/i)) return;

                    // 3. Skip if it's too short (but allow short Ukrainian words with spaces)
                    if (cellValue.trim().length < 3) return;

                    const lessonId = `lesson_${++lessonCount}`;
                    
                    // --- IMPROVED TEACHER EXTRACTION ---
                    let teacherName = "Unknown_Teacher";
                    // Regex for teacher titles and names (more flexible)
                    const teacherRegex = /(проф\.|доц\.|ст\.викл\.|викл\.|ас\.|асист\.)\s*([А-ЯЁ][а-яё\-]+\s+[А-ЯЁ]\.\s*[А-ЯЁ]\.?)?|([А-ЯЁ][а-яё\-]+\s+[А-ЯЁ]\.\s*[А-ЯЁ]\.?)/i;
                    
                    // Check multiple sources for teacher name
                    const potentialSources = [
                        cellValue, // Current cell
                        rows[i + 1] ? rows[i + 1][colIdx] : null, // 1 row below
                        rows[i + 2] ? rows[i + 2][colIdx] : null, // 2 rows below
                    ];

                    for (const source of potentialSources) {
                        if (source && typeof source === 'string') {
                            const match = source.match(teacherRegex);
                            if (match) {
                                // Prefer the full match with title if available
                                const rawName = match[0].trim();
                                // Clean up the name for the ID: remove titles and special chars
                                teacherName = rawName
                                    .replace(/(проф\.|доц\.|ст\.викл\.|викл\.|ас\.|асист\.)/gi, '')
                                    .trim()
                                    .replace(/\s+/g, '_')
                                    .replace(/\./g, '');
                                break;
                            }
                        }
                    }
                    
                    if (teacherName !== "Unknown_Teacher" && teacherName.length > 3) {
                        teachers.add(teacherName.replace(/_/g, ' '));
                    }

                    // --- EXTRACT ZOOM/MEET LINKS ---
                    let zoomLink = "Дистанційно (посилання не знайдено)";
                    const linkRegex = /(https?:\/\/[^\s]+)/gi;
                    
                    // Search in the same cell and cells below for links
                    for (const source of potentialSources) {
                        if (source && typeof source === 'string') {
                            const linkMatch = source.match(linkRegex);
                            if (linkMatch) {
                                zoomLink = linkMatch[0].trim();
                                break;
                            }
                        }
                    }

                    // --- IMPROVED SUBJECT CLEANING ---
                    const cellLines = cellValue.split('\n').map(l => l.trim()).filter(l => l.length > 0);
                    let subject = "";
                    let foundSubject = false;
                    
                    for (const line of cellLines) {
                        const lowLine = line.toLowerCase();
                        
                        // 1. Skip technical lines
                        if (lowLine.includes('тільки') || lowLine.includes('пара') || 
                            garbageKeywords.some(k => lowLine.includes(k)) || 
                            line.match(/^\d+-\d+[а-я]*$/i)) {
                            continue;
                        }

                        // 2. If line contains a teacher name, remove it to get the subject
                        let cleanedLine = line;
                        const tMatch = line.match(teacherRegex);
                        if (tMatch) {
                            cleanedLine = line.replace(tMatch[0], '').trim();
                        }

                        // 3. If something meaningful is left, it's our subject
                        if (cleanedLine.length > 2 && !garbageKeywords.some(k => cleanedLine.toLowerCase().includes(k))) {
                            subject = cleanedLine.replace(/"/g, "'").trim();
                            foundSubject = true;
                            break;
                        }
                    }

                    // If no valid subject found, skip this record
                    if (!foundSubject || subject.length < 3) return;

                    const cleanGroupName = groupName.replace(/[^a-zA-Z0-9]/g, '_');
                    // Allow Cyrillic in IDs, just replace spaces and sensitive chars
                    const cleanTeacherId = teacherName.replace(/\s+/g, '_').replace(/["';<>(){}\[\]]/g, '');

                    n3Data += `ex:${lessonId} a ex:Lesson ;\n`;
                    n3Data += `    ex:subject "${subject}" ;\n`;
                    n3Data += `    ex:dayOfWeek "${currentDay}" ;\n`;
                    n3Data += `    ex:timeStart "Пара ${currentLessonNum}" ;\n`;
                    n3Data += `    ex:hasTeacher ex:${cleanTeacherId} ;\n`;
                    n3Data += `    ex:link "${zoomLink}" ;\n`;
                    n3Data += `    ex:belongsToGroup ex:group_${cleanGroupName} .\n\n`;
                    
                    n3Data += `ex:group_${cleanGroupName} a ex:Group ; ex:groupName "${groupName}" .\n`;
                    n3Data += `ex:${cleanTeacherId} a ex:Teacher ; ex:fullName "${teacherName.replace(/_/g, ' ')}" .\n\n`;
                }
            });
        }

        console.log(`Parsing finished. Total lessons: ${lessonCount}, Total groups: ${groups.length}, Total teachers: ${teachers.size}`);
        
        fs.writeFileSync(DATA_PATH, n3Data);
        
        currentMetadata = {
            groups: [...new Set(groups)],
            teachers: Array.from(teachers).sort(),
            days: ["ПОНЕДІЛОК", "ВІВТОРОК", "СЕРЕДА", "ЧЕТВЕР", "П'ЯТНИЦЯ"]
        };

        res.json({ success: true, metadata: currentMetadata });
    } catch (error) {
        console.error('Error processing Excel:', error);
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
    ex:queryGroup ex:group_${group.replace(/-/g, '_')} .
`;

        if (day) {
            // Ensure exact match with Excel day format
            const cleanDay = day.trim().toUpperCase();
            queryN3 += `ex:dynamic_query ex:queryDay "${cleanDay}" .\n`;
            queryN3 += `ex:dynamic_query ex:hasDayFilter "true" .\n`;
        } else {
            queryN3 += `ex:dynamic_query ex:noDayFilter "true" .\n`;
        }

        if (teacher) {
            // Allow Cyrillic in IDs, just replace spaces and sensitive chars
            const cleanTeacherId = teacher.replace(/\s+/g, '_').replace(/["';<>(){}\[\]]/g, '');
            queryN3 += `ex:dynamic_query ex:queryTeacher ex:${cleanTeacherId} .\n`;
            queryN3 += `ex:dynamic_query ex:hasTeacherFilter "true" .\n`;
        } else {
            queryN3 += `ex:dynamic_query ex:noTeacherFilter "true" .\n`;
        }

        const fullData = `${ontology}\n${data}\n${rules}\n${queryN3}`;
        
        console.log('--- REASONING START ---');
        console.log('Active filters:', { day: !!day, teacher: !!teacher });

        // Updated query to fetch teacher's full name along with lesson details
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
        console.log('Result length:', result ? result.length : 0);
        res.json({ result });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
