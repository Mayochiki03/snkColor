const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');

const uri = "mongodb://admin:admin123@ac-jvdaupo-shard-00-00.2aowsqd.mongodb.net:27017,ac-jvdaupo-shard-00-01.2aowsqd.mongodb.net:27017,ac-jvdaupo-shard-00-02.2aowsqd.mongodb.net:27017/?ssl=true&replicaSet=atlas-wek0mr-shard-0&authSource=admin&appName=Cluster0"; 

async function run() {
    const client = new MongoClient(uri);
    try {
        await client.connect();
        console.log("✅ เชื่อมต่อ MongoDB สำเร็จ");
        
        const db = client.db(); 
        const studentsCollection = db.collection('students'); 

        // 1. อ่านไฟล์ "ชื่อเเละสี.txt" ตัวล่าสุดที่ถูกต้อง
        const filePath = path.join(__dirname, 'ชื่อเเละสี.txt');
        const data = fs.readFileSync(filePath, 'utf-8');
        const lines = data.trim().split('\n');

        const correctStudents = [];

        lines.forEach(line => {
            const parts = line.split('\t');
            if (parts.length >= 4) {
                const studentId = parts[0].trim();
                const name = parts[1].trim();
                const className = parts[2].trim();
                // ล้างคำว่า "สี" ออกเพื่อให้เหลือแค่น้ำเงิน, แดง, ชมพู, เขียว เหมือนระบบหลัก
                const color = parts[3].trim().replace('สี', ''); 

                correctStudents.push({ studentId, name, className, color });
            }
        });

        console.log(`🔎 อ่านข้อมูลจากไฟล์ได้ทั้งหมด: ${correctStudents.length} คน`);

        if (correctStudents.length === 0) {
            console.log("⚠️ ไม่พบข้อมูลนักเรียนในไฟล์ ชื่อเเละสี.txt กรุณาตรวจสอบไฟล์อีกครั้ง");
            return;
        }

        console.log("⏳ กำลังเริ่มทำการอัปเดตข้อมูล ชื่อ-ชั้น-สี ของทุกคนในฐานข้อมูลให้ถูกต้อง...");

        // 2. บังคับอัปเดตข้อมูลทับของเก่า (ใช้ Bulk Write เพื่อความรวดเร็ว)
        const operations = correctStudents.map(student => ({
            updateOne: {
                filter: { studentId: student.studentId },
                update: { 
                    $set: { 
                        name: student.name, 
                        className: student.className, 
                        color: student.color 
                    } 
                },
                upsert: true // ถ้าไม่มีรหัสนี้ให้เพิ่มใหม่ ถ้ามีอยู่แล้วให้เขียนทับ
            }
        }));

        const result = await studentsCollection.bulkWrite(operations);
        
        console.log(`✨ ผลการอัปเดตฐานข้อมูลสำเร็จ!`);
        console.log(`   - อัปเดตข้อมูลเด็กเก่าที่ข้อมูลไม่ครบ/ผิดไป: ${result.modifiedCount} คน`);
        console.log(`   - เพิ่มเด็กใหม่ (ถ้ามี): ${result.upsertedCount} คน`);

    } catch (error) {
        console.error("❌ เกิดข้อผิดพลาด:", error);
    } finally {
        await client.close();
        console.log("🔒 ปิดการเชื่อมต่อฐานข้อมูลเรียบร้อย");
    }
}

run();