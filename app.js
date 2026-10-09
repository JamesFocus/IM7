const $ = s => document.querySelector(s);
const state = { userId: "u_demo", users: [], items: [], config: {} };
const money = n => new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(Number(n||0));
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
async function api(url, options={}) {
  const headers = { "Content-Type":"application/json", "x-user-id":state.userId, ...(options.headers||{}) };
  const res = await fetch(url,{...options,headers});
  const data = await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}
let toastTimer;
function toast(msg){const el=$("#toast");el.textContent=msg;el.classList.add("show");clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove("show"),3200)}
function remaining(endsAt){const ms=new Date(endsAt)-Date.now();if(ms<=0)return "Auction ended";const h=Math.floor(ms/3600000),m=Math.floor(ms%3600000/60000);return h?`${h}h ${m}m left`:`${m}m left`}
async function init(){
  try{
    state.config=await api("/api/config");
    state.users=await api("/api/users");
    $("#userSelect").innerHTML=state.users.map(u=>`<option value="${esc(u.id)}">${esc(u.name)} · ${money(u.wallet)}</option>`).join("");
    $("#userSelect").value=state.userId;
    await refreshAll();
    if(new URLSearchParams(location.search).get("paypal")==="return") toast("Returned from PayPal. Complete payment capture from your checkout flow.");
    if(new URLSearchParams(location.search).get("paypal")==="cancel") toast("PayPal checkout was cancelled.");
  }catch(e){toast(e.message)}
}
async function refreshAll(){state.items=await api("/api/items");renderFeed();await refreshMe();await renderHistory()}
async function refreshMe(){
  const me=await api("/api/me");
  $("#walletBalance").innerHTML=`${money(me.wallet)} <span>USD</span>`;
  $("#avatar").textContent=(me.name||"U").slice(0,1).toUpperCase();
  const opt=[...$("#userSelect").options].find(o=>o.value===state.userId);
  if(opt)opt.textContent=`${me.name} · ${money(me.wallet)}`;
}
function renderFeed(){
 const search=$("#search").value.trim().toLowerCase(), filter=$("#filter").value;
 const list=state.items.filter(i=>{
   const matches=`${i.title} ${i.description} ${i.category} ${i.seller.name}`.toLowerCase().includes(search);
   return matches && (filter==="all" || (filter==="mine"&&i.sellerId===state.userId) || (filter==="active"&&i.status==="active") || (filter==="ended"&&i.status!=="active"));
 });
 $("#statActive").textContent=state.items.filter(i=>i.status==="active").length;
 $("#empty").classList.toggle("hidden",list.length>0);
 $("#feedGrid").innerHTML=list.map(itemCard).join("");
}
function itemCard(i){
 const active=i.status==="active", mine=i.sellerId===state.userId;
 const img=i.imageUrl?`<img src="${esc(i.imageUrl)}" alt="${esc(i.title)}" onerror="this.style.display='none';this.nextElementSibling.style.display='grid'"><div class="image-placeholder" style="display:none">◇</div>`:`<div class="image-placeholder">◇</div>`;
 const comments=i.comments.slice(-4).map(c=>`<div class="comment"><b>${esc(c.author.name)}:</b> ${esc(c.text)}</div>`).join("")||`<div class="comment">Be the first to ask a question.</div>`;
 const bidArea=active&&!mine?`<form class="bid-form" data-bid="${esc(i.id)}"><input type="number" min="${(Number(i.currentPrice)+1).toFixed(2)}" step=".01" name="amount" placeholder="Min. ${money(Number(i.currentPrice)+1)}" required><button class="button button-dark" type="submit">Place bid ↗</button></form>`:
 active&&mine?`<div class="ended-note">Your listing is live. Other users can bid and comment.</div>`:
 `<div class="ended-note">${i.winnerId?`Winner: <b>${esc((i.bids.find(b=>b.userId===i.winnerId)||{}).bidder?.name||"Auction winner")}</b>`:"Auction ended without bids."}${i.status==="ended"&&mine?` <button class="button button-outline settle-btn" data-settle="${esc(i.id)}">Settle demo sale</button>`:""}</div>`;
 return `<article class="item-card"><div class="item-image">${img}<span class="item-tag ${active?"":"ended"}">${active?"● Live auction":i.status==="sold"?"Sold":"Ended"}</span></div><div class="item-body"><div class="item-meta"><span>${esc(i.category)}</span><span class="seller"><span class="seller-avatar">${esc(i.seller.name.slice(0,1).toUpperCase())}</span>${esc(i.seller.name)}</span></div><h3>${esc(i.title)}</h3><div class="item-description">${esc(i.description||"A community listing. Leave a comment to ask the seller a question.")}</div><div class="bid-row"><div><small>${active?"CURRENT BID":"FINAL BID"}</small><div class="bid-price">${money(i.currentPrice)}</div></div><div class="bid-count"><b>${i.bids.length} bid${i.bids.length===1?"":"s"}</b><br>${active?remaining(i.endsAt):"Closed"}</div></div>${bidArea}<div class="comment-area"><div class="comment-title">COMMENTS · ${i.comments.length}</div><div class="comment-list">${comments}</div><form class="comment-form" data-comment="${esc(i.id)}"><input name="text" maxlength="500" placeholder="Ask a question or leave a comment…" required><button type="submit">↗</button></form></div></div></article>`;
}
async function renderHistory(){
 try{
 const data=await api("/api/history");
 const rows=(data.transactions||[]).map(t=>({title:t.type==="wallet_refill"?"Wallet refill":t.type==="sale"?"Auction sale":"Auction purchase",detail:`${t.currency||"USD"} · ${new Date(t.at).toLocaleString()}`,amount:t.amount,positive:t.type==="wallet_refill"||t.type==="sale",mode:t.mode}));
 $("#historyList").innerHTML=rows.length?rows.map(r=>`<div class="history-row"><div><strong>${esc(r.title)}</strong><small>${esc(r.detail)}${r.mode==="DEMO"?" · Demo only":""}</small></div><div class="history-amount ${r.positive?"positive":"negative"}">${r.positive?"+":"−"}${money(r.amount)}</div></div>`).join(""):`<div class="empty">No activity yet. Your wallet refills and auction transactions will appear here.</div>`;
 }catch(e){$("#historyList").innerHTML=`<div class="empty">${esc(e.message)}</div>`}
}
function openPost(){$("#postModal").classList.remove("hidden")}
function closePost(){$("#postModal").classList.add("hidden")}
$("#postBtn").addEventListener("click",openPost);$("#heroPost").addEventListener("click",openPost);
document.querySelectorAll("[data-close]").forEach(el=>el.addEventListener("click",closePost));
$("#userSelect").addEventListener("change",async e=>{state.userId=e.target.value;await refreshAll();toast("Switched demo account.")});
$("#search").addEventListener("input",renderFeed);$("#filter").addEventListener("change",renderFeed);
$("#postForm").addEventListener("submit",async e=>{
 e.preventDefault();const body=Object.fromEntries(new FormData(e.currentTarget).entries());body.startingPrice=Number(body.startingPrice);body.durationHours=Number(body.durationHours);
 try{await api("/api/items",{method:"POST",body:JSON.stringify(body)});closePost();e.currentTarget.reset();await refreshAll();$("#feed").scrollIntoView({behavior:"smooth"});toast("Your item is now live in the feed.");}catch(err){toast(err.message)}
});
$("#feedGrid").addEventListener("submit",async e=>{
 e.preventDefault();const bidForm=e.target.closest("[data-bid]"),commentForm=e.target.closest("[data-comment]");
 try{
 if(bidForm){const id=bidForm.dataset.bid;const amount=Number(new FormData(bidForm).get("amount"));await api(`/api/items/${id}/bids`,{method:"POST",body:JSON.stringify({amount})});toast("Your bid has been placed.");}
 if(commentForm){const id=commentForm.dataset.comment;const text=new FormData(commentForm).get("text");await api(`/api/items/${id}/comments`,{method:"POST",body:JSON.stringify({text})});toast("Comment posted.");}
 await refreshAll();
 }catch(err){toast(err.message)}
});
$("#feedGrid").addEventListener("click",async e=>{
 const btn=e.target.closest("[data-settle]");if(!btn)return;
 if(!confirm("Settle this auction in DEMO mode? This only updates the local test ledger; no real money moves."))return;
 try{await api("/api/auctions/settle",{method:"POST",body:JSON.stringify({itemId:btn.dataset.settle})});await refreshAll();toast("Demo sale settled. No real money moved.");}catch(err){toast(err.message)}
});
document.querySelectorAll("[data-amount]").forEach(b=>b.addEventListener("click",()=>{document.querySelectorAll("[data-amount]").forEach(x=>x.classList.remove("selected"));b.classList.add("selected");$("#refillAmount").value=b.dataset.amount}));
$("#refillBtn").addEventListener("click",async()=>{
 const amount=Number($("#refillAmount").value);
 if(!Number.isFinite(amount)||amount<5||amount>10000){toast("Enter an amount between $5 and $10,000.");return}
 try{
 const order=await api("/api/paypal/create-order",{method:"POST",body:JSON.stringify({amount})});
 if(order.demo){toast("Demo order created only. No money was charged and your wallet was not credited.");alert("Preview mode only\n\nOrder: "+order.orderID+"\nNo real payment was taken. Wallet balance stays unchanged.\n\nTo accept real payments, configure PayPal sandbox credentials in .env.");return}
 if(order.approvalUrl)location.href=order.approvalUrl;else toast("PayPal order created, but no approval URL was returned.");
 }catch(err){toast(err.message)}
});
$("#refreshHistory").addEventListener("click",async()=>{await refreshAll();toast("Activity refreshed.")});
init();
setInterval(async()=>{try{state.items=await api("/api/items");renderFeed()}catch{}},15000);
