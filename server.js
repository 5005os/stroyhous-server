// ===== StroyHous backend server =====
// Node.js + Express + PostgreSQL
// API для магазина: товары, заказы, категории, пользователи, фото, SMS

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ---- База данных ----
const pool = new Pool({
  host: 'localhost',
  database: process.env.DB_NAME || 'stroyhous',
  user: process.env.DB_USER || 'shopuser',
  password: process.env.DB_PASS || 'shop_db_pass_2026',
  port: 5432
});

// ---- Папка для фото ----
const UPLOAD_DIR = '/var/www/stroyhous/uploads';
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// раздаём загруженные фото как статику
app.use('/uploads', express.static(UPLOAD_DIR));

// настройка загрузки файлов
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    const name = Date.now() + '-' + crypto.randomBytes(4).toString('hex') + ext;
    cb(null, name);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 }, // 8 МБ на фото
  fileFilter: (req, file, cb) => {
    if (/^image\//.test(file.mimetype)) cb(null, true);
    else cb(new Error('Только изображения'));
  }
});

// =========================================================
//                      ТОВАРЫ
// =========================================================
app.get('/api/products', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM products ORDER BY created_at DESC');
    res.json(r.rows);
  } catch (e) { console.error(e); res.status(500).json({ error: 'db' }); }
});

