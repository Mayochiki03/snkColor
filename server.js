require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cron = require('node-cron');
const ExcelJS = require('exceljs');
const archiver = require('archiver');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());

// เปิดให้เข้าถึงไฟล์หน้าบ้าน
app.use(express.static(path.join(__dirname, 'public'), {
    setHeaders: (res, filePath) => {
        // ป้องกันเบราว์เซอร์แคชหน้าเว็บ/ไฟล์ JS เก่าไว้ ทำให้ทุกครั้งที่มีการอัปเดตโค้ด
        // ผู้ใช้จะเห็นเวอร์ชันล่าสุดทันทีโดยไม่ต้องกด Hard Refresh เอง
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
    }
}));

// --------------------------------------------------------
// เชื่อมต่อฐานข้อมูล MongoDB
// ตั้งค่า MONGODB_URI ผ่าน environment variable (เช่นบน Render ตั้งใน Environment)
// ถ้ารันในเครื่องตัวเองไม่ได้ตั้งไว้ จะ fallback ไปที่ mongodb://127.0.0.1:27017/checkin_system
// --------------------------------------------------------
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/checkin_system';

mongoose.connect(MONGODB_URI)
    .then(() => console.log('✅ เชื่อมต่อ MongoDB สำเร็จ'))
    .catch((err) => {
        console.error('❌ เชื่อมต่อ MongoDB ไม่สำเร็จ:', err.message);
        console.error('   ตรวจสอบค่า MONGODB_URI ใน environment variable ให้ถูกต้อง');
    });

mongoose.connection.on('error', (err) => {
    console.error('⚠️  MongoDB connection error:', err.message);
});

// --------------------------------------------------------
// Schemas
// --------------------------------------------------------
const studentSchema = new mongoose.Schema({
    studentId: { type: String, required: true, index: true },
    name: { type: String, required: true },
    class: { type: String, default: '' },
    color: { type: String, default: '' }
}, { versionKey: false });
studentSchema.index({ color: 1 });

const attendanceSchema = new mongoose.Schema({
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true, index: true },
    date: { type: String, required: true, index: true }, // YYYY-MM-DD
    status: { type: String, enum: ['present', 'absent'], default: 'absent' }
}, { versionKey: false });
attendanceSchema.index({ studentId: 1, date: 1 }, { unique: true });

const Student = mongoose.model('Student', studentSchema);
const Attendance = mongoose.model('Attendance', attendanceSchema);

// สร้างโฟลเดอร์สำหรับเก็บไฟล์ Excel (ถ้ายังไม่มี)
const exportDir = path.join(__dirname, 'exports');
if (!fs.existsSync(exportDir)) {
    fs.mkdirSync(exportDir, { recursive: true });
}

// --------------------------------------------------------
// นำเข้ารายชื่อนักเรียนจากไฟล์ ชื่อเเละสี.txt ตอนเริ่มระบบครั้งแรก
// (ทำครั้งเดียว ถ้ามีข้อมูลอยู่แล้วจะข้าม)
// --------------------------------------------------------
async function seedStudentsIfEmpty() {
    try {
        const count = await Student.countDocuments();
        if (count > 0) return;

        const filePath = path.join(__dirname, 'ชื่อเเละสี.txt');
        if (!fs.existsSync(filePath)) {
            console.log('❌ ไม่พบไฟล์ ชื่อเเละสี.txt โปรดนำไฟล์มาวางในโฟลเดอร์เดียวกับ server.js');
            return;
        }

        console.log('⏳ กำลังนำเข้าข้อมูลจากไฟล์ ชื่อเเละสี.txt...');
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split(/\r?\n/);

        const docs = [];
        lines.forEach(line => {
            if (!line.trim()) return; // ข้ามบรรทัดว่าง
            const parts = line.split('\t');
            if (parts.length >= 4) {
                docs.push({
                    studentId: parts[0].trim(),
                    name: parts[1].trim(),
                    class: parts[2].trim(),
                    color: parts[3].trim().replace(/^สี/, '') // ลบคำว่า "สี" ออกให้เหลือแค่ แดง, น้ำเงิน
                });
            }
        });

        if (docs.length > 0) {
            await Student.insertMany(docs);
            console.log(`⚡ นำเข้าข้อมูลนักเรียนสำเร็จ! ทั้งหมด ${docs.length} คน`);
        }
    } catch (err) {
        console.error('❌ เกิดข้อผิดพลาดในการนำเข้าข้อมูลนักเรียน:', err.message);
    }
}

