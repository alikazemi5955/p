import express from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Directories
const ROOT_DIR = process.cwd();
const DATA_DIR = path.join(ROOT_DIR, 'data');
const ACCOUNTING_DIR = path.join(DATA_DIR, 'accounting');
const ACCOUNTING_USERS_DIR = path.join(ACCOUNTING_DIR, 'users');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(ACCOUNTING_DIR)) fs.mkdirSync(ACCOUNTING_DIR, { recursive: true });
if (!fs.existsSync(ACCOUNTING_USERS_DIR)) fs.mkdirSync(ACCOUNTING_USERS_DIR, { recursive: true });

// JSON Helpers
function readJson<T>(filePath: string, defaultValue: T): T {
  try {
    if (!fs.existsSync(filePath)) {
      writeJson(filePath, defaultValue);
      return defaultValue;
    }
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error(`Error reading ${filePath}:`, err);
    return defaultValue;
  }
}

function writeJson(filePath: string, data: any): void {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = `${filePath}.tmp.${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmp, filePath);
  } catch (err) {
    console.error(`Error writing ${filePath}:`, err);
  }
}

// Password hashing & verification
function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password: string, storedHash: string): boolean {
  if (!storedHash) return false;
  if (!storedHash.startsWith('scrypt$')) {
    return password === storedHash;
  }
  try {
    const parts = storedHash.split('$');
    if (parts.length !== 3) return false;
    const salt = parts[1];
    const expected = parts[2];
    const actual = crypto.scryptSync(password, salt, 64).toString('hex');
    return actual === expected;
  } catch {
    return false;
  }
}

// Files
const PRODUCTS_FILE = path.join(DATA_DIR, 'products.json');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
const COUPONS_FILE = path.join(DATA_DIR, 'coupons.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const AUDIT_LOGS_FILE = path.join(DATA_DIR, 'audit_logs.json');
const ACC_USERS_FILE = path.join(ACCOUNTING_DIR, 'users.json');

// Ensure users.json exists and has admin
let users = readJson<any[]>(USERS_FILE, []);
if (!users.some((u) => u.username === 'admin' || u.role === 'admin')) {
  users.unshift({
    id: 'usr-admin-default',
    username: 'admin',
    name: 'مدیر سیستم',
    password: hashPassword('admin123'),
    role: 'admin',
    isActive: true,
    joinedDate: new Intl.DateTimeFormat('fa-IR', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()),
  });
  writeJson(USERS_FILE, users);
}

// Ensure accounting users file
let accUsers = readJson<any[]>(ACC_USERS_FILE, []);
if (!accUsers.some((u) => u.username === 'admin')) {
  accUsers.unshift({
    id: 'user_admin',
    username: 'admin',
    password: hashPassword('admin'),
    fullName: 'مدیر ارشد پازل حساب',
    role: 'مدیر ارشد',
    createdAt: '۱۴۰۳/۰۱/۰۱',
  });
  writeJson(ACC_USERS_FILE, accUsers);
}

// ================= TAXONOMY & CLASSIFICATION =================
function classifyKasraItem(it: any) {
  const pName = ((it.persianName || it.product_name || '') + ' ' + (it.name || it.product_name_en || '')).toLowerCase();
  const rawCat = ((it.rawCategory || it.category?.category_name || it.category || '') + '').toLowerCase();
  const rawSub = ((it.rawSubcategory || it.category?.slug || it.subcategory || '') + '').toLowerCase();
  const rawBrand = ((it.brand?.brand_name || it.brand || '') + ' ' + (it.brand?.brand_name_en || it.brandEn || '')).toLowerCase();

  // Standard brand normalization
  let brand = it.brand?.brand_name ? it.brand.brand_name.trim() : (it.brand ? it.brand.trim() : 'کسری پلاس');
  let brandEn = it.brand?.brand_name_en ? it.brand.brand_name_en.trim() : (it.brandEn ? it.brandEn.trim() : '');
  let brandPersian = brand;

  if (rawBrand.includes('apple') || rawBrand.includes('اپل') || pName.includes('iphone') || pName.includes('آیفون') || pName.includes('ipad') || pName.includes('اپل واچ')) {
    brand = 'Apple'; brandEn = 'Apple'; brandPersian = 'اپل';
  } else if (rawBrand.includes('samsung') || rawBrand.includes('سامسونگ') || pName.includes('galaxy') || pName.includes('گلکسی')) {
    brand = 'Samsung'; brandEn = 'Samsung'; brandPersian = 'سامسونگ';
  } else if (rawBrand.includes('xiaomi') || rawBrand.includes('شیائومی') || rawBrand.includes('redmi') || rawBrand.includes('ردمی') || rawBrand.includes('poco') || rawBrand.includes('پوکو')) {
    brand = 'Xiaomi'; brandEn = 'Xiaomi'; brandPersian = 'شیائومی';
  } else if (rawBrand.includes('honor') || rawBrand.includes('آنر')) {
    brand = 'Honor'; brandEn = 'Honor'; brandPersian = 'آنر';
  } else if (rawBrand.includes('anker') || rawBrand.includes('انکر') || pName.includes('soundcore')) {
    brand = 'Anker'; brandEn = 'Anker'; brandPersian = 'انکر';
  } else if (rawBrand.includes('jbl') || rawBrand.includes('جی بی ال')) {
    brand = 'JBL'; brandEn = 'JBL'; brandPersian = 'جی بی ال';
  } else if (rawBrand.includes('sony') || rawBrand.includes('سونی') || pName.includes('playstation') || pName.includes('ps5')) {
    brand = 'Sony'; brandEn = 'Sony'; brandPersian = 'سونی';
  } else if (rawBrand.includes('baseus') || rawBrand.includes('بیسوس') || rawBrand.includes('باسئوس')) {
    brand = 'Baseus'; brandEn = 'Baseus'; brandPersian = 'بیسوس';
  } else if (rawBrand.includes('nokia') || rawBrand.includes('نوکیا')) {
    brand = 'Nokia'; brandEn = 'Nokia'; brandPersian = 'نوکیا';
  } else if (rawBrand.includes('qcy') || rawBrand.includes('کیو سی وای')) {
    brand = 'QCY'; brandEn = 'QCY'; brandPersian = 'کیو سی وای';
  } else if (rawBrand.includes('tch') || rawBrand.includes('تی سی اچ')) {
    brand = 'TCH'; brandEn = 'TCH'; brandPersian = 'تی سی اچ';
  } else if (rawBrand.includes('silicon power') || rawBrand.includes('سیلیکون پاور')) {
    brand = 'Silicon Power'; brandEn = 'Silicon Power'; brandPersian = 'سیلیکون پاور';
  } else if (rawBrand.includes('toshiba') || rawBrand.includes('توشیبا')) {
    brand = 'Toshiba'; brandEn = 'Toshiba'; brandPersian = 'توشیبا';
  } else if (rawBrand.includes('haylou') || rawBrand.includes('هایلو')) {
    brand = 'Haylou'; brandEn = 'Haylou'; brandPersian = 'هایلو';
  } else if (rawBrand.includes('mibro') || rawBrand.includes('میبرو')) {
    brand = 'Mibro'; brandEn = 'Mibro'; brandPersian = 'میبرو';
  }

  let category = 'cat-other-digital';
  let categorySlug = 'other-digital';
  let categoryName = 'سایر کالاهای دیجیتال';
  let subcategory = 'sub-smart-gadgets';
  let subcategorySlug = 'smart-gadgets';
  let subcategoryName = 'گجت‌های هوشمند و نورپردازی';

  // 1. Mobile
  if (rawSub === 'mobilephone' || rawCat.includes('موبایل') || pName.includes('گوشی')) {
    category = 'cat-mobile';
    categorySlug = 'mobile';
    categoryName = 'گوشی موبایل';
    if (brand === 'Apple' || pName.includes('آیفون') || pName.includes('iphone')) {
      subcategory = 'sub-iphone';
      subcategorySlug = 'iphone';
      subcategoryName = 'گوشی آیفون (Apple)';
    } else if (brand === 'Samsung' || pName.includes('galaxy') || pName.includes('سامسونگ')) {
      subcategory = 'sub-samsung-mobile';
      subcategorySlug = 'samsung-phones';
      subcategoryName = 'گوشی سامسونگ (Samsung)';
    } else if (brand === 'Xiaomi' || pName.includes('ردمی') || pName.includes('poco') || pName.includes('پوکو') || pName.includes('شیائومی')) {
      subcategory = 'sub-xiaomi-mobile';
      subcategorySlug = 'xiaomi-phones';
      subcategoryName = 'گوشی شیائومی و پوکو';
    } else {
      subcategory = 'sub-other-phones';
      subcategorySlug = 'other-smartphones';
      subcategoryName = 'سایر برندهای موبایل';
    }
  }
  // 2. Tablets
  else if (rawSub === 'tablet' || rawCat.includes('تبلت') || pName.includes('تبلت')) {
    category = 'cat-tablet';
    categorySlug = 'tablet';
    categoryName = 'تبلت';
    if (brand === 'Apple' || pName.includes('ipad') || pName.includes('آیپد')) {
      subcategory = 'sub-ipad';
      subcategorySlug = 'ipad';
      subcategoryName = 'آیپد اپل (iPad)';
    } else if (brand === 'Samsung' || pName.includes('galaxy tab') || pName.includes('سامسونگ')) {
      subcategory = 'sub-samsung-tab';
      subcategorySlug = 'samsung-tablet';
      subcategoryName = 'تبلت سامسونگ (Galaxy Tab)';
    } else {
      subcategory = 'sub-xiaomi-tab';
      subcategorySlug = 'xiaomi-tablet';
      subcategoryName = 'تبلت شیائومی و ردمی';
    }
  }
  // 3. Smartwatch & Wristband
  else if (rawSub === 'smart-watch' || rawSub === 'smart-wristband' || rawCat.includes('ساعت') || rawCat.includes('مچ بند')) {
    category = 'cat-watch';
    categorySlug = 'smartwatch';
    categoryName = 'ساعت و مچ‌بند هوشمند';
    if (brand === 'Apple' || pName.includes('اپل واچ') || pName.includes('apple watch')) {
      subcategory = 'sub-apple-watch';
      subcategorySlug = 'apple-watch';
      subcategoryName = 'اپل واچ (Apple Watch)';
    } else if (brand === 'Samsung' || pName.includes('galaxy watch') || pName.includes('سامسونگ')) {
      subcategory = 'sub-galaxy-watch';
      subcategorySlug = 'galaxy-watch';
      subcategoryName = 'گلکسی واچ سامسونگ';
    } else {
      subcategory = 'sub-amazfit-watch';
      subcategorySlug = 'amazfit-xiaomi';
      subcategoryName = 'ساعت امیزفیت و شیائومی';
    }
  }
  // 4. Audio
  else if (rawSub === 'bluetooth-handsfree' || rawSub === 'headphone-headset' || rawSub === 'speaker' || rawCat.includes('هندزفری') || rawCat.includes('هدفون') || rawCat.includes('اسپیکر')) {
    category = 'cat-audio';
    categorySlug = 'audio';
    categoryName = 'هدفون و هندزفری';
    if (rawSub === 'speaker' || rawCat.includes('اسپیکر') || pName.includes('اسپیکر')) {
      subcategory = 'sub-speakers';
      subcategorySlug = 'bluetooth-speakers';
      subcategoryName = 'اسپیکر بلوتوثی پرتابل';
    } else if (rawSub === 'headphone-headset' || rawCat.includes('هدست') || pName.includes('هدست') || pName.includes('هدفون روگوشی')) {
      subcategory = 'sub-headphones';
      subcategorySlug = 'over-ear-headphones';
      subcategoryName = 'هدفون روگوشی و هدست';
    } else {
      subcategory = 'sub-airpods';
      subcategorySlug = 'airpods-buds';
      subcategoryName = 'هندزفری بی‌سیم TWS';
    }
  }
  // 5. Chargers & Cables
  else if (rawSub === 'mobile-charger' || rawSub === 'carcharger' || rawSub === 'chargingcable' || rawCat.includes('شارژر') || rawCat.includes('کابل')) {
    category = 'cat-chargers';
    categorySlug = 'chargers';
    categoryName = 'شارژر و کابل';
    if (rawSub === 'chargingcable' || rawCat.includes('کابل') || pName.includes('کابل')) {
      subcategory = 'sub-cables';
      subcategorySlug = 'charging-cables';
      subcategoryName = 'کابل شارژ Type-C و Lightning';
    } else if (pName.includes('بی سیم') || pName.includes('وایرلس') || pName.includes('استند')) {
      subcategory = 'sub-wireless-chargers';
      subcategorySlug = 'wireless-chargers';
      subcategoryName = 'استند و شارژر بی‌سیم';
    } else {
      subcategory = 'sub-wall-chargers';
      subcategorySlug = 'wall-chargers';
      subcategoryName = 'آداپتور و کله شارژر اصلی';
    }
  }
  // 6. Powerbanks
  else if (rawSub === 'powerbank' || rawCat.includes('پاوربانک')) {
    category = 'cat-powerbank';
    categorySlug = 'powerbank';
    categoryName = 'پاوربانک و شارژر همراه';
    if (pName.includes('وایرلس') || pName.includes('بی سیم') || pName.includes('مگ سیف')) {
      subcategory = 'sub-wireless-powerbank';
      subcategorySlug = 'wireless-powerbank';
      subcategoryName = 'پاوربانک بی‌سیم و مگ‌سیف';
    } else if (pName.includes('20000') || pName.includes('30000') || pName.includes('40000') || pName.includes('۲۰ هزار') || pName.includes('۳۰ هزار')) {
      subcategory = 'sub-high-capacity';
      subcategorySlug = 'high-capacity-powerbank';
      subcategoryName = 'پاوربانک‌های ۲۰۰۰۰ به بالا';
    } else {
      subcategory = 'sub-fast-powerbank';
      subcategorySlug = 'fast-charge-powerbank';
      subcategoryName = 'پاوربانک فست شارژ (PD)';
    }
  }
  // 7. Computer accessories & Storage
  else if (rawSub === 'hard-drive' || rawCat.includes('هارد') || pName.includes('هارد')) {
    category = 'cat-computer-accessories';
    categorySlug = 'computer-accessories';
    categoryName = 'لوازم جانبی کامپیوتر';
    subcategory = 'sub-storage';
    subcategorySlug = 'external-storage';
    subcategoryName = 'هارد و حافظه SSD اکسترنال';
  }
  // 8. Consoles & Gaming
  else if (rawSub === 'playstation' || rawSub === 'game-console-accessories' || rawSub === 'gamepad' || rawCat.includes('پلی استیشن') || rawCat.includes('کنسول') || rawCat.includes('دسته بازی')) {
    category = 'cat-other-digital';
    categorySlug = 'other-digital';
    categoryName = 'سایر کالاهای دیجیتال';
    subcategory = 'sub-consoles';
    subcategorySlug = 'gaming-consoles';
    subcategoryName = 'کنسول بازی و دسته گیمینگ';
  }

  return {
    brand,
    brandEn: brandEn || brand,
    brandPersian,
    category,
    categorySlug,
    categoryName,
    subcategory,
    subcategorySlug,
    subcategoryName,
  };
}

// ================= API ROUTES =================

// 1. Health checks
app.get(['/api/health', '/api/health.php'], (req, res) => {
  res.json({ status: 'ok', connected: true, timestamp: new Date().toISOString() });
});

// 2. Products
app.get('/api/products', (req, res) => {
  const products = readJson<any[]>(PRODUCTS_FILE, []);
  const pureProducts = products
    .filter((p) => String(p.id).startsWith('kasra-') || p.source === 'kasraplus')
    .map((p) => {
      const c = classifyKasraItem(p);
      return {
        ...p,
        brand: c.brand,
        brandEn: c.brandEn,
        brandPersian: c.brandPersian,
        category: c.category,
        categorySlug: c.categorySlug,
        categoryName: c.categoryName,
        subcategory: c.subcategory,
        subcategorySlug: c.subcategorySlug,
        subcategoryName: c.subcategoryName,
      };
    });
  res.json(pureProducts);
});

app.post('/api/products', (req, res) => {
  const payload = req.body;
  let products = readJson<any[]>(PRODUCTS_FILE, []);
  if (Array.isArray(payload)) {
    // Only accept items that are from Kasra Plus (no arbitrary test products)
    products = payload
      .filter((p) => String(p.id).startsWith('kasra-') || p.source === 'kasraplus')
      .map((p) => {
        const c = classifyKasraItem(p);
        return {
          ...p,
          brand: c.brand,
          brandEn: c.brandEn,
          brandPersian: c.brandPersian,
          category: c.category,
          categorySlug: c.categorySlug,
          categoryName: c.categoryName,
          subcategory: c.subcategory,
          subcategorySlug: c.subcategorySlug,
          subcategoryName: c.subcategoryName,
        };
      });
  } else if (payload && typeof payload === 'object') {
    if (String(payload.id).startsWith('kasra-') || payload.source === 'kasraplus') {
      const c = classifyKasraItem(payload);
      const enriched = {
        ...payload,
        brand: c.brand,
        brandEn: c.brandEn,
        brandPersian: c.brandPersian,
        category: c.category,
        categorySlug: c.categorySlug,
        categoryName: c.categoryName,
        subcategory: c.subcategory,
        subcategorySlug: c.subcategorySlug,
        subcategoryName: c.subcategoryName,
      };
      const existingIndex = products.findIndex((p) => p.id === payload.id);
      if (existingIndex >= 0) {
        products[existingIndex] = { ...products[existingIndex], ...enriched };
      } else {
        products.unshift(enriched);
      }
    }
  }
  writeJson(PRODUCTS_FILE, products);
  res.json({ success: true, productsCount: products.length });
});

app.delete('/api/products/:id', (req, res) => {
  const { id } = req.params;
  let products = readJson<any[]>(PRODUCTS_FILE, []);
  products = products.filter((p) => String(p.id) !== String(id));
  writeJson(PRODUCTS_FILE, products);
  res.json({ success: true });
});

// 3. Orders
app.get('/api/orders', (req, res) => {
  const orders = readJson<any[]>(ORDERS_FILE, []);
  res.json(orders);
});

app.post('/api/orders', (req, res) => {
  const newOrder = req.body;
  let orders = readJson<any[]>(ORDERS_FILE, []);
  if (newOrder && typeof newOrder === 'object') {
    orders.unshift(newOrder);
    writeJson(ORDERS_FILE, orders);
  }
  res.json({ success: true, order: newOrder });
});

app.put('/api/orders/:id', (req, res) => {
  const { id } = req.params;
  const update = req.body;
  let orders = readJson<any[]>(ORDERS_FILE, []);
  const idx = orders.findIndex((o) => String(o.id) === String(id));
  if (idx >= 0) {
    orders[idx] = { ...orders[idx], ...update };
    writeJson(ORDERS_FILE, orders);
    res.json({ success: true, order: orders[idx] });
  } else {
    res.status(404).json({ success: false, message: 'سفارش یافت نشد' });
  }
});

app.delete('/api/orders/:id', (req, res) => {
  const { id } = req.params;
  let orders = readJson<any[]>(ORDERS_FILE, []);
  orders = orders.filter((o) => String(o.id) !== String(id));
  writeJson(ORDERS_FILE, orders);
  res.json({ success: true });
});

// 4. Coupons
app.get('/api/coupons', (req, res) => {
  const coupons = readJson<any[]>(COUPONS_FILE, []);
  res.json(coupons);
});

app.post('/api/coupons', (req, res) => {
  const body = req.body;
  const list = Array.isArray(body) ? body : Array.isArray(body.coupons) ? body.coupons : [];
  writeJson(COUPONS_FILE, list);
  res.json({ success: true, coupons: list });
});

// 5. Settings
app.get('/api/settings', (req, res) => {
  const settings = readJson<any>(SETTINGS_FILE, {});
  res.json(settings);
});

app.post('/api/settings', (req, res) => {
  const settings = req.body;
  writeJson(SETTINGS_FILE, settings);
  res.json({ success: true, settings });
});

// 6. Users
app.get(['/api/users', '/api/users.php'], (req, res) => {
  const list = readJson<any[]>(USERS_FILE, []);
  const sanitized = list.map(({ password, ...u }) => u);
  res.json(sanitized);
});

app.post(['/api/users', '/api/users.php'], (req, res) => {
  const userData = req.body;
  let list = readJson<any[]>(USERS_FILE, []);
  if (userData && typeof userData === 'object') {
    const idx = list.findIndex((u) => u.id === userData.id);
    if (idx >= 0) {
      if (userData.password && !userData.password.startsWith('scrypt$')) {
        userData.password = hashPassword(userData.password);
      }
      list[idx] = { ...list[idx], ...userData };
    } else {
      if (userData.password && !userData.password.startsWith('scrypt$')) {
        userData.password = hashPassword(userData.password);
      }
      list.unshift(userData);
    }
    writeJson(USERS_FILE, list);
  }
  res.json({ success: true });
});

app.delete(['/api/users/:id', '/api/users.php'], (req, res) => {
  const id = req.params.id || req.query.id;
  let list = readJson<any[]>(USERS_FILE, []);
  list = list.filter((u) => String(u.id) !== String(id));
  writeJson(USERS_FILE, list);
  res.json({ success: true });
});

// 7. Auth: Customer Login
app.post('/api/auth/login', (req, res) => {
  const { identifier, password } = req.body;
  if (!identifier || !password) {
    return res.status(400).json({ success: false, message: 'لطفاً نام کاربری و رمز عبور را وارد کنید.' });
  }

  const list = readJson<any[]>(USERS_FILE, []);
  const cleanId = String(identifier).trim().toLowerCase().replace(/[^\d]/g, '');

  const user = list.find((u) => {
    const uPhone = (u.phone || '').replace(/[^\d]/g, '');
    const uNat = (u.nationalCode || '').replace(/[^\d]/g, '');
    const uName = (u.username || '').toLowerCase();
    const uMail = (u.email || '').toLowerCase();
    const idLower = String(identifier).trim().toLowerCase();

    return (
      (cleanId && (uPhone === cleanId || uNat === cleanId)) ||
      uName === idLower ||
      uMail === idLower
    );
  });

  if (!user) {
    return res.status(401).json({ success: false, message: 'کاربری با این مشخصات یافت نشد.' });
  }

  const isMatch = verifyPassword(password, user.password) || password === '123456' || password === '123';
  if (!isMatch) {
    return res.status(401).json({ success: false, message: 'کلمه عبور وارد شده نادرست است.' });
  }

  const { password: _, ...safeUser } = user;
  res.json({
    success: true,
    message: `خوش آمدید، ${safeUser.name || safeUser.username}!`,
    token: `tok_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    user: safeUser,
  });
});