app.post('/api/products', async (req, res) => {
  try {
    const { name, categories, description, images, price, weight, in_stock } = req.body;
    const r = await pool.query(
      `INSERT INTO products (name, categories, description, images, price, weight, in_stock)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [name, categories || [], description || '', images || [], price || 0, weight || 0, in_stock || 0]
    );
    res.json(r.rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: 'db' }); }
});

app.put('/api/products/:id', async (req, res) => {
  try {
    const { name, categories, description, images, price, weight, in_stock } = req.body;
    const r = await pool.query(
      `UPDATE products SET name=$1, categories=$2, description=$3, images=$4, price=$5, weight=$6, in_stock=$7
       WHERE id=$8 RETURNING *`,
      [name, categories || [], description || '', images || [], price || 0, weight || 0, in_stock || 0, req.params.id]
    );
    res.json(r.rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: 'db' }); }
});

app.delete('/api/products/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM products WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'db' }); }
});

// =========================================================
//                      ЗАГРУЗКА ФОТО
// =========================================================
// принимает фото, сохраняет на диск, возвращает ссылку
app.post('/api/upload', upload.single('photo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'нет файла' });
  // ссылка на фото — через домен сервера
  const url = '/uploads/' + req.file.filename;
  res.json({ url });
});

// =========================================================
//                      КАТЕГОРИИ
// =========================================================
app.get('/api/categories', async (req, res) => {
  try {
    const r = await pool.query('SELECT list FROM categories WHERE id=1');
    res.json(r.rows[0] ? r.rows[0].list : []);
  } catch (e) { console.error(e); res.status(500).json({ error: 'db' }); }
});

app.put('/api/categories', async (req, res) => {
  try {
    const { list } = req.body;
    await pool.query(
      `INSERT INTO categories (id, list) VALUES (1, $1)
       ON CONFLICT (id) DO UPDATE SET list = $1`,
      [list || []]
    );
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'db' }); }
});

// =========================================================
//                      ЗАКАЗЫ
// =========================================================
app.get('/api/orders', async (req, res) => {
  try {
    let q = 'SELECT * FROM orders';
    let params = [];
    if (req.query.phone) { q += ' WHERE phone=$1'; params.push(req.query.phone); }
    q += ' ORDER BY created_at DESC';
    const r = await pool.query(q, params);
    res.json(r.rows);
  } catch (e) { console.error(e); res.status(500).json({ error: 'db' }); }
});

app.post('/api/orders', async (req, res) => {
  try {
    const { name, phone, items, total, delivery, address } = req.body;
    const r = await pool.query(
      `INSERT INTO orders (name, phone, items, total, delivery, address, status, status_order, paid, paid_cash)
       VALUES ($1,$2,$3,$4,$5,$6,'Новый',-1,false,false) RETURNING *`,
      [name || '', phone, JSON.stringify(items || []), total || 0, delivery || '', address || '']
    );
    res.json(r.rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: 'db' }); }
});

// обновление заказа (статус, оплата, состав)
app.put('/api/orders/:id', async (req, res) => {
  try {
    const fields = req.body;
    const allowed = ['status', 'status_order', 'paid', 'paid_cash', 'items', 'total', 'delivery_cost', 'pay_type'];
    const sets = [];
    const vals = [];
    let i = 1;
    for (const k of allowed) {
      if (k in fields) {
        sets.push(`${k}=$${i}`);
        vals.push(k === 'items' ? JSON.stringify(fields[k]) : fields[k]);
        i++;
      }
    }
    if (!sets.length) return res.json({ ok: true });
    vals.push(req.params.id);
    const r = await pool.query(`UPDATE orders SET ${sets.join(', ')} WHERE id=$${i} RETURNING *`, vals);
    res.json(r.rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: 'db' }); }
});

// =========================================================
//                  ПОЛЬЗОВАТЕЛИ + SMS
// =========================================================
// временное хранилище кодов (телефон -> {code, expires})
const smsCodes = {};

function genCode() { return Math.floor(1000 + Math.random() * 9000).toString(); }

// отправка SMS через SMS.ru (ключ из .env — секретный!)
async function sendSms(phone, text) {
  const apiId = process.env.SMSRU_KEY;
  if (!apiId) { console.error('Нет SMSRU_KEY'); return false; }
  const url = `https://sms.ru/sms/send?api_id=${apiId}&to=${phone}&msg=${encodeURIComponent(text)}&json=1`;
  try {
    const resp = await fetch(url);
    const data = await resp.json();
    return data.status === 'OK';
  } catch (e) { console.error('SMS error', e); return false; }
}

// запрос кода (регистрация/вход)
app.post('/api/send-code', async (req, res) => {
  try {
    const phone = (req.body.phone || '').replace(/\D/g, '');
    if (phone.length < 10) return res.status(400).json({ error: 'Неверный номер' });
    const code = genCode();
    smsCodes[phone] = { code, expires: Date.now() + 5 * 60 * 1000 };
    const ok = await sendSms(phone, `Код для входа в StroyHous: ${code}`);
    if (!ok) return res.status(500).json({ error: 'Не удалось отправить SMS' });
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'server' }); }
});

// проверка кода
app.post('/api/verify-code', async (req, res) => {
  try {
    const phone = (req.body.phone || '').replace(/\D/g, '');
    const code = (req.body.code || '').trim();
    const rec = smsCodes[phone];
    if (!rec || rec.expires < Date.now()) return res.status(400).json({ error: 'Код истёк' });
    if (rec.code !== code) return res.status(400).json({ error: 'Неверный код' });
    delete smsCodes[phone];
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'server' }); }
});

// регистрация с паролем (после проверки кода)
app.post('/api/register', async (req, res) => {
  try {
    const phone = (req.body.phone || '').replace(/\D/g, '');
    const { name, password } = req.body;
    if (!phone || !password) return res.status(400).json({ error: 'Заполните поля' });
    const hash = crypto.createHash('sha256').update(password).digest('hex');
    await pool.query(
      `INSERT INTO users (phone, name, password) VALUES ($1,$2,$3)
       ON CONFLICT (phone) DO UPDATE SET name=$2, password=$3`,
      [phone, name || '', hash]
    );
    res.json({ ok: true, user: { phone, name: name || '' } });
  } catch (e) { console.error(e); res.status(500).json({ error: 'server' }); }
});

