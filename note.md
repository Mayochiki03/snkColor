# คู่มือ: สร้าง VM Windows บน ESXi แล้วรันระบบเช็คชื่อกิจกรรมสี ให้เข้าผ่าน URL ในวงเน็ตได้

แนวทาง: สร้าง VM แยกต่างหากบน ESXi ลง **Windows** ข้างใน (ไม่ใช่ตัว Windows Server เดิมของโรงเรียน) แล้วรันแอปในนั้น จะได้ทั้งความคุ้นเคยกับ Windows และความปลอดภัยจากการแยก VM ต่างหาก ถ้าพังก็ย้อน snapshot ได้ ไม่กระทบเครื่องอื่น

---

## สิ่งที่ต้องเตรียมก่อนเริ่ม

- ไฟล์ ISO ของ Windows ที่จะติดตั้ง (Windows Server ISO หรือ Windows 10/11 ISO ก็ได้ ขึ้นกับ license ที่โรงเรียนมี — ถ้าไม่แน่ใจเรื่อง license ถามฝ่าย IT ว่ามี key/ISO ตัวไหนใช้ได้บ้าง)
- สิทธิ์เข้า ESXi web client เต็ม (มีอยู่แล้วตามที่คุยกัน)

---

## ขั้นตอนที่ 1: อัปโหลด Windows ISO เข้า ESXi

1. เข้า ESXi web client (`https://<IP ของ ESXi host>`)
2. **Storage** → เลือก datastore → **Datastore browser**
3. สร้าง/เข้าโฟลเดอร์ `ISOs` → **Upload** ไฟล์ Windows ISO เข้าไป (ไฟล์ใหญ่ รอสักครู่)

---

## ขั้นตอนที่ 2: สร้าง VM ใหม่

1. **Virtual Machines** → **Create / Register VM** → **Create a new virtual machine** → Next
2. ตั้งชื่อ เช่น `school-checkin-win` → OS family: **Windows** → OS version: เลือกให้ตรงกับ ISO ที่มี (เช่น Windows Server 2019/2022 หรือ Windows 10/11) → Next
3. เลือก datastore → Next
4. ตั้งค่า hardware:
   - **CPU**: 2 vCPU
   - **Memory**: 4 GB (Windows กินแรมมากกว่า Linux พอสมควร)
   - **Hard disk**: 60 GB
   - **Network**: ⚠️ **จุดสำคัญที่สุดเหมือนเดิม** — เลือก portgroup ที่อยู่วง LAN เดียวกับ WiFi โรงเรียน ไม่ใช่วง internal-only ของ ESXi ถ้าไม่แน่ใจถามฝ่าย IT ว่า WiFi ครูใช้ portgroup/VLAN ไหน
   - **CD/DVD Drive**: เลือก **Datastore ISO file** → ชี้ไปที่ Windows ISO → ติ๊ก **Connect at power on**
5. Next → Finish

---

## ขั้นตอนที่ 3: ติดตั้ง Windows

1. เปิด VM → **Console** → ติดตั้ง Windows ตามขั้นตอนปกติ (เลือกภาษา, กด Install now, ใส่ key ถ้ามี, เลือก partition ทั้งหมดของดิสก์ 60GB ที่สร้างไว้)
2. ตั้งค่า user account / password ตอนติดตั้งเสร็จ (Windows 10/11 อาจถามบัญชี Microsoft — เลือก "Domain join instead" หรือ offline account ถ้าไม่อยากผูกบัญชีออนไลน์)
3. รอจนเข้า Desktop ได้

---

## ขั้นตอนที่ 4: ติดตั้ง VMware Tools

สำคัญมากสำหรับ VM Windows บน ESXi ช่วยให้ mouse/network/shutdown ทำงานถูกต้อง:

1. ใน ESXi web client เลือก VM → **Actions** → **Guest OS** → **Install VMware Tools**
2. ใน Windows จะมี CD Drive โผล่มาเป็น VMware Tools installer → เปิดรัน `setup64.exe` → ติดตั้งแบบ Next-Next-Finish → รีสตาร์ท VM เมื่อถูกถาม

---

## ขั้นตอนที่ 5: เปิด Remote Desktop (แนะนำ ไม่บังคับ)

ทำครั้งเดียวจะได้ไม่ต้องเปิด ESXi console ทุกครั้งที่จะเข้าไปดูแลเครื่อง (console ผ่านเว็บมักหน่วง พิมพ์ลำบาก):

1. ใน Windows: **Settings** → **System** → **Remote Desktop** → เปิด **Enable Remote Desktop**
2. จากนั้นใช้โปรแกรม **Remote Desktop Connection** (มีในตัว Windows ทุกเครื่อง พิมพ์ `mstsc` ใน Start menu ของเครื่อง PC ที่จะใช้ต่อเข้ามา) พิมพ์ IP ของ VM แล้ว login ด้วย user/password ที่ตั้งไว้

---

## ขั้นตอนที่ 6: ตั้ง Static IP ให้ VM

1. **Control Panel** → **Network and Sharing Center** → **Change adapter settings**
2. คลิกขวาที่ network adapter → **Properties** → เลือก **Internet Protocol Version 4 (TCP/IPv4)** → **Properties**
3. เลือก **Use the following IP address** ใส่ IP, Subnet mask, Gateway, DNS ตามที่ IT โรงเรียนแจ้ง (หรือดูจาก `ipconfig /all` ของเครื่องอื่นในวงเดียวกันเป็นตัวอย่างของ subnet/gateway)

ทดสอบ: เปิด cmd พิมพ์ `ipconfig` ควรเห็น IP ที่ตั้งไว้