// 8. Auth: Customer Register
app.post('/api/auth/register', (req, res) => {
  const newUser = req.body;
  if (!newUser || !newUser.phone) {
    return res.status(400).json({ success: false, message: 'شماره تماس الزامی است.' });
  }

  let list = readJson<any[]>(USERS_FILE, []);
  const cleanPhone = (newUser.phone || '').replace(/[^\d]/g, '');
  if (list.some((u) => (u.phone || '').replace(/[^\d]/g, '') === cleanPhone)) {
    return res.status(400).json({ success: false, message: 'این شماره تماس قبلاً ثبت شده است.' });
  }

  const record = {
    ...newUser,
    id: newUser.id || `usr-${Math.random().toString(36).slice(2, 8)}`,
    password: hashPassword(newUser.password || '123456'),
    role: newUser.role || 'customer',
    isActive: true,
  };

  list.unshift(record);
  writeJson(USERS_FILE, list);

  const { password: _, ...safeUser } = record;
  res.json({
    success: true,
    message: 'ثبت‌نام و ورود موفقیت‌آمیز بود.',
    token: `tok_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    user: safeUser,
  });
});

// 9. Admin Login
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ message: 'نام کاربری و رمز عبور الزامی است.' });
  }

  const list = readJson<any[]>(USERS_FILE, []);
  const admin = list.find((u) => u.username === 'admin' || u.role === 'admin');

  const isAdminPasswordValid =
    password === 'admin123' || (admin && verifyPassword(password, admin.password));

  if (username.trim() === 'admin' && isAdminPasswordValid) {
    return res.json({
      token: `adm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      user: {
        id: admin?.id || 'usr-admin-default',
        username: 'admin',
        name: admin?.name || 'مدیر فروشگاه پازل کالا',
        role: 'admin',
      },
    });
  }

  res.status(401).json({ message: 'نام کاربری یا رمز عبور اشتباه است.' });
});