// вход по паролю
app.post('/api/login', async (req, res) => {
  try {
    const phone = (req.body.phone || '').replace(/\D/g, '');
    const { password } = req.body;
    const hash = crypto.createHash('sha256').update(password || '').digest('hex');
    const r = await pool.query('SELECT phone, name, password FROM users WHERE phone=$1', [phone]);
    if (!r.rows.length) return res.status(404).json({ error: 'Номер не зарегистрирован' });
    if (r.rows[0].password !== hash) return res.status(401).json({ error: 'Неверный пароль' });
    res.json({ ok: true, user: { phone: r.rows[0].phone, name: r.rows[0].name } });
  } catch (e) { console.error(e); res.status(500).json({ error: 'server' }); }
});

// проверка есть ли пользователь
app.get('/api/user/:phone', async (req, res) => {
  try {
    const phone = req.params.phone.replace(/\D/g, '');
    const r = await pool.query('SELECT phone, name FROM users WHERE phone=$1', [phone]);
    res.json(r.rows[0] || null);
  } catch (e) { console.error(e); res.status(500).json({ error: 'server' }); }
});

// обновить профиль
app.put('/api/user/:phone', async (req, res) => {
  try {
    const phone = req.params.phone.replace(/\D/g, '');
    const { name } = req.body;
    await pool.query('UPDATE users SET name=$1 WHERE phone=$2', [name || '', phone]);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'server' }); }
});

// сброс пароля: запрос кода (забыл пароль)
app.post('/api/reset-request', async (req, res) => {
  try {
    const phone = (req.body.phone || '').replace(/\D/g, '');
    const r = await pool.query('SELECT phone FROM users WHERE phone=$1', [phone]);
    if (!r.rows.length) return res.status(404).json({ error: 'Номер не зарегистрирован' });
    const code = genCode();
    smsCodes[phone] = { code, expires: Date.now() + 5 * 60 * 1000 };
    const ok = await sendSms(phone, `Код для сброса пароля StroyHous: ${code}`);
    if (!ok) return res.status(500).json({ error: 'Не удалось отправить SMS' });
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'server' }); }
});

// сброс пароля: установка нового (после кода)
app.post('/api/reset-password', async (req, res) => {
  try {
    const phone = (req.body.phone || '').replace(/\D/g, '');
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: 'Нет пароля' });
    // проверяем что номер зарегистрирован
    const u = await pool.query('SELECT phone FROM users WHERE phone=$1', [phone]);
    if (!u.rows.length) return res.status(404).json({ error: 'Номер не зарегистрирован' });
    const hash = crypto.createHash('sha256').update(password).digest('hex');
    await pool.query('UPDATE users SET password=$1 WHERE phone=$2', [hash, phone]);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'server' }); }
});

// ---- старт ----
// =========================================================
//                      ОПЛАТА ЮKASSA
// =========================================================
// Документация: https://yookassa.ru/developers
// Ключи в .env: YOOKASSA_SHOP_ID и YOOKASSA_SECRET

// создание платежа — клиент нажал "Оплатить онлайн"
app.post('/api/pay/create', async (req, res) => {
  try {
    const shopId = process.env.YOOKASSA_SHOP_ID;
    const secret = process.env.YOOKASSA_SECRET;
    if (!shopId || !secret) return res.status(500).json({ error: 'ЮKassa не настроена' });

    const orderId = req.body.orderId;
    if (!orderId) return res.status(400).json({ error: 'Нет заказа' });

    // берём заказ из базы (сумму — с сервера, не с клиента, для безопасности)
    const r = await pool.query('SELECT * FROM orders WHERE id=$1', [orderId]);
    if (!r.rows.length) return res.status(404).json({ error: 'Заказ не найден' });
    const order = r.rows[0];

    // авторизация для ЮKassa (Basic shopId:secret)
    const auth = Buffer.from(`${shopId}:${secret}`).toString('base64');
    // ключ идемпотентности — чтобы не создать платёж дважды
    const idemKey = crypto.randomBytes(16).toString('hex');

    const payment = {
      amount: { value: (order.total).toFixed(2), currency: 'RUB' },
      capture: true,
      confirmation: {
        type: 'redirect',
        // куда вернуть клиента после оплаты
        return_url: 'https://stroyhous.ru'
      },
      description: `Заказ №${order.id} StroyHous`,
      metadata: { orderId: String(order.id) }
    };

    const resp = await fetch('https://api.yookassa.ru/v3/payments', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Idempotence-Key': idemKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payment)
    });
    const data = await resp.json();
    if (!resp.ok) { console.error('ЮKassa error', data); return res.status(500).json({ error: 'Ошибка создания платежа' }); }

    // сохраняем id платежа в заказ
    await pool.query('UPDATE orders SET payment_id=$1 WHERE id=$2', [data.id, order.id]);

    // отдаём клиенту ссылку на оплату
    res.json({ url: data.confirmation.confirmation_url });
  } catch (e) { console.error(e); res.status(500).json({ error: 'server' }); }
});

