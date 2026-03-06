const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const app = express();
const port = process.env.PORT || 3000;

// إعدادات Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname)); // لتشغيل ملف الـ HTML


// الاتصال بقاعدة البيانات (سيقوم بإنشاء ملف database.db تلقائياً)
const db = new sqlite3.Database('./database.db', (err) => {
    if (err) console.error(err.message);
    console.log('تم الاتصال بقاعدة بيانات SQLite.');
});

// إنشاء الجداول الأساسية إذا لم تكن موجودة
db.serialize(() => {
    // جدول المنتجات
    db.run(`CREATE TABLE IF NOT EXISTS products (
        code TEXT PRIMARY KEY,
        name TEXT,
        price REAL,
        stock INTEGER DEFAULT 0
    )`);

    // جدول الفواتير (سجل الحسابات)
    db.run(`CREATE TABLE IF NOT EXISTS sales (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT,
        total REAL,
        items TEXT
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS returns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_code TEXT,
    qty INTEGER,
    amount REAL,
    return_date TEXT
)`);


    // إدخال بعض المنتجات التجريبية (للتجربة فقط)
    db.get("SELECT COUNT(*) AS count FROM products", (err, row) => {
        if (row.count === 0) {
            const stmt = db.prepare("INSERT INTO products VALUES (?, ?, ?)");
            stmt.run("1", "خبز فينو كيس", 10.00);
            stmt.run("2", "جبنة عبور لاند", 25.00);
            stmt.run("3", "لبن جهينة 1 لتر", 38.00);
            stmt.finalize();
        }
    });
    // // استعلام لجلب صافي الربح
    // db.get(`SELECT 
    //     (SELECT SUM(total) FROM sales) - (SELECT SUM(amount) FROM returns) as net_profit`, 
    //     (err, row) => {
    //         console.log("صافي الربح الحالي:", row.net_profit);
    // });
});

// 1. واجهة (API) لجلب كل المنتجات
app.get('/api/products', (req, res) => {
    db.all("SELECT * FROM products", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});
// 2. واجهة (API) لحفظ الفاتورة الجديدة
app.post('/api/checkout', (req, res) => {
    const { total, items } = req.body;
    const date = new Date().toLocaleString('ar-EG');
    
    db.run(`INSERT INTO sales (date, total, items) VALUES (?, ?, ?)`, 
    [date, total, JSON.stringify(items)], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "تم حفظ الفاتورة بنجاح!", transactionId: this.lastID });
    });
});
app.post('/api/returns', (req, res) => {
    const { code, qty, price } = req.body;
    const amount = qty * price;
    const date = new Date().toLocaleString('ar-EG');

    // 1. تسجيل المرتجع
    db.run(`INSERT INTO returns (product_code, qty, amount, return_date) VALUES (?, ?, ?, ?)`, 
    [code, qty, amount, date], (err) => {
        if (err) return res.status(500).send("خطأ في تسجيل المرتجع");

        // 2. تحديث المخزن (إرجاع الكمية)
        db.run(`UPDATE products SET stock = stock + ? WHERE code = ?`, [qty, code], (err) => {
            if (err) return res.status(500).send("خطأ في تحديث المخزن");
            res.status(200).send("تم تسجيل المرتجع وتحديث المخزن");
        });
    });
});
// واجهة خاصة لإرجاع الفاتورة بالكامل من سجل الحسابات
app.post('/api/return_invoice', (req, res) => {
    const { saleId, amount } = req.body;
    const date = new Date().toLocaleString('ar-EG');

    // بنسجل قيمة الفاتورة في جدول المرتجعات عشان تتخصم من الأرباح
    db.run(`INSERT INTO returns (amount, return_date) VALUES (?, ?)`, 
    [amount, date], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "تم تسجيل مرتجع الفاتورة بنجاح" });
    });
});




// جلب السجل وصافي الربح (History)
app.get('/api/history', (req, res) => {
    const querySales = `SELECT * FROM sales ORDER BY id DESC`;
    const querySummary = `
        SELECT 
            (SELECT IFNULL(SUM(total), 0) FROM sales) as total_sales,
            (SELECT IFNULL(SUM(amount), 0) FROM returns) as total_returns
    `;

    db.all(querySales, [], (err, rows) => {
        if (err) return res.status(500).send(err.message);
        
        db.get(querySummary, [], (err, row) => {
            if (err) return res.status(500).send(err.message);
            
            const totalSales = row ? row.total_sales : 0;
            const totalReturns = row ? row.total_returns : 0;
            const netProfit = totalSales - totalReturns;
            res.json({
                sales: rows || [],
                netProfit: netProfit
            });
        });
    });
});


// 1. إضافة منتج جديد
app.post('/api/products', (req, res) => {
    const { code, name, price } = req.body;
    db.run(`INSERT INTO products (code, name, price) VALUES (?, ?, ?)`, [code, name, price], (err) => {
        if (err) return res.status(500).json({ error: "الباركود ده موجود قبل كده!" });
        res.json({ message: "تم إضافة المنتج بنجاح" });
    });
});

// 1. مسح منتج نهائياً من المخزن
app.delete('/api/products/:code', (req, res) => {
    const { code } = req.params;
    db.run(`DELETE FROM products WHERE code = ?`, [code], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: "المنتج غير موجود" });
        res.json({ message: "تم مسح المنتج بنجاح" });
    });
});
// تصفير سجل الحسابات بالكامل (مبيعات ومرتجعات) - للمدير فقط
app.delete('/api/history', (req, res) => {
    db.serialize(() => {
        // 1. مسح كل المبيعات
        db.run(`DELETE FROM sales`);
        
        // 2. مسح كل المرتجعات
        db.run(`DELETE FROM returns`);
        
        // 3. تصفير عداد الأرقام (عشان الفاتورة الجاية تبدأ من رقم 1)
        db.run(`DELETE FROM sqlite_sequence WHERE name='sales' OR name='returns'`, (err) => {
            if (err) {
                console.error(err.message);
                return res.status(500).json({ error: "حدث خطأ أثناء التصفير" });
            }
            res.json({ message: "تم تصفير سجل الحسابات بنجاح" });
        });
    });
});

// 2. تعديل سعر منتج موجود
app.put('/api/products/:code', (req, res) => {
    const { code } = req.params;
    const { price } = req.body;
    if (!price || isNaN(price)) return res.status(400).json({ error: "السعر غير صحيح" });

    db.run(`UPDATE products SET price = ? WHERE code = ?`, [price, code], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: "المنتج غير موجود" });
        res.json({ message: "تم تحديث السعر بنجاح" });
    });
});

app.listen(port, () => {
    console.log(`السيرفر يعمل الآن على الرابط: http://localhost:${port}`);
});