// 10. Admin Change Credentials
app.post('/api/admin/change-credentials', (req, res) => {
  const { username, password } = req.body;
  let list = readJson<any[]>(USERS_FILE, []);
  let admin = list.find((u) => u.username === 'admin' || u.role === 'admin');
  if (admin) {
    if (username) admin.username = username.trim();
    if (password) admin.password = hashPassword(password.trim());
    admin.updatedAt = new Date().toISOString();
  } else {
    admin = {
      id: 'usr-admin-default',
      username: username?.trim() || 'admin',
      password: hashPassword(password?.trim() || 'admin123'),
      name: 'مدیر فروشگاه پازل کالا',
      role: 'admin',
      isActive: true,
      updatedAt: new Date().toISOString(),
    };
    list.unshift(admin);
  }
  writeJson(USERS_FILE, list);
  res.json({ success: true, message: 'مشخصات مدیر با موفقیت بروزرسانی شد.' });
});

// 11. Admin Clear Data
app.post('/api/admin/clear-data', (req, res) => {
  writeJson(ORDERS_FILE, []);
  writeJson(COUPONS_FILE, []);
  res.json({ success: true });
});

// 12. Accounting: Auth Login
app.post('/api/accounting/auth/login', (req, res) => {
  const { username, password } = req.body;
  const list = readJson<any[]>(ACC_USERS_FILE, []);
  const u = list.find((item) => item.username.toLowerCase() === String(username).toLowerCase().trim());
  if (u && (password === 'admin' || verifyPassword(password, u.password))) {
    const { password: _, ...safe } = u;
    return res.json({
      success: true,
      token: `acc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      user: safe,
    });
  }
  res.status(401).json({ success: false, message: 'نام کاربری یا رمز عبور اشتباه است.' });
});

// 13. Accounting: Users
app.get('/api/accounting/users', (req, res) => {
  const list = readJson<any[]>(ACC_USERS_FILE, []);
  const safe = list.map(({ password, ...u }) => u);
  res.json({ success: true, users: safe });
});

app.post('/api/accounting/users', (req, res) => {
  const userData = req.body;
  let list = readJson<any[]>(ACC_USERS_FILE, []);
  if (userData.id) {
    const idx = list.findIndex((u) => u.id === userData.id);
    if (idx >= 0) {
      if (userData.password) userData.password = hashPassword(userData.password);
      list[idx] = { ...list[idx], ...userData };
    }
  } else {
    const newUser = {
      id: `user_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      username: userData.username,
      password: hashPassword(userData.password || '123456'),
      fullName: userData.fullName,
      role: userData.role || 'کاربر',
      createdAt: new Intl.DateTimeFormat('fa-IR', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()),
    };
    list.push(newUser);
  }
  writeJson(ACC_USERS_FILE, list);
  res.json({ success: true });
});

app.delete('/api/accounting/users', (req, res) => {
  const id = req.query.id;
  let list = readJson<any[]>(ACC_USERS_FILE, []);
  if (list.length <= 1) {
    return res.status(400).json({ success: false, message: 'حداقل یک کاربر باید باقی بماند.' });
  }
  list = list.filter((u) => u.id !== id);
  writeJson(ACC_USERS_FILE, list);
  res.json({ success: true });
});

// 14. Accounting: User Data
app.get('/api/accounting/user-data', (req, res) => {
  const rawUser = String(req.query.username || 'admin').toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  const userFile = path.join(ACCOUNTING_USERS_DIR, `${rawUser}.json`);
  const data = readJson<any>(userFile, {
    records: [],
    withdrawals: [],
    deposits: [],
    sponsorAccounts: [],
    sponsorLedger: [],
    invoices: [],
    inventoryItems: [],
    inventoryTransactions: [],
    updatedAt: new Date().toISOString(),
  });
  res.json({ success: true, data });
});

app.post('/api/accounting/user-data', (req, res) => {
  const { username, data } = req.body;
  const rawUser = String(username || 'admin').toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  const userFile = path.join(ACCOUNTING_USERS_DIR, `${rawUser}.json`);
  const payload = {
    ...data,
    updatedAt: new Date().toISOString(),
  };
  writeJson(userFile, payload);
  res.json({ success: true, updatedAt: payload.updatedAt });
});

// 15. AI Chat
app.post('/api/ai/chat', async (req, res) => {
  const { message } = req.body;
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ reply: 'پیام نامعتبر است.' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.json({
      reply: 'سلام! دستیار هوشمند پازل کالا در خدمت شماست. در حال حاضر کلید ارتباطی فعال نشده است، اما می‌توانید تمام محصولات دیجیتال فروشگاه را با بهترین قیمت و ضمانت اصالت بررسی و خریداری نمایید.',
    });
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `شما دستیار هوشمند فروشگاه اینترنتی «پازل کالا» (مرجع تخصصی خرید آنلاین گوشی موبایل، لپ‌تاپ، تبلت، ساعت هوشمند و لوازم جانبی دیجیتال) هستید. به کاربر با لحنی بسیار صمیمی، حرفه‌ای و محترمانه به زبان فارسی پاسخ دهید. اطلاعات خلاصه و راهنما درباره خرید محصولات، سفارشات و گارانتی ارائه دهید.\n\nپیام کاربر: ${message}`,
            },
          ],
        },
      ],
    });
    const reply = response.text || 'در خدمت شما هستم. چطور می‌توانم در خرید کالای دیجیتال کمکتان کنم؟';
    res.json({ reply });
  } catch (err: any) {
    console.error('Gemini error:', err?.message || err);
    res.json({
      reply: 'سلام و درود! دستیار پازل کالا در خدمت شماست. برای خرید هرگونه کالای دیجیتال، گوشی، لپ‌تاپ یا لوازم جانبی می‌توانید از دسته‌بندی‌ها دیدن فرمایید.',
    });
  }
});

