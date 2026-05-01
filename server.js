const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 5500);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const DB_PATH = path.join(DATA_DIR, "store.json");
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";
const SESSION_SECRET = process.env.SESSION_SECRET || "change-this-secret-before-live-use";
const GOOGLE_CLIENT_ID = "1018194590920-1udrfd5bta8so1kt52til47nbmp4kb95.apps.googleusercontent.com";
let googleKeyCache = { expiresAt: 0, keys: [] };

const defaultProducts = [
  { id: "linen-overshirt", name: "Linen Overshirt", category: "men", description: "Breathable layer with a relaxed tailored fit.", price: 6200, image: "assets/product-overshirt.svg", offer: "New", soldOut: false },
  { id: "satin-midi-dress", name: "Satin Midi Dress", category: "women", description: "Soft shine, fluid drape, evening-ready comfort.", price: 8900, image: "assets/product-dress.svg", offer: "15% OFF", soldOut: false },
  { id: "boxy-cotton-tee", name: "Boxy Cotton Tee", category: "men", description: "Heavy cotton tee with a clean structured sleeve.", price: 2800, image: "assets/product-tee.svg", offer: "Best seller", soldOut: false },
  { id: "rib-knit-top", name: "Rib Knit Top", category: "women", description: "Fine rib texture with a close, comfortable fit.", price: 3400, image: "assets/product-knit-top.svg", offer: "", soldOut: false },
  { id: "utility-jacket", name: "Utility Jacket", category: "outerwear", description: "Four-pocket canvas jacket for all-season layering.", price: 11200, image: "assets/product-utility-jacket.svg", offer: "", soldOut: true },
  { id: "wide-leg-trouser", name: "Wide Leg Trouser", category: "women", description: "Pressed front, soft fall, easy office-to-dinner style.", price: 7200, image: "assets/product-trouser.svg", offer: "Free delivery", soldOut: false },
  { id: "soft-hoodie", name: "Soft Hoodie", category: "men", description: "Brushed fleece hoodie with hidden side pockets.", price: 5900, image: "assets/product-hoodie.svg", offer: "", soldOut: false },
  { id: "wool-blend-coat", name: "Wool Blend Coat", category: "outerwear", description: "Longline coat with a clean collar and warm hand feel.", price: 16800, image: "assets/product-coat.svg", offer: "Premium", soldOut: false },
];

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function ensureDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_PATH)) {
    writeDb({
      products: defaultProducts,
      users: [],
      orders: [],
      siteMessage: "Welcome! New offers are available today.",
    });
  }
}

function readDb() {
  ensureDb();
  return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
}

function writeDb(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function json(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) req.destroy();
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.pbkdf2Sync(String(password), salt, 120000, 32, "sha256").toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored) return false;
  const [salt] = stored.split(":");
  return crypto.timingSafeEqual(Buffer.from(hashPassword(password, salt)), Buffer.from(stored));
}

function signToken(payload) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + 1000 * 60 * 60 * 24 * 7 })).toString("base64url");
  const sig = crypto.createHmac("sha256", SESSION_SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function verifyToken(token) {
  if (!token || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  const expected = crypto.createHmac("sha256", SESSION_SECRET).update(body).digest("base64url");
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  return payload.exp > Date.now() ? payload : null;
}

function authPayload(req) {
  const header = req.headers.authorization || "";
  return verifyToken(header.replace(/^Bearer\s+/i, ""));
}

function requireAdmin(req, res) {
  const payload = authPayload(req);
  if (payload?.role !== "admin") {
    json(res, 401, { error: "Admin login required." });
    return null;
  }
  return payload;
}

function requireUser(req, res) {
  const payload = authPayload(req);
  if (!payload?.email) {
    json(res, 401, { error: "Login required." });
    return null;
  }
  return payload;
}

function publicUser(user) {
  if (!user) return null;
  return {
    email: user.email,
    name: user.name,
    provider: user.provider,
    blocked: Boolean(user.blocked),
    addresses: user.addresses || [],
  };
}

function calcDiscount(item) {
  const percent = Number(String(item.offer || "").match(/(\d+)%/)?.[1] || 0);
  return item.price * item.quantity * (percent / 100);
}

function calculateOrder(items) {
  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const delivery = subtotal > 0 && subtotal < 7500 ? 250 : 0;
  const discount = items.reduce((sum, item) => sum + calcDiscount(item), 0);
  return { subtotal, delivery, discount, total: Math.max(subtotal + delivery - discount, 0) };
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      let body = "";
      response.on("data", (chunk) => (body += chunk));
      response.on("end", () => {
        try {
          resolve({ data: JSON.parse(body), cacheControl: response.headers["cache-control"] || "" });
        } catch (error) {
          reject(error);
        }
      });
    }).on("error", reject);
  });
}