mongoose.connection.once('open', () => {
    seedStudentsIfEmpty();
});

// --------------------------------------------------------
// ฟังก์ชันดึงวันที่ปัจจุบัน (YYYY-MM-DD ตามเวลาไทย)
// --------------------------------------------------------
function getTodayDate() {
    const d = new Date();
    const offset = d.getTimezoneOffset() * 60000;
    const localISOTime = (new Date(d.getTime() - offset)).toISOString();
    return localISOTime.split('T')[0];
}

// ตรวจสอบรูปแบบวันที่ YYYY-MM-DD และไม่ให้เป็นวันในอนาคต (เช็คชื่อ/ดูสรุปย้อนหลังได้ แต่ไม่ล่วงหน้า)
function parseValidDate(input) {
    if (!input || typeof input !== 'string') return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) return null;
    const d = new Date(input + 'T00:00:00');
    if (Number.isNaN(d.getTime())) return null;
    const today = getTodayDate();
    if (input > today) return null; // ห้ามเลือกวันอนาคต
    return input;
}

// --------------------------------------------------------
// จัดกลุ่มชั้นเรียนเป็นช่วงชั้น (ป.1-3 / ป.4-6 / ม.1-3 / ม.4-6)
// สมมติว่าชื่อชั้นเรียนขึ้นต้นด้วย "ป." หรือ "ม." ตามด้วยเลข 1-6 เช่น "ป.4/2", "ม.5/1"
// ถ้ารูปแบบไม่ตรง จะถูกจัดเข้ากลุ่ม "ไม่ระบุช่วงชั้น" แทน
// --------------------------------------------------------
function getGradeBand(className) {
    if (!className) return 'ไม่ระบุช่วงชั้น';
    const match = className.trim().match(/^(ป|ม)\.?\s*(\d)/);
    if (!match) return 'ไม่ระบุช่วงชั้น';
    const level = match[1];
    const grade = parseInt(match[2], 10);
    if (level === 'ป') return grade <= 3 ? 'ป.1-3' : 'ป.4-6';
    if (level === 'ม') return grade <= 3 ? 'ม.1-3' : 'ม.4-6';
    return 'ไม่ระบุช่วงชั้น';
}

const BAND_ORDER = ['ป.1-3', 'ป.4-6', 'ม.1-3', 'ม.4-6', 'ไม่ระบุช่วงชั้น'];
const VALID_COLORS = ['แดง', 'น้ำเงิน', 'เขียว', 'ชมพู'];
const COLOR_ORDER = [...VALID_COLORS, 'none'];

// ทำสีให้อยู่ในรูปแบบมาตรฐานเดียวกัน (ตัดคำว่า "สี" ออก, ค่าว่าง/ไม่รู้จัก -> 'none')
function normalizeColor(rawColor) {
    if (!rawColor) return 'none';
    const stripped = String(rawColor).trim().replace(/^สี/, '');
    return VALID_COLORS.includes(stripped) ? stripped : 'none';
}