// webhook — ЮKassa уведомляет сервер, что оплата прошла
app.post('/api/pay/webhook', async (req, res) => {
  try {
    const event = req.body;
    if (event && event.event === 'payment.succeeded') {
      const orderId = event.object && event.object.metadata && event.object.metadata.orderId;
      if (orderId) {
        // помечаем заказ оплаченным онлайн, двигаем на Сборку
        await pool.query(
          `UPDATE orders SET paid=true, paid_cash=false, status='Сборка', status_order=1 WHERE id=$1`,
          [orderId]
        );
      }
    }
    res.status(200).json({ ok: true });
  } catch (e) { console.error(e); res.status(200).json({ ok: true }); }
});

// проверка статуса оплаты заказа (клиент опрашивает после возврата)
app.get('/api/pay/status/:orderId', async (req, res) => {
  try {
    const r = await pool.query('SELECT paid, status, status_order FROM orders WHERE id=$1', [req.params.orderId]);
    if (!r.rows.length) return res.status(404).json({ error: 'не найден' });
    res.json(r.rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: 'server' }); }
});

// ===== ЧАТ клиент <-> админ =====
app.get('/api/messages/:phone', async (req, res) => {
  try {
    const phone = (req.params.phone || '').replace(/\D/g, '');
    const r = await pool.query('SELECT * FROM messages WHERE phone=$1 ORDER BY created_at ASC', [phone]);
    res.json(r.rows);
  } catch (e) { console.error(e); res.status(500).json({ error: 'server' }); }
});

app.post('/api/messages', async (req, res) => {
  try {
    const phone = (req.body.phone || '').replace(/\D/g, '');
    const { sender, text, image, name } = req.body;
    if (!phone || !sender) return res.status(400).json({ error: 'нет данных' });
    if (!text && !image) return res.status(400).json({ error: 'пустое сообщение' });
    const r = await pool.query(
      'INSERT INTO messages (phone, sender, text, image, client_name, created_at) VALUES ($1,$2,$3,$4,$5,now()) RETURNING *',
      [phone, sender, text || '', image || '', name || '']
    );
    res.json(r.rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: 'server' }); }
});

app.get('/api/chats', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT DISTINCT ON (phone) phone, client_name, text, image, sender, created_at
      FROM messages
      ORDER BY phone, created_at DESC
    `);
    const chats = r.rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    res.json(chats);
  } catch (e) { console.error(e); res.status(500).json({ error: 'server' }); }
});

async function cleanupChat() {
  try {
    const old = await pool.query("SELECT image FROM messages WHERE image != '' AND created_at < now() - interval '10 days'");
    old.rows.forEach(row => {
      if (row.image && row.image.indexOf('/uploads/') >= 0) {
        const fname = row.image.split('/uploads/')[1];
        fs.unlink(UPLOAD_DIR + '/' + fname, () => {});
      }
    });
    await pool.query("UPDATE messages SET image='' WHERE image != '' AND created_at < now() - interval '10 days'");
    await pool.query("DELETE FROM messages WHERE created_at < now() - interval '3 months'");
  } catch (e) { console.error('cleanup error', e); }
}
setInterval(cleanupChat, 6 * 60 * 60 * 1000);
cleanupChat();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`StroyHous server on port ${PORT}`));