async function getGoogleKeys() {
  if (googleKeyCache.expiresAt > Date.now() && googleKeyCache.keys.length) return googleKeyCache.keys;
  const { data, cacheControl } = await fetchJson("https://www.googleapis.com/oauth2/v3/certs");
  const maxAge = Number(String(cacheControl).match(/max-age=(\d+)/)?.[1] || 3600);
  googleKeyCache = { expiresAt: Date.now() + maxAge * 1000, keys: data.keys || [] };
  return googleKeyCache.keys;
}

async function verifyGoogleCredential(credential) {
  const [encodedHeader, encodedPayload, signature] = String(credential || "").split(".");
  if (!encodedHeader || !encodedPayload || !signature) return null;
  const header = JSON.parse(Buffer.from(encodedHeader, "base64url").toString("utf8"));
  const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  const keys = await getGoogleKeys();
  const key = keys.find((item) => item.kid === header.kid);
  if (!key) return null;
  const verifier = crypto.createVerify("RSA-SHA256");
  verifier.update(`${encodedHeader}.${encodedPayload}`);
  verifier.end();
  const valid = verifier.verify(crypto.createPublicKey({ key, format: "jwk" }), signature, "base64url");
  if (!valid) return null;
  if (!["accounts.google.com", "https://accounts.google.com"].includes(payload.iss)) return null;
  if (payload.aud !== GOOGLE_CLIENT_ID) return null;
  if (Number(payload.exp || 0) * 1000 < Date.now()) return null;
  if (payload.email_verified === false) return null;
  return payload;
}

function sanitizeProduct(input) {
  const name = String(input.name || "").trim();
  const id = String(input.id || name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || crypto.randomUUID()).slice(0, 80);
  return {
    id,
    name: name.slice(0, 120),
    category: ["men", "women", "outerwear"].includes(input.category) ? input.category : "men",
    description: String(input.description || "").trim().slice(0, 240),
    price: Math.max(1, Number(input.price || 0)),
    image: String(input.image || "assets/product-tee.svg").trim(),
    offer: String(input.offer || "").trim().slice(0, 40),
    soldOut: Boolean(input.soldOut),
  };
}

