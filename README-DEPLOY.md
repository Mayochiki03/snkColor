# สรุปสิ่งที่แก้ไข + วิธีขึ้น Render

## สิ่งที่เพิ่ม/แก้ไขจากเดิม

1. **เปลี่ยนฐานข้อมูลจาก SQLite → MongoDB**
   - ใช้ `mongoose` เชื่อมต่อผ่าน environment variable ชื่อ `MONGODB_URI`
   - โครงสร้างข้อมูลเดิม (นักเรียน + ประวัติเช็คชื่อ) ย้ายมาเป็น 2 collection: `students` และ `attendances`
   - ตอนรันครั้งแรกถ้ายังไม่มีข้อมูลนักเรียนในฐานข้อมูล ระบบจะอ่านไฟล์ `ชื่อเเละสี.txt` แล้วนำเข้าให้อัตโนมัติเหมือนเดิม

2. **เช็คชื่อย้อนหลังได้**
   - หน้าเช็คชื่อมีแถบเลือกวันที่ด้านบน (ปุ่มลูกศรเลื่อนวันก่อนหน้า/ถัดไป + ปุ่มเปิดปฏิทิน) เลือกวันในอดีตแล้วเช็คชื่อ/แก้ไขสถานะของวันนั้นได้ตามปกติ
   - เลือกวันในอนาคตไม่ได้ (ทั้ง UI และฝั่ง server กันไว้)
   - ถ้าเลือกวันที่ไม่ใช่วันนี้ จะมีป้าย "แก้ไขข้อมูลย้อนหลัง" ขึ้นเตือนให้รู้ตัวว่ากำลังแก้ข้อมูลวันเก่า

3. **หน้าแดชบอร์ด (แท็บใหม่ด้านบน)**
   - เลือกวันที่ผ่านปฏิทินเดียวกับหน้าเช็คชื่อ
   - สรุปยอดรวม: นักเรียนทั้งหมด / เข้าสีแล้ว / ยังไม่เข้าสี
   - สรุปแยกตามกลุ่มสี (แดง/น้ำเงิน/เขียว/ชมพู/ยังไม่ระบุ)
   - กราฟแท่งเล็กๆ แสดงแนวโน้มย้อนหลัง 14 วัน
   - ตารางสรุปตามห้องเรียน พร้อมเปอร์เซ็นต์การเข้าร่วม
   - ปุ่มดาวน์โหลดสรุป Excel ของวันที่กำลังดูอยู่

4. **ดีไซน์ สี ฟอนต์ เลย์เอาต์เดิมทั้งหมดยังคงเดิม** เพิ่มเฉพาะส่วนแถบวันที่/ปฏิทิน/แท็บ/แดชบอร์ดโดยใช้โทนสีและ radius เดียวกับของเดิม รองรับมือถือ/ไอแพด/คอมเหมือนเดิม (ปรับ breakpoint เพิ่มให้การ์ดสรุปในแดชบอร์ดวางตัวดีบนจอเล็ก)

## วิธีรันในเครื่องตัวเอง

```bash
npm install
cp .env.example .env
# แก้ MONGODB_URI ใน .env ให้ชี้ไปที่ MongoDB จริง (Atlas หรือในเครื่อง)
node server.js
```

## วิธีขึ้น Render

### 1. เตรียมฐานข้อมูล MongoDB (แนะนำ MongoDB Atlas ฟรี)

1. สมัคร/เข้า [MongoDB Atlas](https://www.mongodb.com/cloud/atlas)
2. สร้าง Cluster แบบฟรี (M0)
3. สร้าง Database User (username/password) ไว้ใช้เชื่อมต่อ
4. ไปที่ **Network Access** → **Add IP Address** → เลือก **Allow Access from Anywhere** (`0.0.0.0/0`) เพราะ Render ใช้ IP ไม่คงที่
5. ไปที่ **Database** → **Connect** → **Drivers** → คัดลอก connection string จะได้ประมาณ:
   ```
   mongodb+srv://<username>:<password>@cluster0.xxxxx.mongodb.net/checkin_system?retryWrites=true&w=majority
   ```
   ใส่ username/password ของตัวเองแทน และตั้งชื่อฐานข้อมูลท้าย URL เป็น `checkin_system` (หรือชื่อที่ต้องการ)

### 2. Deploy ขึ้น Render

1. Push โค้ดนี้ขึ้น GitHub repo (อย่าลืมไฟล์ `ชื่อเเละสี.txt` ต้องอยู่ใน repo ด้วย เพราะใช้นำเข้ารายชื่อครั้งแรก)
2. เข้า [Render Dashboard](https://dashboard.render.com) → **New** → **Web Service**
3. เชื่อมกับ GitHub repo ที่ push ไว้
4. ตั้งค่า:
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Environment**: Node
5. ไปที่แท็บ **Environment** → เพิ่ม Environment Variable:
   - Key: `MONGODB_URI`
   - Value: connection string จาก Atlas ที่คัดลอกไว้ (ใส่ username/password จริง)
6. กด **Create Web Service** รอ build เสร็จ ระบบจะรันที่ URL ที่ Render ให้มา (เช่น `https://xxxx.onrender.com`)
7. เข้าเว็บครั้งแรก ระบบจะนำเข้ารายชื่อนักเรียนจากไฟล์ `ชื่อเเละสี.txt` เข้า MongoDB ให้อัตโนมัติ (เช็คได้จาก Logs ใน Render ว่าขึ้น "นำเข้าข้อมูลนักเรียนสำเร็จ")

### หมายเหตุ

- แพ็กเกจ `sqlite3` ถูกเอาออกแล้ว (ไม่ใช้ไฟล์ `database.db` อีกต่อไป) ข้อมูลทั้งหมดอยู่ใน MongoDB
- ไฟล์ Excel ที่ export จะถูกสร้างในโฟลเดอร์ `exports/` ของเครื่อง server ตอนรัน ถ้ารันบน Render ควรกดดาวน์โหลดเก็บไว้เอง เพราะพื้นที่ไฟล์บน Render (free tier) จะรีเซ็ตเมื่อ redeploy/restart
- Cron สรุป Excel อัตโนมัติยังทำงานทุกวัน 20:30 น. (เวลาไทย) เหมือนเดิม