// --------------------------------------------------------
// API 1: ดึงรายชื่อนักเรียน + สถานะของวันที่ระบุ (ค่าเริ่มต้นคือวันนี้)
// รองรับ query param ?date=YYYY-MM-DD เพื่อเช็คชื่อ/แก้ไขย้อนหลังได้
// --------------------------------------------------------
app.get('/api/students', async (req, res) => {
    try {
        const color = req.query.color;
        const date = parseValidDate(req.query.date) || getTodayDate();

        let filter = {};
        if (color === 'none') {
            filter = { $or: [{ color: null }, { color: '' }, { color: 'none' }, { color: { $exists: false } }] };
        } else if (color) {
            filter = { $or: [{ color: color }, { color: `สี${color}` }] };
        }

        const students = await Student.find(filter).sort({ class: 1, studentId: 1 }).lean();
        const ids = students.map(s => s._id);
        const attendances = await Attendance.find({ studentId: { $in: ids }, date }).lean();
        const statusMap = new Map(attendances.map(a => [String(a.studentId), a.status]));

        const result = students.map(s => ({
            id: s._id,
            student_id: s.studentId,
            name: s.name,
            class: s.class,
            color: s.color,
            status: statusMap.get(String(s._id)) || 'absent'
        }));

        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --------------------------------------------------------
// API 2: บันทึกสถานะการเช็คชื่อ (รองรับ date ใน body เพื่อบันทึกย้อนหลังได้)
// --------------------------------------------------------
app.post('/api/check', async (req, res) => {
    try {
        const { id, status } = req.body;
        const date = parseValidDate(req.body.date) || getTodayDate();

        if (!id || !['present', 'absent'].includes(status)) {
            return res.status(400).json({ error: 'ข้อมูลไม่ถูกต้อง' });
        }

        await Attendance.findOneAndUpdate(
            { studentId: id, date },
            { studentId: id, date, status },
            { upsert: true, new: true }
        );
        res.json({ success: true, date });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --------------------------------------------------------
// API 4: กำหนด/แก้ไขกลุ่มสีให้นักเรียนคนหนึ่ง
// ใช้ตอนครูหากลุ่มสีของตัวเองไม่เจอ แล้วไปเจอเด็กคนนั้นอยู่ในกลุ่ม "ยังไม่ระบุ" แทน
// --------------------------------------------------------
app.post('/api/students/:id/color', async (req, res) => {
    try {
        const { id } = req.params;
        const { color } = req.body;

        if (!VALID_COLORS.includes(color)) {
            return res.status(400).json({ error: 'สีไม่ถูกต้อง' });
        }

        const updated = await Student.findByIdAndUpdate(id, { color }, { new: true });
        if (!updated) return res.status(404).json({ error: 'ไม่พบนักเรียนคนนี้' });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --------------------------------------------------------
// API 5: สรุปข้อมูลรายวันสำหรับหน้าแดชบอร์ด
// --------------------------------------------------------
app.get('/api/dashboard/summary', async (req, res) => {
    try {
        const date = parseValidDate(req.query.date) || getTodayDate();

        const students = await Student.find({}).lean();
        const attendances = await Attendance.find({ date }).lean();
        const attMap = new Map(attendances.map(a => [String(a.studentId), a.status]));

        let totalPresent = 0;
        const colorStats = {};
        const classStats = {};

        students.forEach(s => {
            const status = attMap.get(String(s._id)) || 'absent';
            if (status === 'present') totalPresent++;

            const normColor = normalizeColor(s.color);
            if (!colorStats[normColor]) colorStats[normColor] = { color: normColor, total: 0, present: 0 };
            colorStats[normColor].total++;
            if (status === 'present') colorStats[normColor].present++;

            const cls = s.class ? s.class.trim() : 'ไม่ระบุห้อง';
            if (!classStats[cls]) classStats[cls] = { class: cls, band: getGradeBand(cls), total: 0, present: 0 };
            classStats[cls].total++;
            if (status === 'present') classStats[cls].present++;
        });

        const byClass = Object.values(classStats).sort((a, b) => a.class.localeCompare(b.class, 'th'));

        res.json({
            date,
            totalStudents: students.length,
            totalPresent,
            totalAbsent: students.length - totalPresent,
            byColor: COLOR_ORDER.map(c => colorStats[c] || { color: c, total: 0, present: 0 }),
            byClass
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --------------------------------------------------------
// API 6: แนวโน้มย้อนหลัง N วัน (ใช้วาดกราฟแท่งเล็กๆ ในแดชบอร์ด)
// --------------------------------------------------------
app.get('/api/dashboard/history', async (req, res) => {
    try {
        const days = Math.min(Math.max(parseInt(req.query.days) || 14, 1), 60);
        const endDate = parseValidDate(req.query.date) || getTodayDate();

        const dateList = [];
        const end = new Date(endDate + 'T00:00:00');
        for (let i = days - 1; i >= 0; i--) {
            const d = new Date(end);
            d.setDate(d.getDate() - i);
            dateList.push(d.toISOString().split('T')[0]);
        }

        const totalStudents = await Student.countDocuments();
        const grouped = await Attendance.aggregate([
            { $match: { date: { $in: dateList }, status: 'present' } },
            { $group: { _id: '$date', present: { $sum: 1 } } }
        ]);
        const presentMap = new Map(grouped.map(g => [g._id, g.present]));

        res.json(dateList.map(date => ({
            date,
            present: presentMap.get(date) || 0,
            total: totalStudents
        })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --------------------------------------------------------
// API 7: วันที่มีการเช็คชื่อแล้วในเดือนที่ระบุ (ใช้ทำจุดบนปฏิทิน)
// --------------------------------------------------------
app.get('/api/dashboard/available-dates', async (req, res) => {
    try {
        const month = req.query.month; // YYYY-MM
        if (!/^\d{4}-\d{2}$/.test(month)) return res.json([]);
        const dates = await Attendance.distinct('date', { date: { $regex: `^${month}` } });
        res.json(dates.sort());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --------------------------------------------------------
// ฟังก์ชันสรุปข้อมูลลง Excel ของวันที่ระบุ (ใช้ทั้งจาก cron, ปุ่มกดเอง และแดชบอร์ด)
// --------------------------------------------------------
async function exportDailyExcel(dateInput) {
    const date = parseValidDate(dateInput) || getTodayDate();
    console.log(`=== เริ่มกระบวนการสรุปยอดกิจกรรมสีรายวัน (${date}) ===`);

    const students = await Student.find({}).sort({ class: 1, studentId: 1 }).lean();
    const attendances = await Attendance.find({ date }).lean();
    const statusMap = new Map(attendances.map(a => [String(a.studentId), a.status]));

    const rows = students.map(s => ({
        student_id: s.studentId,
        name: s.name,
        class: s.class,
        color: s.color,
        attendance_status: statusMap.get(String(s._id)) === 'present' ? 'เข้าสี' : 'ไม่เข้าสี'
    }));

    // จัดกลุ่ม: ช่วงชั้น -> ห้อง -> รายชื่อนักเรียน
    const bands = {};
    rows.forEach(student => {
        const band = getGradeBand(student.class);
        const roomName = student.class ? student.class.trim() : 'ไม่ระบุห้อง';
        if (!bands[band]) bands[band] = {};
        if (!bands[band][roomName]) bands[band][roomName] = [];
        bands[band][roomName].push(student);
    });

    const columnDefs = [
        { header: 'รหัสนักเรียน', key: 'student_id', width: 13 },
        { header: 'ชื่อ-นามสกุล', key: 'name', width: 26 },
        { header: 'ชั้นเรียน', key: 'class', width: 11 },
        { header: 'กลุ่มสี', key: 'color', width: 10 },
        { header: `สถานะการเข้าสี (${date})`, key: 'status', width: 18 }
    ];

    const generatedFiles = [];

    for (const band of BAND_ORDER) {
        if (!bands[band]) continue; // ข้ามช่วงชั้นที่ไม่มีข้อมูลวันนี้

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet(band.substring(0, 31));

        worksheet.columns = columnDefs; // แถวที่ 1 จะกลายเป็นหัวตารางของห้องแรกอัตโนมัติ

        worksheet.pageSetup = {
            paperSize: 9,           // A4
            orientation: 'landscape',
            fitToPage: true,
            fitToWidth: 1,
            fitToHeight: 0,
            margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
            horizontalCentered: true
        };
        worksheet.pageSetup.printTitlesRow = '1:1';
        worksheet.views = [{ state: 'frozen', ySplit: 1 }];

        worksheet.getRow(1).font = { bold: true, size: 12 };
        worksheet.getRow(1).alignment = { horizontal: 'center' };

        const roomNames = Object.keys(bands[band]).sort((a, b) => a.localeCompare(b, 'th'));

        roomNames.forEach((roomName, roomIndex) => {
            // ห้องถัดไป (ไม่ใช่ห้องแรก) ให้เว้นบรรทัดว่างก่อน แล้วขึ้นหัวข้อห้อง + หัวตารางใหม่
            if (roomIndex > 0) {
                worksheet.addRow([]);
                worksheet.addRow([]);
            }

            const titleRow = worksheet.addRow([`ห้อง ${roomName}`]);
            titleRow.font = { bold: true, size: 13 };
            worksheet.mergeCells(`A${titleRow.number}:E${titleRow.number}`);

            if (roomIndex > 0) {
                const headerRow = worksheet.addRow(columnDefs.map(c => c.header));
                headerRow.font = { bold: true, size: 12 };
                headerRow.alignment = { horizontal: 'center' };
                headerRow.eachCell(cell => {
                    cell.border = {
                        top: { style: 'thin' }, left: { style: 'thin' },
                        bottom: { style: 'thin' }, right: { style: 'thin' }
                    };
                });
            }

            bands[band][roomName].forEach(student => {
                const dataRow = worksheet.addRow({
                    student_id: student.student_id,
                    name: student.name,
                    class: student.class,
                    color: student.color,
                    status: student.attendance_status
                });
                dataRow.eachCell(cell => {
                    cell.border = {
                        top: { style: 'thin' }, left: { style: 'thin' },
                        bottom: { style: 'thin' }, right: { style: 'thin' }
                    };
                });
            });
        });

        const safeBandName = band.replace(/[\/\\?*\[\]]/g, '-');
        const fileName = `สรุปเข้าสี_${safeBandName}_${date}.xlsx`;
        const filePath = path.join(exportDir, fileName);
        await workbook.xlsx.writeFile(filePath);
        generatedFiles.push(filePath);
        console.log(`[สำเร็จ] ส่งออก: ${filePath}`);
    }

    if (generatedFiles.length === 0) {
        throw new Error('ไม่มีข้อมูลนักเรียนสำหรับวันที่เลือก');
    }

    // รวมไฟล์ทั้งหมดเป็น zip เดียว ให้ดาวน์โหลดง่ายจากปุ่มเดียว
    return new Promise((resolve, reject) => {
        const zipFileName = `สรุปเข้าสี_${date}.zip`;
        const zipFilePath = path.join(exportDir, zipFileName);
        const output = fs.createWriteStream(zipFilePath);
        const archive = archiver('zip', { zlib: { level: 9 } });

        output.on('close', () => {
            console.log(`[สำเร็จ] สร้างไฟล์ zip: ${zipFilePath}`);
            resolve(zipFilePath);
        });
        archive.on('error', (zipErr) => {
            console.error('[ข้อผิดพลาด] สร้าง zip ไม่สำเร็จ:', zipErr);
            reject(zipErr);
        });

        archive.pipe(output);
        generatedFiles.forEach(f => archive.file(f, { name: path.basename(f) }));
        archive.finalize();
    });
}

// --------------------------------------------------------
// API 3: สั่งสรุป Excel เองได้ทันที ไม่ต้องรอ cron ตอนเย็น
// เรียกจากเบราว์เซอร์ได้เลยที่ /api/export?date=YYYY-MM-DD แล้วจะได้ไฟล์ของวันนั้นกลับมา
// --------------------------------------------------------
// --------------------------------------------------------
// API 3: สั่งสรุป Excel แล้วดาวน์โหลดทันที (สร้างไฟล์ Zip ในอากาศแบบ Streaming)
// ไม่ต้องรอ cron และไม่ต้องเขียนไฟล์ลง Harddisk เพื่อให้ทำงานบน Render ได้
// --------------------------------------------------------
app.get('/api/export', async (req, res) => {
    try {
        const dateInput = req.query.date;
        const date = parseValidDate(dateInput) || getTodayDate();
        console.log(`=== เริ่มกระบวนการดาวน์โหลดข้อมูลสรุป (${date}) ===`);

        // 1. ดึงข้อมูล
        const students = await Student.find({}).sort({ class: 1, studentId: 1 }).lean();
        const attendances = await Attendance.find({ date }).lean();
        const statusMap = new Map(attendances.map(a => [String(a.studentId), a.status]));

        const rows = students.map(s => ({
            student_id: s.studentId,
            name: s.name,
            class: s.class,
            color: s.color,
            attendance_status: statusMap.get(String(s._id)) === 'present' ? 'เข้าสี' : 'ไม่เข้าสี'
        }));

        // 2. จัดกลุ่มข้อมูลตามช่วงชั้น
        const bands = {};
        let hasData = false;
        rows.forEach(student => {
            const band = getGradeBand(student.class);
            const roomName = student.class ? student.class.trim() : 'ไม่ระบุห้อง';
            if (!bands[band]) bands[band] = {};
            if (!bands[band][roomName]) bands[band][roomName] = [];
            bands[band][roomName].push(student);
            hasData = true;
        });

        if (!hasData) {
            return res.status(404).json({ error: 'ไม่มีข้อมูลนักเรียนสำหรับวันที่เลือก' });
        }

        // 3. ตั้งค่า Header เพื่อบอกเบราว์เซอร์ให้โหลดไฟล์ ZIP ทันที
        const zipFileName = `checkin_summary_${date}.zip`;
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${zipFileName}"`);

        // 4. สร้างตัวบีบอัด Zip แล้วเชื่อม (Pipe) ส่งไปที่เครื่องผู้ใช้ (res) โดยตรง!
        const archive = archiver('zip', { zlib: { level: 9 } });
        archive.on('error', (err) => { throw err; });
        archive.pipe(res);

        const columnDefs = [
            { header: 'รหัสนักเรียน', key: 'student_id', width: 13 },
            { header: 'ชื่อ-นามสกุล', key: 'name', width: 26 },
            { header: 'ชั้นเรียน', key: 'class', width: 11 },
            { header: 'กลุ่มสี', key: 'color', width: 10 },
            { header: `สถานะการเข้าสี (${date})`, key: 'status', width: 18 }
        ];

        // 5. วนลูปสร้างไฟล์ Excel ของแต่ละช่วงชั้น
        for (const band of BAND_ORDER) {
            if (!bands[band]) continue;

            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet(band.substring(0, 31));

            worksheet.columns = columnDefs;
            worksheet.pageSetup = {
                paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
                margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 }, horizontalCentered: true
            };
            worksheet.pageSetup.printTitlesRow = '1:1';
            worksheet.views = [{ state: 'frozen', ySplit: 1 }];

            worksheet.getRow(1).font = { bold: true, size: 12 };
            worksheet.getRow(1).alignment = { horizontal: 'center' };

            const roomNames = Object.keys(bands[band]).sort((a, b) => a.localeCompare(b, 'th'));

            roomNames.forEach((roomName, roomIndex) => {
                if (roomIndex > 0) { worksheet.addRow([]); worksheet.addRow([]); }

                const titleRow = worksheet.addRow([`ห้อง ${roomName}`]);
                titleRow.font = { bold: true, size: 13 };
                worksheet.mergeCells(`A${titleRow.number}:E${titleRow.number}`);

                if (roomIndex > 0) {
                    const headerRow = worksheet.addRow(columnDefs.map(c => c.header));
                    headerRow.font = { bold: true, size: 12 };
                    headerRow.alignment = { horizontal: 'center' };
                    headerRow.eachCell(cell => { cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } }; });
                }

                bands[band][roomName].forEach(student => {
                    const dataRow = worksheet.addRow({
                        student_id: student.student_id, name: student.name, class: student.class, color: student.color, status: student.attendance_status
                    });
                    dataRow.eachCell(cell => { cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } }; });
                });
            });

            // สร้าง Excel เป็น Buffer (ในอากาศ) แทนการเขียนลงไฟล์
            const buffer = await workbook.xlsx.writeBuffer();
            
            // นำ Buffer ยัดใส่ไฟล์ Zip
            const safeBandName = band.replace(/[\/\\?*\[\]]/g, '-');
            const fileName = `สรุปเข้าสี_${safeBandName}_${date}.xlsx`;
            archive.append(buffer, { name: fileName });
        }

        // 6. จบการทำงาน (ส่งข้อมูลก้อนสุดท้ายให้เครื่องผู้ใช้)
        await archive.finalize();

    } catch (err) {
        console.error('Export Error:', err);
        // ป้องกัน Error กรณีส่ง Header ไปแล้ว
        if (!res.headersSent) {
            res.status(500).json({ error: 'ไม่สามารถสร้างไฟล์สรุปได้: ' + err.message });
        }
    }
});

// --------------------------------------------------------
// CRON JOB: สรุปข้อมูลลง Excel อัตโนมัติของ "วันนี้" (20:30 น. ของทุกวัน เวลาไทย)
// --------------------------------------------------------
cron.schedule('30 20 * * *', () => {
    exportDailyExcel().catch(() => {}); // error ถูก log อยู่แล้วในฟังก์ชัน
}, { scheduled: true, timezone: "Asia/Bangkok" });

// --------------------------------------------------------
// ตัวกันล่มระดับโปรเซส: ถ้ามี error ที่หลุดรอดออกมาจากจุดไหนก็ตาม
// (ที่ไม่ถูกดักด้วย try/catch) ให้แค่ log ไว้ ไม่ใช่ปิดเซิร์ฟเวอร์ทั้งระบบ
// --------------------------------------------------------
process.on('unhandledRejection', (reason) => {
    console.error('⚠️  Unhandled Promise Rejection (เซิร์ฟเวอร์ยังทำงานต่อได้ปกติ):', reason);
});
process.on('uncaughtException', (err) => {
    console.error('⚠️  Uncaught Exception (เซิร์ฟเวอร์ยังทำงานต่อได้ปกติ):', err);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`เซิร์ฟเวอร์ระบบเช็คชื่อกำลังทำงานที่พอร์ต: ${PORT}`);
});