async function handleApi(req, res, route) {
  const db = readDb();

  if (req.method === "GET" && route === "/api/store") {
    json(res, 200, { products: db.products, siteMessage: db.siteMessage });
    return;
  }

  if (req.method === "POST" && route === "/api/auth/login") {
    const body = await readBody(req);
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    if (!email || password.length < 6) return json(res, 400, { error: "Email and 6 character password required." });
    let user = db.users.find((item) => item.email === email);
    if (user && user.passwordHash && !verifyPassword(password, user.passwordHash)) {
      return json(res, 401, { error: "Wrong email or password." });
    }
    if (!user) {
      user = { email, name: email.split("@")[0], provider: "Email", passwordHash: hashPassword(password), blocked: false, addresses: [], createdAt: new Date().toISOString() };
      db.users.push(user);
    }
    user.lastLoginAt = new Date().toISOString();
    writeDb(db);
    json(res, 200, { token: signToken({ role: "user", email }), user: publicUser(user) });
    return;
  }

  if (req.method === "POST" && route === "/api/auth/google") {
    const body = await readBody(req);
    const profile = await verifyGoogleCredential(body.credential);
    if (!profile?.email) return json(res, 400, { error: "Invalid Google credential." });
    const email = profile.email.toLowerCase();
    let user = db.users.find((item) => item.email === email);
    if (!user) {
      user = { email, name: profile.name || email.split("@")[0], provider: "Google", blocked: false, addresses: [], createdAt: new Date().toISOString() };
      db.users.push(user);
    }
    user.name = profile.name || user.name;
    user.provider = "Google";
    user.lastLoginAt = new Date().toISOString();
    writeDb(db);
    json(res, 200, { token: signToken({ role: "user", email }), user: publicUser(user) });
    return;
  }

  if (req.method === "GET" && route === "/api/me") {
    const payload = requireUser(req, res);
    if (!payload) return;
    json(res, 200, { user: publicUser(db.users.find((item) => item.email === payload.email)) });
    return;
  }

  if (req.method === "POST" && route === "/api/addresses") {
    const payload = requireUser(req, res);
    if (!payload) return;
    const body = await readBody(req);
    const user = db.users.find((item) => item.email === payload.email);
    if (!user || user.blocked) return json(res, 403, { error: "This user is blocked." });
    const address = {
      name: String(body.name || "").trim().slice(0, 120),
      phone: String(body.phone || "").trim().slice(0, 40),
      address: String(body.address || "").trim().slice(0, 300),
    };
    if (!address.name || !address.phone || !address.address) return json(res, 400, { error: "Complete address is required." });
    user.addresses = [address, ...(user.addresses || []).filter((item) => item.address !== address.address)].slice(0, 3);
    writeDb(db);
    json(res, 200, { user: publicUser(user) });
    return;
  }

  if (req.method === "POST" && route === "/api/orders") {
    const body = await readBody(req);
    const payload = authPayload(req);
    const user = payload?.email ? db.users.find((item) => item.email === payload.email) : null;
    if (user?.blocked) return json(res, 403, { error: "This user is blocked." });
    const requestedItems = Array.isArray(body.items) ? body.items : [];
    const items = requestedItems.map((item) => {
      const product = db.products.find((productItem) => productItem.id === item.id);
      if (!product || product.soldOut) return null;
      return { ...product, size: String(item.size || "M").slice(0, 8), quantity: Math.max(1, Math.min(20, Number(item.quantity || 1))) };
    }).filter(Boolean);
    if (!items.length) return json(res, 400, { error: "No available items in cart." });
    const customer = {
      name: String(body.customer?.name || "").trim().slice(0, 120),
      phone: String(body.customer?.phone || "").trim().slice(0, 40),
      address: String(body.customer?.address || "").trim().slice(0, 300),
      email: user?.email || String(body.customer?.email || "guest").trim().slice(0, 120),
    };
    if (!customer.name || !customer.phone || !customer.address) return json(res, 400, { error: "Complete delivery address is required." });
    if (user) user.addresses = [customer, ...(user.addresses || []).filter((item) => item.address !== customer.address)].slice(0, 3);
    const totals = calculateOrder(items);
    const order = {
      id: `TL-${Date.now().toString().slice(-6)}`,
      date: new Date().toISOString(),
      customer,
      payment: ["JazzCash", "EasyPaisa", "Bank Transfer"].includes(body.payment) ? body.payment : "JazzCash",
      paymentStatus: "Pending",
      status: "Pending",
      items,
      ...totals,
    };
    db.orders.unshift(order);
    writeDb(db);
    json(res, 201, { order, user: publicUser(user) });
    return;
  }

  if (req.method === "POST" && route === "/api/admin/login") {
    const body = await readBody(req);
    if (String(body.passcode || "") !== ADMIN_PASSWORD) return json(res, 401, { error: "Wrong admin passcode." });
    json(res, 200, { token: signToken({ role: "admin" }) });
    return;
  }

  if (route.startsWith("/api/admin")) {
    if (!requireAdmin(req, res)) return;
    if (req.method === "GET" && route === "/api/admin") {
      json(res, 200, { products: db.products, orders: db.orders, users: db.users.map(publicUser), siteMessage: db.siteMessage });
      return;
    }
    if (req.method === "POST" && route === "/api/admin/products") {
      const product = sanitizeProduct(await readBody(req));
      const index = db.products.findIndex((item) => item.id === product.id);
      if (index >= 0) db.products[index] = product;
      else db.products.unshift(product);
      writeDb(db);
      json(res, 200, { product });
      return;
    }
    const productDelete = route.match(/^\/api\/admin\/products\/([^/]+)$/);
    if (req.method === "DELETE" && productDelete) {
      db.products = db.products.filter((item) => item.id !== decodeURIComponent(productDelete[1]));
      writeDb(db);
      json(res, 200, { ok: true });
      return;
    }
    const orderPatch = route.match(/^\/api\/admin\/orders\/([^/]+)$/);
    if (req.method === "PATCH" && orderPatch) {
      const body = await readBody(req);
      const order = db.orders.find((item) => item.id === decodeURIComponent(orderPatch[1]));
      if (!order) return json(res, 404, { error: "Order not found." });
      order.status = String(body.status || order.status).slice(0, 40);
      writeDb(db);
      json(res, 200, { order });
      return;
    }
    const userPatch = route.match(/^\/api\/admin\/users\/(.+)$/);
    if (req.method === "PATCH" && userPatch) {
      const body = await readBody(req);
      const user = db.users.find((item) => item.email === decodeURIComponent(userPatch[1]));
      if (!user) return json(res, 404, { error: "User not found." });
      user.blocked = Boolean(body.blocked);
      writeDb(db);
      json(res, 200, { user: publicUser(user) });
      return;
    }
    if (req.method === "PUT" && route === "/api/admin/message") {
      const body = await readBody(req);
      db.siteMessage = String(body.message || "").trim().slice(0, 240);
      writeDb(db);
      json(res, 200, { siteMessage: db.siteMessage });
      return;
    }
  }

  json(res, 404, { error: "API route not found." });
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const rawPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = path.normalize(path.join(ROOT, rawPath));
  if (!filePath.startsWith(ROOT) || filePath.includes(`${path.sep}data${path.sep}`)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream" });
    res.end(content);
  });
}

ensureDb();

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url.pathname);
      return;
    }
    serveStatic(req, res);
  } catch (error) {
    json(res, 500, { error: "Server error.", detail: error.message });
  }
}).listen(PORT, () => {
  console.log(`Store server running at http://localhost:${PORT}`);
});