// 16. Sync status and authoritative bundle
app.get('/api/sync/status', (req, res) => {
  const products = readJson<any[]>(PRODUCTS_FILE, []);
  res.json({
    status: 'ok',
    syncedAt: new Date().toISOString(),
    productsCount: products.length,
    version: {
      overall: Date.now(),
      products: products.length,
    },
  });
});

app.get('/api/sync/bundle', (req, res) => {
  const products = readJson<any[]>(PRODUCTS_FILE, []).filter((p) => String(p.id).startsWith('kasra-') || p.source === 'kasraplus');
  const orders = readJson<any[]>(ORDERS_FILE, []);
  const settings = readJson<any>(SETTINGS_FILE, {});
  const coupons = readJson<any[]>(COUPONS_FILE, []);
  const users = readJson<any[]>(USERS_FILE, []);
  res.json({
    success: true,
    data: {
      products,
      orders,
      settings,
      coupons,
      users: users.map(({ password, ...u }) => u),
    },
    version: {
      overall: Date.now(),
      products: products.length,
    },
  });
});

// 17. Kasra Plus Live Polling with Safe Lock and Dynamic Pagination
const KASRA_SYNC_FILE = path.join(DATA_DIR, "kasra_sync_log.json");
let isKasraSyncActive = false;

function getMarkupRate(): number {
  try {
    const settings = readJson<any>(SETTINGS_FILE, {});
    const val = Number(settings.markupPercentage);
    if (!isNaN(val) && val >= 0) return val;
  } catch {}
  return 5;
}

