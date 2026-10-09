require("dotenv").config();
const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
const DEMO_MODE = String(process.env.DEMO_MODE || "true").toLowerCase() === "true";
const PAYPAL_BASE = process.env.PAYPAL_ENV === "live"
  ? "https://api-m.paypal.com"
  : "https://api-m.sandbox.paypal.com";
const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");
fs.mkdirSync(DATA_DIR, { recursive: true });

function seed() {
  return {
    users: [
      { id: "u_demo", name: "Demo User", email: "demo@example.com", wallet: 250, paypalPayerId: null, createdAt: new Date().toISOString() },
      { id: "u_seller", name: "Mina Seller", email: "mina@example.com", wallet: 0, paypalPayerId: null, createdAt: new Date().toISOString() }
    ],
    items: [
      {
        id: "item_welcome", sellerId: "u_seller", title: "Vintage instant camera",
        description: "A clean vintage-style instant camera. See photos and ask questions before bidding.",
        category: "Electronics", imageUrl: "https://images.unsplash.com/photo-1516035069371-29a1b244cc32?auto=format&fit=crop&w=1200&q=80",
        startingPrice: 35, currentPrice: 42, endsAt: new Date(Date.now() + 1000 * 60 * 60 * 5).toISOString(),
        status: "active", winnerId: null, bids: [{ id: "b_seed", userId: "u_demo", amount: 42, at: new Date().toISOString() }],
        comments: [{ id: "c_seed", userId: "u_demo", text: "Does it include a strap?", at: new Date().toISOString() }],
        createdAt: new Date().toISOString()
      }
    ],
    transactions: [],
    payouts: [],
    paymentOrders: []
  };
}
function loadDB() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, "utf8")); }
  catch { const db = seed(); saveDB(db); return db; }
}
function saveDB(db) { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); }
let db = loadDB();

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

const publicUser = u => ({ id: u.id, name: u.name, wallet: Number(u.wallet || 0) });
const findUser = id => db.users.find(u => u.id === id);
const findItem = id => db.items.find(i => i.id === id);
const money = n => Math.round(Number(n) * 100) / 100;
const safeItem = item => ({
  ...item,
  seller: publicUser(findUser(item.sellerId) || { id: item.sellerId, name: "Unknown seller", wallet: 0 }),
  bids: (item.bids || []).slice().sort((a,b) => b.amount - a.amount).map(b => ({ ...b, bidder: publicUser(findUser(b.userId) || { id: b.userId, name: "User", wallet: 0 }) })),
  comments: (item.comments || []).slice().sort((a,b) => new Date(a.at) - new Date(b.at)).map(c => ({ ...c, author: publicUser(findUser(c.userId) || { id: c.userId, name: "User", wallet: 0 }) }))
});
function requireUser(req, res, next) {
  const id = req.header("x-user-id") || req.body.userId || req.query.userId;
  const user = findUser(id);
  if (!user) return res.status(401).json({ error: "Choose a demo user or sign in." });
  req.user = user; next();
}
function expireAuctions() {
  let changed = false;
  for (const item of db.items) {
    if (item.status === "active" && new Date(item.endsAt).getTime() <= Date.now()) {
      item.status = "ended";
      const top = (item.bids || []).slice().sort((a,b) => b.amount - a.amount)[0];
      item.winnerId = top ? top.userId : null;
      item.endedAt = new Date().toISOString();
      changed = true;
    }
  }
  if (changed) saveDB(db);
}
setInterval(expireAuctions, 5000).unref();