---

## ขั้นตอนที่ 7: ติดตั้ง Node.js

1. ในเครื่อง VM (ผ่าน RDP) เปิดเบราว์เซอร์ไป [nodejs.org](https://nodejs.org) ดาวน์โหลดตัวติดตั้ง Windows (.msi) เวอร์ชัน **LTS**
2. ติดตั้งแบบ Next-Next-Finish
3. เปิด cmd ทดสอบ:
   ```
   node -v
   npm -v
   ```

---

## ขั้นตอนที่ 8: ย้ายไฟล์โปรเจกต์เข้า VM

ผ่าน RDP สามารถ copy-paste ไฟล์ข้ามเครื่องได้เลย (RDP รองรับ clipboard และลาก-วางไฟล์):

1. เปิด Remote Desktop Connection → ก่อนกด Connect คลิก **Show Options** → แท็บ **Local Resources** → ปุ่ม **More...** ใต้ Local devices and resources → ติ๊ก **Drives** (จะได้เห็นไดรฟ์เครื่อง PC จริงโผล่ใน VM ด้วย ก็อปไฟล์ผ่าน File Explorer ได้เลย)
2. คัดลอกไฟล์เหล่านี้ไปวางที่ VM เช่น `C:\school-checkin\`:
   - `server.js`
   - `package.json`, `package-lock.json`
   - โฟลเดอร์ `public/` (มี `index.html` ข้างใน)
   - `ชื่อเเละสี.txt`

*(ไม่ต้องก็อป `node_modules` — ติดตั้งใหม่ในขั้นตอนถัดไปเพื่อให้ได้ binary ที่ตรงกับเครื่องนี้)*

---

## ขั้นตอนที่ 9: ติดตั้ง dependency และทดสอบรัน

เปิด cmd ใน VM:

```
cd C:\school-checkin
npm install
node server.js
```

ควรเห็น `เซิร์ฟเวอร์ระบบเช็คชื่อกำลังทำงานที่พอร์ต: 3000`

---

## ขั้นตอนที่ 10: เปิด Windows Firewall ให้พอร์ต 3000

1. **Windows Security** → **Firewall & network protection** → **Advanced settings**
2. **Inbound Rules** → **New Rule** → **Port** → Next
3. **TCP**, Specific local ports = `3000` → Next
4. **Allow the connection** → Next → ติ๊กทุกช่อง (Domain/Private/Public) → Next
5. ตั้งชื่อ เช่น `School Checkin App` → Finish

---

## ขั้นตอนที่ 11: ทดสอบเข้าจากมือถือ

เอามือถือที่ต่อ WiFi โรงเรียน (วงเดียวกับ portgroup ที่เลือกตอนสร้าง VM) เปิดเบราว์เซอร์ไปที่:

```
http://<IP ของ VM>:3000
```

ถ้าเข้าไม่ได้ ให้เช็คตามลำดับ: (1) Firewall เปิด rule แล้วหรือยัง (2) portgroup ของ VM ตรงกับวง WiFi จริงไหม (3) static IP ตั้งถูกวง subnet ไหม

---

## ขั้นตอนที่ 12: ทำให้รันอัตโนมัติตลอด ไม่ต้องเปิด cmd ค้าง

```
npm install -g pm2
npm install -g pm2-windows-startup
pm2-startup install
pm2 start server.js --name school-checkin
pm2 save
```

พอ VM รีสตาร์ท ระบบจะเปิดเองอัตโนมัติ เช็คสถานะได้ด้วย `pm2 status` และดู log ด้วย `pm2 logs school-checkin`

---

## ขั้นตอนที่ 13: Snapshot ที่ ESXi

กลับไป ESXi web client → เลือก VM → **Actions** → **Snapshots** → **Take snapshot** — ทำตอนทุกอย่างรันปกติดีแล้ว เผื่อวันหลังทำอะไรพังจะย้อนกลับจุดนี้ได้ทันที

---

## เช็กลิสต์ก่อนวันงานจริง

- [ ] เข้า `http://<IP VM>:3000` จากมือถือจริงได้ปกติ
- [ ] ลอง restart VM จาก ESXi ทดสอบว่า pm2 เปิดแอปกลับมาเองอัตโนมัติ (เช็คด้วย `pm2 status` หลัง VM บูตเสร็จ)
- [ ] ทดสอบเช็คชื่อจากมือถือหลายเครื่องพร้อมกัน
- [ ] Snapshot VM ไว้ 1 ชุดก่อนวันงาน
- [ ] จด IP ของ VM ไว้กระดาษสำรอง หรือทำ QR code แจกครู

---

## สรุปจุดที่มักพลาด

| อาการ | สาเหตุที่เป็นไปได้ |
|---|---|
| SSH/RDP เข้า VM ไม่ได้เลย | VM ยังไม่เปิด หรือ static IP ผิด ลองดูที่ ESXi console โดยตรง |
| เข้าจาก VM เองได้ แต่มือถือเข้าไม่ได้ | portgroup ของ VM ไม่ได้อยู่วงเดียวกับ WiFi (ขั้นตอนที่ 2) หรือลืมเปิด Firewall (ขั้นตอนที่ 10) |
| IP เปลี่ยนทุกครั้งที่เปิดเครื่องใหม่ | ยังใช้ DHCP อยู่ ต้องตั้ง static IP ตามขั้นตอนที่ 6 |
| แอปหายไปหลัง reboot VM | ยังไม่ได้ตั้ง pm2 auto-start (ขั้นตอนที่ 12) |