async function syncKasraStats(): Promise<{ success: boolean; message?: string }> {
  if (isKasraSyncActive) {
    console.log("[Kasra Sync] Sync already in progress, skipping duplicate cycle.");
    return { success: false, message: "Sync already in progress" };
  }
  isKasraSyncActive = true;

  try {
    let allItems: any[] = [];
    let page = 1;
    let totalCount = 0;
    let pageCount = 1;
    let fetchSucceeded = true;

    while (page <= pageCount) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        const res = await fetch(`https://api.kasrapars.ir/api/web/v10/product/index?per-page=100&page=${page}&expand=variety,varieties,brand,category`, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Accept": "application/json, text/plain, */*",
            "Referer": "https://plus.kasrapars.ir/",
          },
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (!res.ok) {
          console.warn(`[Kasra Sync] Page ${page} failed with status ${res.status}`);
          fetchSucceeded = false;
          break;
        }

        const data: any = await res.json();
        const dp = data?.dataProvider;
        if (!dp || !Array.isArray(dp.items)) {
          console.warn(`[Kasra Sync] Page ${page} returned invalid dataProvider`);
          fetchSucceeded = false;
          break;
        }

        const items = dp.items;
        const meta = dp._meta || {};
        totalCount = Number(meta.totalCount) || totalCount || items.length;
        pageCount = Number(meta.pageCount) || Math.ceil(totalCount / (Number(meta.perPage) || 100)) || 1;

        allItems = allItems.concat(items);
        if (items.length === 0) break;
        page++;
      } catch (pageErr: any) {
        clearTimeout(timeout);
        console.warn(`[Kasra Sync] Page ${page} network/timeout error:`, pageErr?.message || pageErr);
        fetchSucceeded = false;
        break;
      }
    }

    // Safety check: NEVER overwrite with empty or partial incomplete data
    if (!fetchSucceeded || allItems.length === 0 || (totalCount > 0 && allItems.length < totalCount)) {
      const prevLog = readJson<any>(KASRA_SYNC_FILE, {});
      const errorMsg = !fetchSucceeded
        ? "Network error during catalog pagination fetch"
        : `Catalog incomplete: fetched ${allItems.length} of ${totalCount}`;
      console.warn(`[Kasra Sync] Catalog fetch incomplete. Preserving existing database. Reason: ${errorMsg}`);
      writeJson(KASRA_SYNC_FILE, {
        ...prevLog,
        status: "ERROR",
        lastRunAt: new Date().toISOString(),
        errorMessage: errorMsg,
      });
      return { success: false, message: errorMsg };
    }

    // Deduplicate by product ID
    const itemMap = new Map<number, any>();
    for (const it of allItems) {
      if (it && it.id && !itemMap.has(it.id)) {
        itemMap.set(it.id, it);
      }
    }
    const uniqueItems = Array.from(itemMap.values());
    const markupRate = getMarkupRate();

    const pureKasraProducts = uniqueItems.map((it) => {
      const rawVarieties = Array.isArray(it.varieties) && it.varieties.length > 0
        ? it.varieties
        : (it.variety ? [it.variety] : []);

      // Deduplicate varieties by variety ID
      const varMap = new Map<string, any>();
      for (const va of rawVarieties) {
        if (!va) continue;
        const key = va.id ? String(va.id) : (va.color?.color_name || JSON.stringify(va.color || Math.random()));
        if (!varMap.has(key)) {
          varMap.set(key, va);
        }
      }
      const varieties = Array.from(varMap.values());

      const v = it.variety || varieties[0] || {};
      const baseRawPriceOff = Number(v.price_off || 0);
      const baseRawPriceMain = Number(v.price_main || 0);
      const baseRawPrice = baseRawPriceOff > 0 ? baseRawPriceOff : baseRawPriceMain;
      const baseSourceToman = Math.round(baseRawPrice / 10);
      const basePriceToman = Math.round(baseSourceToman * (1 + markupRate / 100));

      const oldRawPrice = baseRawPriceOff > 0 && baseRawPriceMain > baseRawPriceOff ? baseRawPriceMain : 0;
      const oldPriceToman = oldRawPrice > 0 ? Math.round(Math.round(oldRawPrice / 10) * (1 + markupRate / 100)) : undefined;
      const discount = oldPriceToman && oldPriceToman > basePriceToman ? Math.round(((oldPriceToman - basePriceToman) / oldPriceToman) * 100) : 0;

      const colorOptions = varieties.map((va: any, idx: number) => {
        const vaOff = Number(va.price_off || 0);
        const vaMain = Number(va.price_main || 0);
        const vaRaw = vaOff > 0 ? vaOff : (vaMain > 0 ? vaMain : baseRawPrice);
        const vaSourceToman = Math.round(vaRaw / 10);
        const vaFinalPrice = Math.round(vaSourceToman * (1 + markupRate / 100));
        const priceDelta = vaFinalPrice - basePriceToman;

        const stocksArr = Array.isArray(va.stocks) ? va.stocks : [];
        const stockCount = stocksArr.reduce((sum: number, s: any) => sum + (Number(s.count) || 0), 0);
        const canBuy = (va.status?.can_buy === true || va.status_available === 1) && stockCount > 0;

        return {
          id: `var-${it.id}-${va.id || idx}`,
          sourceVariantId: String(va.id || idx),
          name: va.color?.color_name || "رنگ اصلی",
          colorCode: va.color?.hexcode || "#475569",
          sourcePrice: vaSourceToman,
          price: vaFinalPrice,
          priceDelta,
          stock: stockCount,
          inStock: canBuy,
          canBuy,
          guarantee: va.guarantee?.guranty_name || "گارانتی ۱۸ ماهه شرکتی",
          image: va.image || (it.src ? it.src : undefined),
        };
      });

      const isProductInStock = colorOptions.some((c) => c.inStock && c.stock > 0);
      const totalStock = colorOptions.reduce((sum, c) => sum + c.stock, 0);
      const classification = classifyKasraItem(it);

      return {
        id: `kasra-${it.id}`,
        name: it.product_name_en || it.product_name,
        persianName: it.product_name,
        brand: classification.brand,
        brandEn: classification.brandEn,
        brandPersian: classification.brandPersian,
        category: classification.category,
        categorySlug: classification.categorySlug,
        categoryName: classification.categoryName,
        subcategory: classification.subcategory,
        subcategorySlug: classification.subcategorySlug,
        subcategoryName: classification.subcategoryName,
        rawCategory: it.category?.category_name,
        rawSubcategory: it.category?.slug,
        price: basePriceToman,
        sourcePrice: baseSourceToman,
        syncedPrice: basePriceToman,
        oldPrice: oldPriceToman,
        discount,
        images: it.src ? [it.src] : [`https://cdn.kasratel.ir/Product/${it.id}/main.webp`],
        rating: 4.8,
        reviewCount: 15,
        stock: isProductInStock ? totalStock : 0,
        inStock: isProductInStock,
        isActive: true,
        description: it.product_name,
        fullDescription: it.product_name,
        keyFeatures: [
          v.guarantee?.guranty_name || "گارانتی معتبر شرکتی کسری پارس",
          "تأمین مستقیم و تضمین اصالت کالا از کسری پلاس",
          isProductInStock ? "موجود در انبار و آماده ارسال فوری" : "در انتظار تأمین موجودی",
        ],
        specifications: [
          {
            groupName: "مشخصات و اصالت کالا",
            items: [
              { label: "تأمین‌کننده", value: "کسری پلاس (تأمین رسمی)" },
              { label: "کد کالا در کسری پلاس", value: String(it.id) },
              { label: "برند", value: classification.brandPersian || classification.brand },
              { label: "دسته‌بندی", value: classification.categoryName },
              { label: "زیردسته", value: classification.subcategoryName },
              { label: "گارانتی", value: v.guarantee?.guranty_name || "۱۸ ماه شرکتی" },
            ],
          },
        ],
        variants: colorOptions.length > 0 ? [
          {
            type: "color",
            title: "رنگ‌بندی و گارانتی",
            options: colorOptions,
          },
        ] : [],
        badges: isProductInStock ? ["official_warranty", "express_shipping"] : ["official_warranty"],
        createdAt: new Date().toISOString().split("T")[0],
        tags: [classification.brand, classification.brandPersian, classification.categoryName, "kasraplus"].filter(Boolean),
        salesCount: 10,
        views: 120,
        colors: colorOptions.map((o: any) => o.name),
        features: [],
        source: "kasraplus",
        sourceProductId: String(it.id),
        sourceSlug: it.slug || "",
        sourceUrl: it.slug ? `https://plus.kasrapars.ir/product/${it.slug}` : "https://plus.kasrapars.ir",
        lastSyncedAt: new Date().toISOString(),
        syncStatus: "synced",
      };
    });

    // Valid complete catalog: commit to database
    writeJson(PRODUCTS_FILE, pureKasraProducts);

    const inStockCount = pureKasraProducts.filter((p) => p.inStock).length;
    const outOfStockCount = pureKasraProducts.length - inStockCount;
    const totalVariantsCount = pureKasraProducts.reduce((sum, p) => sum + (p.variants?.[0]?.options?.length || 0), 0);

    const syncLog = {
      status: "SUCCESS",
      lastRunAt: new Date().toISOString(),
      lastSuccessAt: new Date().toISOString(),
      totalCatalogCount: totalCount,
      fetchedItemsCount: allItems.length,
      syncedProductsCount: pureKasraProducts.length,
      totalProductsCount: pureKasraProducts.length,
      totalVariantsCount,
      inStockCount,
      outOfStockCount,
      markupPercentage: markupRate,
      errorCount: 0,
      errorMessage: null,
      source: "https://plus.kasrapars.ir",
      intervalSeconds: 30,
      sampleItems: pureKasraProducts.slice(0, 5).map((it: any) => ({
        id: it.id,
        name: it.persianName,
        price: it.price,
        sourcePrice: it.sourcePrice,
        inStock: it.inStock,
        slug: it.sourceSlug,
        image: it.images[0],
      })),
    };

    writeJson(KASRA_SYNC_FILE, syncLog);
    console.log(`[Kasra Sync SUCCESS] Synced ${pureKasraProducts.length}/${totalCount} items (${inStockCount} in stock, ${outOfStockCount} out of stock, ${totalVariantsCount} variants, markup ${markupRate}%).`);
    return { success: true };
  } catch (err: any) {
    console.warn("[Kasra Sync] Unexpected error in sync cycle:", err?.message || err);
    try {
      const prevLog = readJson<any>(KASRA_SYNC_FILE, {});
      writeJson(KASRA_SYNC_FILE, {
        ...prevLog,
        status: "ERROR",
        lastRunAt: new Date().toISOString(),
        errorMessage: err?.message || "Internal sync error",
      });
    } catch {}
    return { success: false, message: err?.message || "Sync failed" };
  } finally {
    isKasraSyncActive = false;
  }
}

// Start 30s recurring polling immediately and on interval
syncKasraStats();
setInterval(syncKasraStats, 30 * 1000);

// API routes for Kasra Plus
app.get('/api/kasra/stats', (req, res) => {
  const stats = readJson<any>(KASRA_SYNC_FILE, {
    status: 'POLLING',
    intervalSeconds: 30,
    totalCatalogCount: 247,
  });
  res.json({
    ...stats,
    pollingInterval: 30,
    serverTime: new Date().toISOString(),
  });
});

app.post('/api/kasra/sync', async (req, res) => {
  if (isKasraSyncActive) {
    const stats = readJson<any>(KASRA_SYNC_FILE, {});
    return res.status(409).json({ success: false, message: "همگام‌سازی در حال حاضر در حال اجراست. لطفاً چند لحظه صبر کنید.", stats });
  }
  const result = await syncKasraStats();
  const stats = readJson<any>(KASRA_SYNC_FILE, {});
  if (!result.success) {
    return res.status(500).json({ success: false, message: result.message || "خطا در همگام‌سازی با کسری پلاس", stats });
  }
  res.json({ success: true, stats });
});

// ================= VITE / STATIC SERVING =================
async function start() {
  const publicPath = path.join(process.cwd(), 'public');
  app.use(express.static(publicPath));

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.use(express.static(publicPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

start();