app.get("/api/config", (req,res) => res.json({
  demoMode: DEMO_MODE,
  paypalConfigured: Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET),
  paypalEnv: process.env.PAYPAL_ENV || "sandbox",
  currency: "USD"
}));
app.get("/api/users", (req,res) => res.json(db.users.map(publicUser)));
app.get("/api/me", requireUser, (req,res) => res.json({
  ...publicUser(req.user),
  transactions: db.transactions.filter(t => t.userId === req.user.id || t.relatedUserId === req.user.id).slice().reverse(),
  payouts: db.payouts.filter(p => p.sellerId === req.user.id).slice().reverse()
}));
app.get("/api/items", (req,res) => {
  expireAuctions();
  const items = db.items.slice().sort((a,b) => new Date(b.createdAt)-new Date(a.createdAt)).map(safeItem);
  res.json(items);
});
app.post("/api/items", requireUser, (req,res) => {
  const { title, description, category, imageUrl, startingPrice, durationHours } = req.body;
  const price = money(startingPrice);
  const hours = Number(durationHours);
  if (!title || String(title).trim().length < 3) return res.status(400).json({ error: "Title must be at least 3 characters." });
  if (!Number.isFinite(price) || price < 1) return res.status(400).json({ error: "Starting price must be at least $1." });
  if (!Number.isFinite(hours) || hours < 1 || hours > 168) return res.status(400).json({ error: "Auction duration must be 1–168 hours." });
  const item = {
    id: crypto.randomUUID(), sellerId: req.user.id, title: String(title).trim().slice(0,100),
    description: String(description || "").trim().slice(0,2000), category: String(category || "Other").slice(0,40),
    imageUrl: String(imageUrl || "").trim().slice(0,1000), startingPrice: price, currentPrice: price,
    endsAt: new Date(Date.now() + hours * 3600000).toISOString(), status: "active",
    winnerId: null, bids: [], comments: [], createdAt: new Date().toISOString()
  };
  db.items.push(item); saveDB(db); res.status(201).json(safeItem(item));
});
app.post("/api/items/:id/comments", requireUser, (req,res) => {
  const item = findItem(req.params.id);
  if (!item) return res.status(404).json({ error: "Item not found." });
  const text = String(req.body.text || "").trim();
  if (!text || text.length > 500) return res.status(400).json({ error: "Comment must be 1–500 characters." });
  item.comments.push({ id: crypto.randomUUID(), userId: req.user.id, text, at: new Date().toISOString() });
  saveDB(db); res.status(201).json(safeItem(item));
});
app.post("/api/items/:id/bids", requireUser, (req,res) => {
  expireAuctions();
  const item = findItem(req.params.id);
  if (!item) return res.status(404).json({ error: "Item not found." });
  if (item.status !== "active") return res.status(400).json({ error: "This auction has ended." });
  if (item.sellerId === req.user.id) return res.status(400).json({ error: "You cannot bid on your own item." });
  const amount = money(req.body.amount);
  const minimum = money(item.currentPrice + 1);
  if (!Number.isFinite(amount) || amount < minimum) return res.status(400).json({ error: `Your bid must be at least $${minimum.toFixed(2)}.` });
  if (req.user.wallet < amount) return res.status(400).json({ error: "Not enough demo wallet balance. Refill your wallet first." });
  // MVP: bid amounts are validated against available wallet balance but are not reserved.
  item.currentPrice = amount;
  item.bids.push({ id: crypto.randomUUID(), userId: req.user.id, amount, at: new Date().toISOString() });
  saveDB(db); res.status(201).json(safeItem(item));
});
app.post("/api/auctions/settle", requireUser, (req,res) => {
  // Explicit demo settlement. Real money settlement requires verified payment and marketplace payout onboarding.
  expireAuctions();
  const item = findItem(req.body.itemId);
  if (!item) return res.status(404).json({ error: "Item not found." });
  if (item.status !== "ended") return res.status(400).json({ error: "Auction has not ended yet." });
  if (!item.winnerId) return res.status(400).json({ error: "No bids were placed." });
  if (db.transactions.some(t => t.itemId === item.id && t.type === "purchase")) return res.status(400).json({ error: "This auction is already settled." });
  const winner = findUser(item.winnerId), seller = findUser(item.sellerId);
  const winningBid = item.bids.slice().sort((a,b)=>b.amount-a.amount)[0];
  if (!winner || !seller) return res.status(400).json({ error: "Buyer or seller account missing." });
  if (winner.wallet < winningBid.amount) return res.status(400).json({ error: "Winner's wallet balance is insufficient. Payment is required before seller payout." });
  winner.wallet = money(winner.wallet - winningBid.amount);
  seller.wallet = money(seller.wallet + winningBid.amount);
  db.transactions.push({ id: crypto.randomUUID(), type:"purchase", itemId:item.id, userId:winner.id, relatedUserId:seller.id, amount:winningBid.amount, currency:"USD", at:new Date().toISOString(), mode:"DEMO" });
  db.transactions.push({ id: crypto.randomUUID(), type:"sale", itemId:item.id, userId:seller.id, relatedUserId:winner.id, amount:winningBid.amount, currency:"USD", at:new Date().toISOString(), mode:"DEMO" });
  item.status = "sold"; item.settledAt = new Date().toISOString();
  saveDB(db);
  res.json({ message: "Demo settlement complete. No real money moved.", item: safeItem(item), buyer: publicUser(winner), seller: publicUser(seller) });
});
app.post("/api/paypal/create-order", requireUser, async (req,res) => {
  const amount = money(req.body.amount);
  if (!Number.isFinite(amount) || amount < 5 || amount > 10000) return res.status(400).json({ error: "Refill must be between $5 and $10,000 USD." });
  if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) {
    if (!DEMO_MODE) return res.status(503).json({ error: "PayPal is not configured. Add your credentials to .env." });
    const orderID = "DEMO-" + crypto.randomUUID();
    db.paymentOrders.push({ id: orderID, userId:req.user.id, amount, status:"CREATED_DEMO", createdAt:new Date().toISOString() });
    saveDB(db);
    return res.json({ demo:true, orderID, message:"Demo order created. No real payment has been taken." });
  }
  try {
    const token = await paypalToken();
    const response = await fetch(`${PAYPAL_BASE}/v2/checkout/orders`, {
      method:"POST", headers:{ Authorization:`Bearer ${token}`, "Content-Type":"application/json" },
      body:JSON.stringify({ intent:"CAPTURE", purchase_units:[{ reference_id:req.user.id, description:"Auction wallet refill", amount:{currency_code:"USD", value:amount.toFixed(2)} }],
        application_context:{ brand_name:"Auction Market", user_action:"PAY_NOW", return_url:`${BASE_URL}/?paypal=return`, cancel_url:`${BASE_URL}/?paypal=cancel` } })
    });
    const data = await response.json();
    if (!response.ok) return res.status(502).json({ error:"PayPal could not create the order.", details:data.message || data.name });
    db.paymentOrders.push({ id:data.id, userId:req.user.id, amount, status:"CREATED", createdAt:new Date().toISOString() }); saveDB(db);
    res.json({ orderID:data.id, approvalUrl:(data.links || []).find(l=>l.rel==="approve")?.href });
  } catch(e) { res.status(502).json({ error:"PayPal connection failed.", details:e.message }); }
});
app.post("/api/paypal/capture-order", requireUser, async (req,res) => {
  const orderID = String(req.body.orderID || "");
  const order = db.paymentOrders.find(o => o.id === orderID && o.userId === req.user.id);
  if (!order) return res.status(404).json({ error:"Payment order not found for this user." });
  if (order.status === "CAPTURED") return res.json({ message:"Already credited.", balance:req.user.wallet });
  if (order.status === "CREATED_DEMO") {
    if (!DEMO_MODE) return res.status(400).json({ error:"Demo order cannot be captured in production." });
    order.status = "DEMO_NOT_PAID";
    saveDB(db);
    return res.status(400).json({ error:"This is a preview only. No real payment was made and wallet was not credited." });
  }
  try {
    const token = await paypalToken();
    const response = await fetch(`${PAYPAL_BASE}/v2/checkout/orders/${encodeURIComponent(orderID)}/capture`, {
      method:"POST", headers:{ Authorization:`Bearer ${token}`, "Content-Type":"application/json" }
    });
    const data = await response.json();
    if (!response.ok || data.status !== "COMPLETED") return res.status(502).json({ error:"PayPal capture was not completed.", details:data.message || data.status });
    const capture = data.purchase_units?.[0]?.payments?.captures?.[0];
    if (!capture || capture.status !== "COMPLETED" || Number(capture.amount?.value) !== order.amount || capture.amount?.currency_code !== "USD")
      return res.status(400).json({ error:"Capture amount/currency verification failed." });
    // Credit once only after a completed, verified capture.
    order.status = "CAPTURED"; order.captureID = capture.id; order.capturedAt = new Date().toISOString();
    req.user.wallet = money(req.user.wallet + order.amount);
    const payer = data.payer || {};
    req.user.paypalPayerId = payer.payer_id || req.user.paypalPayerId;
    // PayPal does not guarantee buyer's physical address. Keep only address returned with the order if present.
    const address = data.purchase_units?.[0]?.shipping?.address || null;
    order.payer = { payerId:payer.payer_id || null, email:payer.email_address || null, name:payer.name ? `${payer.name.given_name || ""} ${payer.name.surname || ""}`.trim() : null, shippingAddress:address };
    db.transactions.push({ id:crypto.randomUUID(), type:"wallet_refill", userId:req.user.id, amount:order.amount, currency:"USD", at:new Date().toISOString(), mode:"PAYPAL", reference:capture.id });
    saveDB(db);
    res.json({ message:"PayPal payment captured and wallet credited.", balance:req.user.wallet, payer:order.payer });
  } catch(e) { res.status(502).json({ error:"PayPal capture failed.", details:e.message }); }
});
async function paypalToken() {
  const auth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString("base64");
  const r = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, { method:"POST", headers:{ Authorization:`Basic ${auth}`, "Content-Type":"application/x-www-form-urlencoded" }, body:"grant_type=client_credentials" });
  const d = await r.json(); if (!r.ok) throw new Error(d.error_description || d.error || "PayPal authentication failed");
  return d.access_token;
}
app.get("/api/history", requireUser, (req,res) => {
  res.json({
    transactions: db.transactions.filter(t=>t.userId===req.user.id || t.relatedUserId===req.user.id).slice().reverse(),
    payouts: db.payouts.filter(p=>p.sellerId===req.user.id).slice().reverse(),
    orders: db.paymentOrders.filter(o=>o.userId===req.user.id).slice().reverse()
  });
});
app.get("*", (req,res) => res.sendFile(path.join(__dirname,"public","index.html")));
app.listen(PORT, () => console.log(`Auction Market running at ${BASE_URL} (demo mode: ${DEMO_MODE})`));
