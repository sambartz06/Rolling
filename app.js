/* Word ("what's the word?").
 * No build step. Two modes:
 *  - Live: config.js has Supabase keys. People sign in, and posts, replies, friends,
 *    favorites and settings are saved in the database (see backend.js and
 *    supabase/schema.sql). The app keeps a copy in `state` and refreshes it often.
 *  - Demo: no keys. Sample data saved in this browser only, with a "Viewing as"
 *    switcher instead of sign-in. */
(function () {
  "use strict";

  const STORE_KEY = "rolling.state.v2";
  const BARS = window.ROLLING_BARS;
  const BAR_BY_ID = Object.fromEntries(BARS.map((b) => [b.id, b]));
  const CAMPUS = [43.0745, -89.3925]; // Library Mall / State St
  // Always shown on the map, even before anyone has history (Sam, 2026-11-18):
  // State Street Brats, Chasers II, Moon Bar, The Double U, Monday's, Wando's,
  // Jay's, City Bar, Sconnie Bar.
  const STARTER_BARS = ["w886357869", "n2522840399", "n13120355381", "n4479808708", "w1441901386",
    "w875584137", "w875584136", "w1435231298", "w369451920"];
  const COMMENT_WORDS = 100;
  const DAY = 24 * 3600 * 1000;

  // ---------- state ----------
  const API = window.WordBackend || { live: false };
  const LIVE = API.live;
  // posts: [{ id, userId, barId, at, excitement, arrive, comment, history }]
  // replies: [{ id, post: <post id>, userId, text, at }]
  // friendships: [[a, b, { by, at }]] (by = who sent the request)
  let state = LIVE
    ? { me: null, users: [], friendships: [], requests: [], posts: [], replies: [], favorites: {}, settings: {}, popularity: null }
    : load();
  let seedReplies = false;
  if (!LIVE) {
    // Demo convenience: if nobody has posted tonight (e.g. you open it tomorrow),
    // refresh tonight's mock posts so the feed and map aren't empty.
    if (!state.posts.some((p) => nightKey(p.at) === nightKey(Date.now()))) {
      const fresh = window.ROLLING_SEED().posts.filter((p) => nightKey(p.at) === nightKey(Date.now()));
      state.posts = state.posts.concat(fresh);
    }
    // Fields added in later versions; fill them in for older saved data.
    state.favorites = state.favorites || { u_sam: ["u_jake", "u_maddie"] };
    state.settings = state.settings || {};
    state.seen = state.seen || {};
    seedReplies = !state.replies;
    state.replies = state.replies || [];
    delete state.notifications; // alerts are worked out from the data now
    ensureIds();
  }
  // Demo posts used "<userId>@<timestamp>" as their id; keep that so saved replies still match.
  function ensureIds() {
    for (const p of state.posts) if (!p.id) p.id = p.userId + "@" + p.at;
    for (const r of state.replies || []) if (!r.id) r.id = uuid();
  }
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
      (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16));
  }
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(STORE_KEY));
      if (s && s.version === 2) return s;
    } catch (e) {}
    return window.ROLLING_SEED();
  }
  function save() {
    if (LIVE) return;
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {}
  }
  // Save a change: the demo writes to this browser, live mode sends it to the
  // database. The screen already shows the change; if saving fails we say so and
  // reload what's really saved.
  async function persist(send, failMsg) {
    if (!LIVE) { save(); return true; }
    try { await send(); return true; } catch (e) {
      console.error(e);
      toast(failMsg || "Couldn't save that. Check your connection and try again.");
      refresh();
      return false;
    }
  }

  const UNKNOWN = { id: "", name: "Someone", handle: "" };
  const user = (id) => state.users.find((u) => u.id === id) || Object.assign({}, UNKNOWN, { id });

  function friendIds(uid) {
    const out = new Set();
    for (const [a, b] of state.friendships) {
      if (a === uid) out.add(b);
      if (b === uid) out.add(a);
    }
    return out;
  }
  const incoming = () => state.requests.filter((r) => r.to === state.me);
  const outgoing = () => state.requests.filter((r) => r.from === state.me);

  // A "night" runs 6 AM to 6 AM, so a 1 AM post still counts for tonight.
  function nightKey(ts) {
    const d = new Date(ts - 6 * 3600 * 1000);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  const tonight = () => nightKey(Date.now());
  const tonightsPosts = () => state.posts.filter((p) => nightKey(p.at) === tonight());
  const myPost = () => tonightsPosts().find((p) => p.userId === state.me);
  // Feed and map only ever show friends (plus yourself).
  function visiblePosts() {
    const f = friendIds(state.me);
    return tonightsPosts()
      .filter((p) => f.has(p.userId) || p.userId === state.me)
      .sort((a, b) => b.at - a.at);
  }

  // ---------- popularity ----------
  // Every post by anyone counts toward a bar, newer posts count more
  // (a post loses half its weight every 3 weeks). Highest score = most popular.
  // Live mode gets the totals from the database, since you can only see your
  // friends' posts but popularity counts everyone's.
  function popularity() {
    const now = Date.now(), score = {}, month = {};
    if (state.popularity) {
      for (const [id, v] of Object.entries(state.popularity)) { score[id] = v.score; if (v.month) month[id] = v.month; }
    } else for (const p of state.posts) {
      const ageDays = Math.max(0, (now - p.at) / DAY);
      score[p.barId] = (score[p.barId] || 0) + Math.pow(0.5, ageDays / 21);
      if (ageDays <= 30) month[p.barId] = (month[p.barId] || 0) + 1;
    }
    const ranked = BARS.slice().sort((a, b) =>
      (score[b.id] || 0) - (score[a.id] || 0) || distKm(CAMPUS, [a.lat, a.lon]) - distKm(CAMPUS, [b.lat, b.lon]));
    const rank = {};
    ranked.forEach((b, i) => { if (score[b.id]) rank[b.id] = i + 1; });
    return { ranked, rank, month };
  }

  // ---------- helpers ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  function ago(ts) {
    const m = Math.max(0, Math.round((Date.now() - ts) / 60000));
    if (m < 1) return "just now";
    if (m < 60) return m + "m ago";
    return Math.floor(m / 60) + "h ago";
  }
  function distKm(a, b) {
    const R = 6371, toR = Math.PI / 180;
    const dLat = (b[0] - a[0]) * toR, dLon = (b[1] - a[1]) * toR;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * toR) * Math.cos(b[0] * toR) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
  }
  const wordCount = (s) => (s.trim().match(/\S+/g) || []).length;
  function limitWords(s, n) {
    const re = /\S+/g; let m, count = 0;
    while ((m = re.exec(s))) { if (++count > n) return s.slice(0, m.index).replace(/\s+$/, ""); }
    return s;
  }

  // Excitement 0-100 with a name for each fifth of the scale.
  const HYPE = [[20, "Lowkey"], [40, "Chill"], [60, "Down"], [80, "Hyped"], [101, "Sending it"]];
  const hypeLabel = (v) => HYPE.find(([max]) => v < max)[1];
  function meter(v, small) {
    return `<div class="meter ${small ? "sm" : ""}" title="Excitement ${v}/100">
      <div class="meter-track"><div class="meter-fill" style="width:${v}%"></div></div>
      <span class="meter-label">${hypeLabel(v)}</span></div>`;
  }

  // Arrival times every 15 minutes from 7 PM to 2 AM.
  const TIMES = [];
  for (let m = 19 * 60; m <= 26 * 60; m += 15) TIMES.push(String(Math.floor(m / 60) % 24).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"));
  function fmtTime(hhmm) {
    if (!hhmm) return "";
    let [h, m] = hhmm.split(":").map(Number);
    const ap = h >= 12 && h < 24 ? "PM" : "AM";
    h = h % 12 || 12;
    return h + ":" + String(m).padStart(2, "0") + " " + ap;
  }
  // Sort key so 12:30 AM comes after 11 PM.
  const timeKey = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return (h < 12 ? h + 24 : h) * 60 + m; };

  let toastTimer;
  function toast(msg) {
    let t = $(".toast");
    if (!t) { t = document.createElement("div"); t.className = "toast"; $("#app").appendChild(t); }
    t.textContent = msg;
    t.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add("hidden"), 2200);
  }

  // ---------- tabs ----------
  let currentTab = "feed", lastTab = "feed";
  function showTab(name) {
    if (name !== currentTab) lastTab = currentTab;
    currentTab = name;
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.id === "tab-" + name));
    const lit = name === "thread" ? "feed" : name;
    document.querySelectorAll(".tabbar [data-tab]").forEach((b) => b.classList.toggle("active", b.dataset.tab === lit));
    render();
    if (name === "map") setTimeout(() => map && map.invalidateSize(), 0);
  }
  document.querySelectorAll(".tabbar [data-tab]").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));

  // ---------- view-as switcher (stand-in for sign-in) ----------
  // Lives on the Profile tab so the top bar is just the logo, bell and gear.
  function renderViewAs() {
    if (!$("#viewAs")) return;
    $("#viewAs").innerHTML = state.users.map((u) => `<option value="${u.id}" ${u.id === state.me ? "selected" : ""}>${esc(u.name)}</option>`).join("");
  }
  document.addEventListener("change", (e) => { if (e.target.id === "viewAs") { state.me = e.target.value; save(); render(); } });
  function renderBadge() {
    const n = incoming().length;
    const b = $("#reqBadge");
    b.textContent = n;
    b.classList.toggle("hidden", !n);
  }

  // Tap a crossed-out bar to see that earlier pick; tap again to close.
  // Runs in the capture phase so it doesn't also open the post's replies.
  function fmtClock(ts) {
    const d = new Date(ts);
    return fmtTime(String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"));
  }
  document.addEventListener("click", (ev) => {
    const btn = ev.target.closest(".was");
    if (!btn) return;
    ev.stopPropagation(); ev.preventDefault();
    const card = btn.closest(".card.post, .mine, .thread-post");
    const id = card.dataset.thread || (card.querySelector("[data-thread]") || {}).dataset?.thread || card.dataset.post;
    const p = findPost(id);
    const box = btn.closest(".post-meta").querySelector(".was-box");
    const open = btn.getAttribute("aria-expanded") === "true";
    btn.closest(".post-where").querySelectorAll(".was").forEach((b) => b.setAttribute("aria-expanded", "false"));
    if (open || !p) { box.classList.add("hidden"); return; }
    const h = p.history[+btn.dataset.was];
    btn.setAttribute("aria-expanded", "true");
    box.innerHTML = `<div class="was-title"><b>${esc(BAR_BY_ID[h.barId].name)}</b> <span>· picked ${fmtClock(h.at)}</span></div>
      ${h.comment ? `<div class="was-comment">${esc(h.comment)}</div>` : `<div class="was-comment none">No comment</div>`}
      ${meter(h.excitement, true)}`;
    box.classList.remove("hidden");
  }, true);

  // "Jake", "Jake and Tyler", "Jake, Tyler and Olivia"
  function nameList(n) {
    return n.length < 2 ? (n[0] || "") : n.slice(0, -1).join(", ") + " and " + n[n.length - 1];
  }

  // ---------- feed ----------
  // Post layout (Sam, 2026-11-18): name (no profile pictures anywhere), then bar and arrival time in
  // small text, then the comment in larger text, replies, and the excitement bar last.
  function postBody(p, opts = {}) {
    const u = user(p.userId), b = BAR_BY_ID[p.barId];
    return `<div class="post-head">
        <div class="post-meta">
          <div class="line1"><span class="who">${u.id === state.me ? "You" : esc(u.name)}${isFav(state.me, u.id) ? ' <span class="fav-star" title="Favorite">★</span>' : ""}</span><span class="time">${ago(p.at)}</span></div>
          <div class="post-where">${(p.history || []).map((h, i) =>
            `<button class="was" data-was="${i}" aria-expanded="false" title="Earlier pick">${esc(BAR_BY_ID[h.barId].name)}</button><span class="arrow">→</span>`).join("")}<b data-bar="${b.id}">${esc(b.name)}</b> · ~${fmtTime(p.arrive)}</div>
          <div class="was-box hidden"></div>
        </div></div>
      ${p.comment ? `<div class="post-text">${esc(p.comment)}</div>` : ""}
      ${opts.replies ? replyBar(p) : ""}
      <div class="post-meter">${meter(p.excitement)}</div>`;
  }
  function postDetails(p) {
    return `${meter(p.excitement)}
      <div class="meta-row">${p.arrive ? `<span class="arrive">Arriving ~${fmtTime(p.arrive)}</span>` : ""}</div>
      ${p.comment ? `<div class="comment">${esc(p.comment)}</div>` : ""}`;
  }

  function renderFeed() {
    const el = $("#tab-feed");
    const mine = myPost();
    const posts = visiblePosts().filter((p) => p.userId !== state.me);
    const posted = new Set(posts.map((p) => p.userId));
    const quiet = [...friendIds(state.me)].filter((id) => !posted.has(id)).map(user);

    let html = "";
    if (mine) {
      const b = BAR_BY_ID[mine.barId];
      html += `<div class="card mine">
        <div class="label">Your post tonight</div>
        ${postBody(mine, { replies: true })}
        <div class="mine-actions"><button class="btn small" id="editMine">Change tonight's post</button></div>
      </div>`;
    } else {
      html += `<div class="card mine">
        <div class="label">Tonight</div>
        <div class="bar">What's the word?</div>
        <div class="sub small">Where are you headed tonight? One post a night. Your friends see it in their feed and on the map.</div>
        <button class="btn primary" id="startPost">Post where I'm headed</button>
      </div>`;
    }

    html += `<h2>Friends tonight · ${posts.length}</h2>`;
    if (!posts.length) {
      html += friendIds(state.me).size
        ? `<div class="empty">None of your friends have posted yet tonight.</div>`
        : `<div class="empty">Add some friends to see where they're headed.<br><br><button class="btn small" data-goto="friends">Find friends</button></div>`;
    } else {
      html += `<div class="stack">` + posts.map((p) => {
        const u = user(p.userId), b = BAR_BY_ID[p.barId];
        return `<div class="card post" data-thread="${pid(p)}">${postBody(p, { replies: true })}</div>`;
      }).join("") + `</div>`;
    }

    if (quiet.length) {
      html += `<h2>Haven't posted yet</h2><div class="waiting">` +
        quiet.map((u) => `<div class="w">${esc(u.name)}</div>`).join("") + `</div>`;
    }
    el.innerHTML = html;

    const s = $("#startPost", el); if (s) s.onclick = () => openComposer();
    const e = $("#editMine", el); if (e) e.onclick = () => openComposer();
    el.querySelectorAll("[data-bar]").forEach((n) => n.onclick = (ev) => { ev.stopPropagation(); showTab("map"); focusBar(n.dataset.bar); });
    el.querySelectorAll("[data-goto]").forEach((n) => n.onclick = () => showTab(n.dataset.goto));
    el.querySelectorAll("[data-thread]").forEach((n) => n.onclick = (ev) => { ev.stopPropagation(); openThread(n.dataset.thread); });
  }

  // ---------- sheet ----------
  function openSheet(html) {
    $("#sheet").innerHTML = `<div class="grabber"></div>` + html;
    $("#sheet").classList.remove("hidden");
    $("#sheetBackdrop").classList.remove("hidden");
  }
  function closeSheet() {
    $("#sheet").classList.add("hidden");
    $("#sheetBackdrop").classList.add("hidden");
  }
  $("#sheetBackdrop").addEventListener("click", closeSheet);

  // ---------- composer: pick bar -> excitement, arrival, comment ----------
  function openComposer(preselectBarId) {
    const existing = myPost();
    const draft = {
      barId: preselectBarId || (existing && existing.barId) || null,
      excitement: existing ? existing.excitement : 60,
      arrive: existing ? existing.arrive : "22:00",
      comment: existing ? existing.comment : "",
    };
    draft.barId ? renderDetails(draft) : renderPick(draft);
  }

  function friendCountsByBar() {
    const counts = {};
    for (const p of visiblePosts()) if (p.userId !== state.me) counts[p.barId] = (counts[p.barId] || 0) + 1;
    return counts;
  }

  function renderPick(draft) {
    openSheet(`
      <h3>What's the word?</h3>
      <div class="sub">Most popular bars first</div>
      <input class="search" id="barSearch" placeholder="Search bars" autocomplete="off" />
      <div class="barlist" id="barList"></div>`);
    const counts = friendCountsByBar();
    const { ranked, rank, month } = popularity();
    const list = $("#barList"), input = $("#barSearch");
    function draw() {
      const q = input.value.trim().toLowerCase();
      const rows = ranked.filter((b) => !q || b.name.toLowerCase().includes(q) || b.addr.toLowerCase().includes(q)).slice(0, 60);
      list.innerHTML = rows.length ? rows.map((b) => `
        <button class="baropt" data-id="${b.id}">
          <span class="rank ${rank[b.id] && rank[b.id] <= 3 ? "top" : ""}">${rank[b.id] || ""}</span>
          <span class="info"><div class="n">${esc(b.name)}</div>
            <div class="a">${month[b.id] ? `${month[b.id]} rolls this month` : esc(b.addr || b.type)}</div></span>
          ${counts[b.id] ? `<span class="f">${counts[b.id]} friend${counts[b.id] > 1 ? "s" : ""} tonight</span>` : ""}
        </button>`).join("") : `<div class="empty">No bars match "${esc(q)}"</div>`;
      list.querySelectorAll(".baropt").forEach((n) => n.onclick = () => { draft.barId = n.dataset.id; renderDetails(draft); });
    }
    input.addEventListener("input", draw);
    draw();
  }

  function renderDetails(draft) {
    const b = BAR_BY_ID[draft.barId];
    openSheet(`
      <h3>How's tonight looking?</h3>
      <div class="picked"><span><div class="n">${esc(b.name)}</div><div class="sub small">${esc(b.addr || b.type)}</div></span>
        <button class="btn small" id="changeBar">Change</button></div>

      <label class="field-label" for="arrive">Getting there around</label>
      <select id="arrive" class="select">${TIMES.map((t) => `<option value="${t}" ${t === draft.arrive ? "selected" : ""}>${fmtTime(t)}</option>`).join("")}</select>

      <label class="field-label" for="comment">What's the move?</label>
      <textarea class="comment" id="comment" placeholder="Pregame plans, a birthday, a drink special… give your friends a reason to pull up.">${esc(draft.comment || "")}</textarea>
      <div class="small counter" id="cc"></div>

      <label class="field-label" for="hype">How excited are you?</label>
      <div class="hype">
        <input type="range" id="hype" min="0" max="100" step="1" value="${draft.excitement}" />
        <div class="hype-ends"><span>Low</span><b id="hypeLabel"></b><span>High</span></div>
      </div>

      <div class="sheet-actions">
        <button class="btn" id="cancel">Cancel</button>
        <button class="btn primary" id="submit">${myPost() ? "Update post" : "Post"}</button>
      </div>`);
    $("#changeBar").onclick = () => renderPick(draft);
    $("#cancel").onclick = closeSheet;

    const hype = $("#hype"), hl = $("#hypeLabel");
    const updHype = () => {
      draft.excitement = +hype.value;
      hl.textContent = hypeLabel(draft.excitement);
      hype.style.setProperty("--fill", draft.excitement + "%");
    };
    hype.addEventListener("input", updHype); updHype();
    $("#arrive").onchange = (e) => { draft.arrive = e.target.value; };

    const ta = $("#comment"), cc = $("#cc");
    const updComment = () => {
      if (wordCount(ta.value) > COMMENT_WORDS) ta.value = limitWords(ta.value, COMMENT_WORDS);
      draft.comment = ta.value;
      const n = wordCount(ta.value);
      cc.textContent = n + "/" + COMMENT_WORDS + " words";
      cc.classList.toggle("full", n >= COMMENT_WORDS);
    };
    ta.addEventListener("input", updComment); updComment();

    $("#submit").onclick = () => {
      // One post per night: changing it keeps the same post (and its replies).
      const prev = myPost();
      state.posts = state.posts.filter((p) => !(p.userId === state.me && nightKey(p.at) === tonight()));
      const post = { id: prev ? prev.id : uuid(), userId: state.me, night: tonight(), barId: draft.barId, at: Date.now(), excitement: draft.excitement, arrive: draft.arrive, comment: draft.comment.trim() };
      // Switching bars keeps the old pick, so the feed can show the whole saga.
      const history = prev ? (prev.history || []).slice() : [];
      if (prev && prev.barId !== post.barId) history.push({ barId: prev.barId, at: prev.at, excitement: prev.excitement, arrive: prev.arrive, comment: prev.comment || "" });
      post.history = history;
      state.posts.push(post);
      persist(() => API.savePost(post), "Couldn't save your post. Check your connection and try again.");
      closeSheet();
      toast("You're headed to " + b.name);
      render();
    };
  }

  // ---------- map ----------
  let map, barLayer, countLayer, showSpots = true, fittedFor = null;

  // How often my friends have been to each bar (before tonight), recency-weighted.
  function friendSpots() {
    const f = friendIds(state.me), now = Date.now(), score = {}, count = {};
    for (const p of state.posts) {
      if (!f.has(p.userId) || nightKey(p.at) === tonight()) continue;
      score[p.barId] = (score[p.barId] || 0) + Math.pow(0.5, (now - p.at) / DAY / 21);
      count[p.barId] = (count[p.barId] || 0) + 1;
    }
    return { score, count };
  }
  function initMap() {
    if (map) return;
    map = L.map("map", { zoomControl: false }).setView(CAMPUS, 15);
    // Esri light gray basemap: free, no API key, attribution required.
    const esri = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/";
    const attribution = 'Tiles &copy; Esri &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors | Bars: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
    L.tileLayer(esri + "World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19, maxNativeZoom: 16, attribution }).addTo(map);
    L.tileLayer(esri + "World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19, maxNativeZoom: 16 }).addTo(map);
    barLayer = L.layerGroup().addTo(map);
    countLayer = L.layerGroup().addTo(map);
  }

  function goersByBar() {
    const by = {};
    for (const p of visiblePosts()) (by[p.barId] = by[p.barId] || []).push(p);
    return by;
  }

  // Map color scale, 0 to 1: pale red, then Badger red, then deep red.
  const HEAT = [[243, 185, 187], [197, 5, 12], [122, 0, 6]];
  function heat(t) {
    t = Math.max(0, Math.min(1, t));
    const [a, b, k] = t < 0.6 ? [HEAT[0], HEAT[1], t / 0.6] : [HEAT[1], HEAT[2], (t - 0.6) / 0.4];
    return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * k)).join(",")})`;
  }

  function renderMap() {
    initMap();
    barLayer.clearLayers();
    countLayer.clearLayers();
    const by = goersByBar();
    const mine = myPost();

    // Friends' spots: every bar your friends have been to before. The more
    // (and more recently) they go, the deeper the red and the slightly bigger
    // the dot (Sam, 2026-11-18: color does most of the work so no dot gets
    // huge). Bars they've never picked aren't shown at all.
    // Starter bars (Sam, 2026-11-18) are always on the map, palest red until
    // friends' history makes them deeper, so a brand-new account isn't empty.
    {
      const { score } = showSpots ? friendSpots() : { score: {} };
      const max = Math.max(1, ...Object.values(score));
      for (const id of STARTER_BARS) if (BAR_BY_ID[id] && !(id in score)) score[id] = 0;
      for (const [barId, sc] of Object.entries(score)) {
        if (by[barId]) continue;
        const b = BAR_BY_ID[barId], t = sc / max;
        const d = Math.round(10 + 14 * t); // 5 to 12px radius
        L.marker([b.lat, b.lon], { icon: L.divIcon({ className: "", html: `<div class="spot" style="width:${d}px;height:${d}px;background:${heat(t)}"></div>`, iconSize: [d, d], iconAnchor: [d / 2, d / 2] }), zIndexOffset: d })
          .on("click", () => openBar(barId)).addTo(barLayer);
      }
    }
    // Tonight: same color scale, by how many friends are going.
    const maxHere = Math.max(1, ...Object.values(by).map((ps) => ps.filter((p) => p.userId !== state.me).length));
    for (const [barId, posts] of Object.entries(by)) {
      const b = BAR_BY_ID[barId];
      const isMine = mine && mine.barId === barId;
      const friendsHere = posts.filter((p) => p.userId !== state.me).length;
      const label = friendsHere ? friendsHere : "You";
      const t = friendsHere / maxHere, d = friendsHere ? Math.round(24 + 8 * t) : 30;
      L.marker([b.lat, b.lon], {
        icon: L.divIcon({ className: "", html: `<div class="count-marker ${isMine ? "me" : ""} ${friendsHere ? "" : "only-me"}" style="width:${d}px;height:${d}px;${friendsHere ? `background:${heat(0.35 + 0.65 * t)}` : ""}">${label}</div>`, iconSize: [d, d], iconAnchor: [d / 2, d / 2] }),
        zIndexOffset: 1000 + friendsHere,
      }).on("click", () => openBar(barId)).addTo(countLayer);
    }

    // First time the map opens for a person, frame everyone who's out tonight.
    if (fittedFor !== state.me) {
      fittedFor = state.me;
      const pts = Object.keys(by).map((id) => [BAR_BY_ID[id].lat, BAR_BY_ID[id].lon]);
      if (pts.length > 1) map.fitBounds(pts, { padding: [60, 60], maxZoom: 16 });
      else if (pts.length === 1) map.setView(pts[0], 16);
    }

    const totalFriends = visiblePosts().filter((p) => p.userId !== state.me).length;
    const barsCount = Object.keys(by).filter((id) => by[id].some((p) => p.userId !== state.me)).length;
    $("#mapLegend").innerHTML = `
      <div class="legend-left">
        <div class="pill"><b>${totalFriends}</b> friend${totalFriends === 1 ? "" : "s"} out at <b>${barsCount}</b> bar${barsCount === 1 ? "" : "s"}</div>
        <div class="heat-key">Less <span class="ramp"></span> More</div>
      </div>
      <label class="pill toggle"><input type="checkbox" id="allBars" ${showSpots ? "checked" : ""}/> Friends' spots</label>`;
    $("#allBars").onchange = (e) => { showSpots = e.target.checked; renderMap(); };
  }

  function focusBar(barId) {
    const b = BAR_BY_ID[barId];
    map.setView([b.lat, b.lon], 17);
    openBar(barId);
  }

  // Tap a bar on the map: who's going, how hyped, and when they'll get there.
  function openBar(barId) {
    const b = BAR_BY_ID[barId];
    const posts = (goersByBar()[barId] || []).slice().sort((x, y) => timeKey(x.arrive) - timeKey(y.arrive));
    const avg = posts.length ? Math.round(posts.reduce((a, p) => a + p.excitement, 0) / posts.length) : null;
    const mine = myPost();
    openSheet(`
      <h3>${esc(b.name)}</h3>
      <div class="sub">${esc(b.addr || b.type)}${posts.length ? ` · ${posts.length} going tonight` : ""}</div>
      ${posts.length ? `<div class="goer-names">${esc(nameList(posts.map((p) => p.userId === state.me ? "You" : user(p.userId).name)))}</div>` : ""}
      ${friendSpots().count[barId] ? `<div class="spot-note">Your friends have been here ${friendSpots().count[barId]} time${friendSpots().count[barId] > 1 ? "s" : ""} before</div>` : ""}
      ${avg !== null ? `<div class="field-label">Group excitement</div>${meter(avg)}` : ""}
      <div class="goers">${posts.length ? posts.map((p) => {
        const u = user(p.userId);
        return `<div class="g"><div class="g-body">
          <div><b>${u.id === state.me ? "You" : esc(u.name)}</b> <span class="sub small">· ~${fmtTime(p.arrive)}</span></div>
          ${meter(p.excitement, true)}
          ${p.comment ? `<div class="small g-comment">${esc(p.comment)}</div>` : ""}
        </div></div>`;
      }).join("") : `<div class="empty" style="padding:14px">No friends here yet tonight.</div>`}</div>
      <div class="sheet-actions">
        <button class="btn" id="closeBar">Close</button>
        ${mine && mine.barId === barId ? "" : `<button class="btn primary" id="rollHere">I'm headed here</button>`}
      </div>`);
    $("#closeBar").onclick = closeSheet;
    const r = $("#rollHere"); if (r) r.onclick = () => openComposer(barId);
  }

  // ---------- friends: request and accept ----------
  function renderFriends() {
    const el = $("#tab-friends");
    const f = friendIds(state.me);
    const inc = incoming(), out = outgoing();
    const sentTo = new Set(out.map((r) => r.to)), gotFrom = new Set(inc.map((r) => r.from));
    const friends = [...f].map(user).sort((a, b) => isFav(state.me, b.id) - isFav(state.me, a.id) || a.name.localeCompare(b.name));
    const others = state.users.filter((u) => u.id !== state.me && !f.has(u.id) && !gotFrom.has(u.id));
    const mutuals = (uid) => [...friendIds(uid)].filter((x) => f.has(x)).length;
    const person = (u, sub, actions) => `
      <div class="person" data-name="${esc((u.name + " " + u.handle).toLowerCase())}">
        <div class="meta"><div class="n">${esc(u.name)}</div><div class="h">@${esc(u.handle)}${sub ? " · " + sub : ""}</div></div>
        <div class="actions">${actions}</div></div>`;

    const q = friendQuery.trim().toLowerCase().replace(/^@/, "");
    const friendRow = (u) => person(u, isFav(state.me, u.id) ? "Favorite" : "",
      `${starBtn(u.id)}<button class="btn small ghost" data-remove="${u.id}">Remove</button>`);
    const otherRow = (u) => person(u, mutuals(u.id) ? mutuals(u.id) + " mutual" : "",
      sentTo.has(u.id)
        ? `<button class="btn small" data-cancel="${u.id}">Requested</button>`
        : `<button class="btn small primary" data-request="${u.id}">Add friend</button>`);
    const reqRow = (r) => person(user(r.from), ago(r.at),
      `<button class="btn small" data-decline="${r.from}">Decline</button><button class="btn small primary" data-accept="${r.from}">Accept</button>`);

    let body;
    if (q) {
      // One results list: your friends first, then requests, then everyone else.
      const hit = (u) => (u.name + " " + u.handle).toLowerCase().includes(q);
      const rows = [
        ...friends.filter(hit).map(friendRow),
        ...inc.filter((r) => hit(user(r.from))).map(reqRow),
        ...others.filter(hit).map(otherRow),
      ];
      body = `<h2>Results · ${rows.length}</h2>
        <div class="card list">${rows.length ? rows.join("") : `<div class="sub small">Nobody matches "${esc(friendQuery)}".</div>`}</div>`;
    } else {
      body = `
      ${inc.length ? `<h2>Friend requests · ${inc.length}</h2><div class="card list">${inc.map(reqRow).join("")}</div>` : ""}
      <h2>Your friends · ${friends.length}</h2>
      <div class="card list">${friends.length ? friends.map(friendRow).join("") : `<div class="sub small">No friends yet. Add some below.</div>`}</div>
      ${others.length ? `<h2>People you may know</h2><div class="card list">${others.map(otherRow).join("")}</div>` : ""}
      <div class="sub small" style="margin-top:14px">Star a friend to make them a favorite. You can get notified when favorites post (see Settings).</div>`;
    }

    if (!$("#friendSearch", el)) {
      el.innerHTML = `<input class="search" id="friendSearch" placeholder="Search friends and people" autocomplete="off" />
        <div id="friendsBody"></div>`;
      $("#friendSearch", el).addEventListener("input", (e) => { friendQuery = e.target.value; renderFriends(); });
    }
    const bodyEl = $("#friendsBody", el);
    bodyEl.innerHTML = body;

    const on = (attr, fn) => bodyEl.querySelectorAll(`[data-${attr}]`).forEach((b) => b.onclick = () => fn(b.dataset[attr]));
    on("request", (id) => {
      state.requests.push({ from: state.me, to: id, at: Date.now() });
      persist(() => API.sendRequest(id)); toast("Request sent to " + user(id).name); render(); });
    on("cancel", (id) => {
      state.requests = state.requests.filter((r) => !(r.from === state.me && r.to === id));
      persist(() => API.deleteRequest(state.me, id)); toast("Request canceled"); render(); });
    on("accept", async (id) => {
      state.requests = state.requests.filter((r) => !((r.from === id && r.to === state.me) || (r.from === state.me && r.to === id)));
      state.friendships.push([state.me, id, { by: id, at: Date.now() }]);
      toast("You and " + user(id).name + " are now friends"); render();
      // Their posts only come through once the database knows you're friends.
      if (await persist(() => API.accept(id)) && LIVE) refresh();
    });
    on("decline", (id) => {
      state.requests = state.requests.filter((r) => !(r.from === id && r.to === state.me));
      persist(() => API.deleteRequest(id, state.me)); render(); });
    on("remove", (id) => {
      if (!confirmRemove(id)) return;
      state.friendships = state.friendships.filter(([x, y]) => !((x === state.me && y === id) || (y === state.me && x === id)));
      setFav(state.me, id, false); setFav(id, state.me, false);
      persist(() => API.unfriend(state.me, id)); render();
    });
    bindStars(bodyEl);
  }
  let friendQuery = "";
  // Removing a friend is a real change for both people, so double-check (live only).
  function confirmRemove(id) {
    return !LIVE || window.confirm("Remove " + user(id).name + " as a friend? You'll stop seeing each other's posts.");
  }

  // ---------- replies ----------
  // Replies point at the post's id, which stays the same when someone changes
  // tonight's post.
  const pid = (p) => p.id;
  const findPost = (id) => state.posts.find((p) => p.id === id);
  const repliesFor = (id) => state.replies.filter((r) => r.post === id).sort((a, b) => a.at - b.at);

  function replyBar(p) {
    const rs = repliesFor(pid(p));
    const last = rs[rs.length - 1];
    return `<div class="reply-bar">
      <button class="reply-btn" data-thread="${pid(p)}" aria-label="Reply">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H9l-5 4v-4H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z"/></svg>
        <span>${rs.length || "Reply"}</span></button>
      ${last ? `<span class="reply-peek"><b>${esc(user(last.userId).name)}</b> ${esc(last.text)}</span>` : ""}
    </div>`;
  }

  // The post plus its replies, like a tweet's thread.
  // Replies open as their own page (Sam, 2026-11-18): "‹ Feed" back link, the
  // post on top with a bigger comment, the replies, and a reply box pinned to
  // the bottom. The Feed tab stays highlighted while it's open.
  let threadId = null, threadFlash = false;
  function threadPost(id) {
    const p = findPost(id);
    return p && nightKey(p.at) === tonight() ? p : null;
  }
  function openThread(id, opts = {}) {
    const p = threadPost(id);
    closeSheet();
    if (!p) { toast("That post is from an earlier night"); return; }
    const canSee = p.userId === state.me || friendIds(state.me).has(p.userId);
    if (!canSee) { toast("Only friends can see that post"); return; }
    threadId = pid(p); threadFlash = !!opts.highlight;
    showTab("thread");
    $("#tab-thread").scrollTop = 0;
  }
  function renderThread() {
    const el = $("#tab-thread");
    const old = $("#replyText", el), draft = old && old.dataset.post === threadId ? old.value : "";
    const p = threadId && threadPost(threadId);
    const canSee = p && (p.userId === state.me || friendIds(state.me).has(p.userId));
    if (!canSee) {
      el.innerHTML = `<button class="back-link" id="threadBack">‹ Feed</button><div class="empty">This post isn't available anymore.</div>`;
      $("#threadBack").onclick = () => showTab("feed");
      return;
    }
    threadId = pid(p);
    const u = user(p.userId), rs = repliesFor(threadId);
    el.innerHTML = `
      <div class="thread-page">
        <button class="back-link" id="threadBack">‹ Feed</button>
        <div class="thread-post ${threadFlash ? "flash" : ""}" data-post="${threadId}">${postBody(p)}</div>
        <h2>${rs.length} ${rs.length === 1 ? "reply" : "replies"}</h2>
        <div class="replies">${rs.map((r) => `<div class="reply"><div class="reply-body">
            <div class="reply-head"><b>${r.userId === state.me ? "You" : esc(user(r.userId).name)}</b><span class="sub small">${ago(r.at)}</span></div>
            <div class="reply-text">${esc(r.text)}</div></div></div>`).join("")
          || `<div class="sub small">No replies yet. Start the conversation.</div>`}</div>
      </div>
      <div class="reply-compose">
        <textarea class="comment" id="replyText" data-post="${threadId}" rows="2" placeholder="Reply to ${u.id === state.me ? "your friends" : esc(u.name)}…"></textarea>
        <div class="reply-compose-row"><span class="small counter" id="replyCount">0/${COMMENT_WORDS} words</span>
          <button class="btn primary small" id="sendReply" disabled>Reply</button></div>
      </div>`;
    threadFlash = false;
    $("#threadBack").onclick = () => showTab("feed");
    el.querySelectorAll("[data-bar]").forEach((n) => n.onclick = () => { showTab("map"); focusBar(n.dataset.bar); });
    const ta = $("#replyText"), cnt = $("#replyCount"), send = $("#sendReply");
    const sync = () => {
      if (wordCount(ta.value) > COMMENT_WORDS) ta.value = limitWords(ta.value, COMMENT_WORDS);
      const n = wordCount(ta.value);
      cnt.textContent = n + "/" + COMMENT_WORDS + " words";
      cnt.classList.toggle("full", n >= COMMENT_WORDS);
      send.disabled = !n;
    };
    ta.value = draft; sync();
    ta.addEventListener("input", sync);
    send.onclick = () => {
      const text = ta.value.trim();
      if (!text) return;
      // The post's owner and anyone else in the thread see it in their alerts.
      const reply = { id: uuid(), post: pid(p), userId: state.me, text, at: Date.now() };
      state.replies.push(reply);
      persist(() => API.addReply(reply), "Couldn't send your reply. Check your connection and try again.");
      ta.value = "";
      render();
      el.scrollTop = el.scrollHeight;
    };
  }

  // ---------- favorites ----------
  const isFav = (owner, id) => ((state.favorites[owner] || []).includes(id) ? 1 : 0);
  function setFav(owner, id, on) {
    const list = new Set(state.favorites[owner] || []);
    on ? list.add(id) : list.delete(id);
    state.favorites[owner] = [...list];
  }
  const starBtn = (id) => `<button class="star ${isFav(state.me, id) ? "on" : ""}" data-star="${id}"
    aria-label="${isFav(state.me, id) ? "Remove from favorites" : "Add to favorites"}" aria-pressed="${!!isFav(state.me, id)}">★</button>`;
  function bindStars(root) {
    root.querySelectorAll("[data-star]").forEach((b) => b.onclick = () => {
      const id = b.dataset.star, on = !isFav(state.me, id);
      setFav(state.me, id, on); persist(() => API.setFavorite(id, on));
      toast(on ? user(id).name + " is a favorite" : user(id).name + " removed from favorites");
      render();
    });
  }

  // ---------- notification settings ----------
  const DEFAULT_SETTINGS = {
    favPosts: true,        // a favorite posts where they're headed
    anyPosts: false,       // any friend posts
    barCrowd: true,        // a bar hits N or more of my friends tonight
    crowdSize: 3,
    sameBar: true,         // a friend picks the bar I already picked
    switched: true,        // a friend changes tonight's bar
    hyped: false,          // a friend maxes out the excitement meter
    requests: true,        // friend requests and accepts
    replies: true,         // replies to my post or a thread I'm in
    reminder: false,       // nudge me to post if I haven't yet
    reminderTime: "20:00",
    browser: false,        // also show browser notifications
  };
  function settingsFor(uid) {
    state.settings[uid] = Object.assign({}, DEFAULT_SETTINGS, state.settings[uid] || {});
    return state.settings[uid];
  }

  // ---------- notifications ----------
  // Alerts are worked out from what you can already see (friends' posts tonight,
  // replies, friend requests), filtered by your own settings. Nothing is sent
  // between people, so nobody else needs to know your settings or favorites.
  // "Read" means older than the last time you opened the bell.
  // (Real push alerts to a locked phone come with the iPhone app.)
  function myNotes() {
    const me = state.me, s = settingsFor(me), f = friendIds(me), out = [];
    const seen = s.seenAt || 0, now = Date.now();
    const add = (kind, text, at, extra = {}) =>
      out.push({ kind, text, at, barId: extra.barId || null, post: extra.post || null, read: at <= seen });
    const barName = (id) => (BAR_BY_ID[id] || { name: "a bar" }).name;

    const posts = tonightsPosts().filter((p) => BAR_BY_ID[p.barId]).sort((a, b) => a.at - b.at);
    const mine = myPost();
    const crowdTotal = {}, crowdSoFar = {};
    for (const p of posts) if (f.has(p.userId)) crowdTotal[p.barId] = (crowdTotal[p.barId] || 0) + 1;
    for (const p of posts) {
      if (!f.has(p.userId)) continue;
      const name = user(p.userId).name, bar = barName(p.barId);
      const base = { barId: p.barId, post: p.id };
      const hist = p.history || [], last = hist[hist.length - 1];
      const fav = isFav(me, p.userId);
      if (last && last.barId !== p.barId) {
        if (s.switched) add("switch", `${name} switched from ${barName(last.barId)} to ${bar}`, p.at, base);
      } else if (s.sameBar && mine && mine.barId === p.barId && mine.at < p.at) {
        add("same", `${name} is headed to ${bar} too`, p.at, base);
      } else if ((fav && s.favPosts) || s.anyPosts) {
        add(fav ? "fav" : "post", `${name} is headed to ${bar}, around ${fmtTime(p.arrive)}`, p.at, base);
      }
      if (s.hyped && p.excitement >= 95) add("hype", `${name} is ${hypeLabel(p.excitement).toLowerCase()} for ${bar} tonight`, p.at, base);
      crowdSoFar[p.barId] = (crowdSoFar[p.barId] || 0) + 1;
      if (s.barCrowd && crowdSoFar[p.barId] === s.crowdSize) {
        add("crowd", `${crowdTotal[p.barId]} of your friends are headed to ${bar} tonight`, p.at, { barId: p.barId });
      }
    }

    // Replies to my post, or to a post I replied to earlier.
    if (s.replies) {
      const replies = state.replies.slice().sort((a, b) => a.at - b.at);
      const joined = {};
      for (const r of replies) {
        const p = findPost(r.post);
        if (!p) continue;
        if (r.userId === me) { joined[r.post] = true; continue; }
        if (p.userId !== me && !joined[r.post]) continue;
        const what = p.userId === me ? "your post" : `${user(p.userId).name}'s post`;
        add("reply", `${user(r.userId).name} replied to ${what}: "${r.text.length > 60 ? r.text.slice(0, 57) + "…" : r.text}"`, r.at, { post: p.id, barId: p.barId });
      }
    }

    if (s.requests) {
      for (const r of incoming()) add("request", `${user(r.from).name} sent you a friend request`, r.at);
      for (const [a, b, meta] of state.friendships) {
        if (!meta || meta.by !== me || now - meta.at > 14 * DAY) continue;
        add("accept", `${user(a === me ? b : a).name} accepted your friend request`, meta.at);
      }
    }

    // "Remind me to post": once a night after the chosen time, if I haven't posted.
    if (s.reminder && !mine) {
      const [y, m, d] = tonight().split("-").map(Number);
      const at = new Date(y, m - 1, d).getTime() + timeKey(s.reminderTime) * 60000;
      if (now >= at) add("reminder", "You haven't posted yet tonight. What's the word? Where are you headed?", at);
    }
    return out.sort((a, b) => b.at - a.at);
  }

  // Browser notifications (while the site is open): anything new since we last looked.
  let lastPing = Date.now();
  function pingNew() {
    const s = settingsFor(state.me), since = lastPing;
    lastPing = Date.now();
    if (!s.browser || !("Notification" in window) || Notification.permission !== "granted") return;
    for (const n of myNotes()) {
      if (n.read || n.at <= since) continue;
      try { new Notification("Word", { body: n.text }); } catch (e) {}
    }
  }

  function renderBell() {
    const n = myNotes().filter((x) => !x.read).length;
    const b = $("#bellBadge");
    b.textContent = n > 9 ? "9+" : n;
    b.classList.toggle("hidden", !n);
  }

  const NOTE_ICON = { reply: "💬", fav: "★", post: "🍻", same: "🤝", switch: "↪", crowd: "🔥", hype: "⚡", request: "👋", accept: "✓", reminder: "⏰" };
  function openInbox() {
    const notes = myNotes();
    openSheet(`
      <h3>Notifications</h3>
      <div class="sub">${notes.length ? "Tonight and recent" : ""}</div>
      <div class="notes">${notes.length ? notes.slice(0, 40).map((n) => `
        <button class="note ${n.read ? "" : "unread"}" ${n.post ? `data-post="${n.post}"` : n.barId ? `data-bar="${n.barId}"` : n.kind === "request" ? 'data-goto="friends"' : n.kind === "reminder" ? 'data-compose="1"' : ""}>
          <span class="note-ico">${NOTE_ICON[n.kind] || "•"}</span>
          <span class="note-body"><span>${esc(n.text)}</span><span class="sub small">${ago(n.at)}</span></span>
        </button>`).join("") : `<div class="empty">Nothing yet. Choose what you hear about in Settings.</div>`}</div>
      <div class="sheet-actions"><button class="btn" id="closeInbox">Close</button><button class="btn" id="inboxSettings">Settings</button></div>`);
    const s = settingsFor(state.me);
    s.seenAt = Date.now();
    persist(() => API.saveSettings(state.me, s)); renderBell();
    $("#closeInbox").onclick = closeSheet;
    $("#inboxSettings").onclick = () => { closeSheet(); showTab("settings"); };
    document.querySelectorAll(".note[data-bar]").forEach((x) => x.onclick = () => { closeSheet(); showTab("map"); focusBar(x.dataset.bar); });
    document.querySelectorAll(".note[data-goto]").forEach((x) => x.onclick = () => { closeSheet(); showTab(x.dataset.goto); });
    document.querySelectorAll(".note[data-post]").forEach((x) => x.onclick = () => openThread(x.dataset.post, { highlight: true }));
    document.querySelectorAll(".note[data-compose]").forEach((x) => x.onclick = () => openComposer());
  }
  $("#bellBtn").addEventListener("click", openInbox);
  $("#gearBtn").addEventListener("click", () => showTab("settings"));

  // ---------- settings ----------
  // Toggling several switches quickly sends one save, not one per tap.
  let settingsTimer;
  function saveSettings() {
    renderBell();
    if (!LIVE) return save();
    clearTimeout(settingsTimer);
    settingsTimer = setTimeout(() => persist(() => API.saveSettings(state.me, settingsFor(state.me))), 600);
  }
  function renderSettings() {
    const el = $("#tab-settings");
    const s = settingsFor(state.me);
    const friends = [...friendIds(state.me)].map(user).sort((a, b) => a.name.localeCompare(b.name));
    const favCount = friends.filter((u) => isFav(state.me, u.id)).length;
    const toggle = (key, title, desc, extra = "") => `
      <div class="setting">
        <div class="setting-text"><label for="set-${key}" class="setting-title">${title}</label><div class="sub small">${desc}</div>${extra}</div>
        <label class="switch"><input type="checkbox" id="set-${key}" data-set="${key}" ${s[key] ? "checked" : ""}/><span></span></label>
      </div>`;
    const browserState = !("Notification" in window) ? "This browser doesn't support notifications."
      : Notification.permission === "denied" ? "Blocked in your browser settings. Allow notifications for this site to turn this on."
      : "Shows alerts while Word is open in a tab. Real push alerts come with the iPhone app.";

    el.innerHTML = `
      <div class="page-head"><button class="btn small" id="settingsBack">‹ Back</button><h1>Settings</h1></div>

      <h2>Notify me when</h2>
      <div class="card settings">
        ${toggle("favPosts", "A favorite posts", `When one of your favorites posts where they're headed. ${favCount ? `You have ${favCount} favorite${favCount > 1 ? "s" : ""}.` : "Star friends below to pick favorites."}`)}
        ${toggle("anyPosts", "Any friend posts", "Every post from every friend. Can get busy on a Friday.")}
        ${toggle("barCrowd", "A bar fills up with friends", "Once a night per bar, when enough of your friends pick the same one.",
          `<div class="stepper" aria-label="How many friends"><button data-step="-1" aria-label="Fewer">−</button><b id="crowdSize">${s.crowdSize}</b><button data-step="1" aria-label="More">＋</button><span class="sub small">or more friends</span></div>`)}
        ${toggle("sameBar", "A friend picks my bar", "When someone posts the same bar you already posted tonight.")}
        ${toggle("switched", "A friend switches bars", "When a friend changes tonight's post to a different bar.")}
        ${toggle("hyped", "A friend is sending it", "When a friend maxes out the excitement meter.")}
        ${toggle("replies", "Replies", "When someone replies to your post, or to a post you replied to.")}
        ${toggle("requests", "Friend requests", "When someone sends you a request or accepts yours.")}
        ${toggle("reminder", "Remind me to post", "Once a night, if you haven't posted by", `<select class="select inline" id="reminderTime">${TIMES.filter((t) => timeKey(t) <= timeKey("23:00")).map((t) => `<option value="${t}" ${t === s.reminderTime ? "selected" : ""}>${fmtTime(t)}</option>`).join("")}</select>`)}
      </div>

      <h2>Favorites</h2>
      <div class="card list">${friends.length ? friends.map((u) => `
        <div class="person"><div class="meta"><div class="n">${esc(u.name)}</div></div><div class="actions">${starBtn(u.id)}</div></div>`).join("")
        : `<div class="sub small">Add friends first, then star your favorites here.</div>`}</div>

      <h2>How you get them</h2>
      <div class="card settings">
        <div class="setting"><div class="setting-text"><div class="setting-title">In the app</div><div class="sub small">Always on. Tap the bell at the top.</div></div></div>
        ${toggle("browser", "Browser notifications", browserState)}
      </div>

      <h2>Help</h2>
      <div class="card settings">
        <div class="setting"><div class="setting-text"><div class="setting-title">Found a bug?</div>
          <div class="sub small">Tell us what went wrong. It goes straight to Sam.</div></div>
          <button class="btn small primary" id="reportBug">Report a bug</button></div>
      </div>

      ${LIVE ? `
      <h2>Account</h2>
      <div class="sub small" style="margin-bottom:10px">Signed in as ${esc(account.email || "")}</div>
      <button class="btn small" id="signOut2">Sign out</button>` : `
      <h2>Demo</h2>
      <div class="sub small" style="margin-bottom:10px">This copy isn't connected to a database. Use "Viewing as" on the Profile tab to be someone else; each person has their own settings and notifications. Everything is saved in this browser only.</div>
      <button class="btn small" id="resetDemo">Reset demo data</button>`}`;

    el.querySelectorAll("[data-set]").forEach((inp) => inp.onchange = async () => {
      const key = inp.dataset.set;
      if (key === "browser" && inp.checked) {
        if (!("Notification" in window)) { inp.checked = false; return; }
        const perm = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
        if (perm !== "granted") { inp.checked = false; toast("Notifications aren't allowed in this browser"); renderSettings(); return; }
      }
      s[key] = inp.checked; saveSettings();
    });
    el.querySelectorAll("[data-step]").forEach((b) => b.onclick = () => {
      s.crowdSize = Math.min(8, Math.max(2, s.crowdSize + +b.dataset.step)); saveSettings();
      $("#crowdSize").textContent = s.crowdSize;
    });
    $("#reminderTime").onchange = (e) => { s.reminderTime = e.target.value; saveSettings(); };
    $("#settingsBack").onclick = () => showTab("feed");
    bindStars(el);
    $("#reportBug", el).onclick = openBugReport;
    if (LIVE) { $("#signOut2", el).onclick = signOut; return; }
    $("#resetDemo", el).onclick = () => {
      state = window.ROLLING_SEED();
      state.favorites = { u_sam: ["u_jake", "u_maddie"] }; state.settings = {}; state.seen = {};
      save(); location.reload();
    };
  }

  // ---------- report a bug ----------
  // Saved to the bug_reports table in Supabase with who sent it, when, which
  // screen they were on and their browser/device. Only Sam can read them, in the
  // Supabase Table Editor.
  function openBugReport() {
    const screenName = { feed: "Feed", map: "Map", friends: "Friends", profile: "Profile", thread: "Replies", settings: "Settings" }[lastTab] || lastTab;
    openSheet(`<h3>Report a bug</h3><div class="sub">Thanks for testing Word. Every report helps.</div>
      <label class="field-label" for="bugWhat">What went wrong?</label>
      <textarea class="comment" id="bugWhat" maxlength="2000" placeholder="e.g. I tapped Post and nothing happened"></textarea>
      <label class="field-label" for="bugSteps">What were you doing right before? (optional)</label>
      <textarea class="comment" id="bugSteps" maxlength="2000" placeholder="e.g. Changed my bar from Chasers to KK, then hit Update"></textarea>
      <label class="field-label" for="bugScreen">Where in the app?</label>
      <select class="select" id="bugScreen">${["Feed", "Map", "Friends", "Profile", "Replies", "Notifications", "Settings", "Sign in / sign up", "Somewhere else"]
        .map((n) => `<option ${n === screenName ? "selected" : ""}>${n}</option>`).join("")}</select>
      <div class="small counter" id="bugErr"></div>
      <div class="sheet-actions"><button class="btn" id="bugCancel">Cancel</button><button class="btn primary" id="bugSend">Send report</button></div>`);
    $("#bugCancel").onclick = closeSheet;
    $("#bugWhat").oninput = () => { $("#bugErr").textContent = ""; };
    $("#bugSend").onclick = async () => {
      const what = $("#bugWhat").value.trim();
      if (!what) { $("#bugErr").textContent = "Describe what went wrong first."; return; }
      if (!LIVE) { closeSheet(); toast("Demo mode: bug reports are only saved on the live site"); return; }
      const report = {
        what, steps: $("#bugSteps").value.trim(), screen: $("#bugScreen").value,
        device: `${navigator.userAgent} | screen ${screen.width}x${screen.height} | window ${innerWidth}x${innerHeight}`,
        page: location.href.split("#")[0],
      };
      $("#bugSend").disabled = true;
      try { await API.reportBug(report); } catch (e) {
        console.error(e);
        $("#bugSend").disabled = false;
        $("#bugErr").textContent = "Couldn't send it. Check your connection and try again.";
        return;
      }
      closeSheet(); toast("Thanks! Your report was sent.");
    };
    setTimeout(() => $("#bugWhat").focus(), 50);
  }

  // ---------- profile ----------
  // First version, kept simple on purpose: who you are, a few counts, your usual spots.
  function renderProfile() {
    const el = $("#tab-profile");
    const me = user(state.me);
    const mine = state.posts.filter((p) => p.userId === state.me);
    const nights = new Set(mine.map((p) => nightKey(p.at))).size;
    const counts = {};
    for (const p of mine) {
      counts[p.barId] = (counts[p.barId] || 0) + 1;
      for (const h of p.history || []) counts[h.barId] = (counts[h.barId] || 0) + 1;
    }
    const switches = mine.reduce((a, p) => a + (p.history || []).length, 0);
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 3);
    el.innerHTML = `
      <div class="profile-head">
        <div class="profile-name">${esc(me.name)}</div>
        <div class="sub">@${esc(me.handle)}</div>
        <button class="btn small" id="editProfile">Edit profile</button>
      </div>
      ${LIVE ? "" : `<label class="viewas card" title="Demo only: pick which sample user you are">
        <span>Demo: viewing as</span><select id="viewAs"></select>
      </label>`}
      <div class="card stats">
        <div><b>${nights}</b><span>nights out</span></div>
        <div><b>${Object.keys(counts).length}</b><span>bars</span></div>
        <div><b>${switches}</b><span>switches</span></div>
      </div>
      <h2>Your usual spots</h2>
      <div class="card list">${top.length ? top.map(([id, n], i) => `
        <button class="spot-row" data-bar="${id}"><span class="rank top">${i + 1}</span>
          <span class="info"><div class="n">${esc(BAR_BY_ID[id].name)}</div><div class="sub small">${n} night${n > 1 ? "s" : ""}</div></span></button>`).join("")
        : `<div class="sub small">Post where you're headed and your favorite bars show up here.</div>`}</div>
      ${LIVE ? `<div class="account-row"><span class="sub small">${esc(account.email || "")}</span><button class="btn small ghost" id="signOut">Sign out</button></div>` : ""}`;
    renderViewAs();
    if (LIVE) $("#signOut").onclick = signOut;
    el.querySelectorAll("[data-bar]").forEach((n) => n.onclick = () => { showTab("map"); focusBar(n.dataset.bar); });
    $("#editProfile").onclick = () => {
      openSheet(`<h3>Edit profile</h3><div class="sub">Your friends see this.</div>
        <label class="field-label" for="pfName">Name</label><input class="search" id="pfName" maxlength="30" value="${esc(me.name)}" />
        <label class="field-label" for="pfHandle">Handle</label><input class="search" id="pfHandle" maxlength="20" value="${esc(me.handle)}" />
        <div class="small counter" id="pfErr"></div>
        <div class="sheet-actions"><button class="btn" id="pfCancel">Cancel</button><button class="btn primary" id="pfSave">Save</button></div>`);
      $("#pfCancel").onclick = closeSheet;
      $("#pfSave").onclick = async () => {
        const name = $("#pfName").value.trim(), handle = $("#pfHandle").value.trim().replace(/^@/, "").toLowerCase();
        if (!name || !/^[a-z0-9_.]{2,20}$/.test(handle)) { $("#pfErr").textContent = "Add a name, and a handle of 2 to 20 letters, numbers, _ or ."; return; }
        if (state.users.some((u) => u.id !== me.id && u.handle === handle)) { $("#pfErr").textContent = "@" + handle + " is taken."; return; }
        if (LIVE) {
          $("#pfSave").disabled = true;
          try { await API.updateProfile(me.id, name, handle); } catch (e) {
            $("#pfSave").disabled = false;
            $("#pfErr").textContent = e && e.code === "23505" ? "@" + handle + " is taken." : "Couldn't save. Check your connection and try again.";
            return;
          }
        }
        me.name = name; me.handle = handle; save(); closeSheet(); renderViewAs(); render(); toast("Profile saved");
      };
    };
  }

  // ---------- render ----------
  function render() {
    renderBadge();
    renderBell();
    if (currentTab === "settings") renderSettings();
    if (currentTab === "feed") renderFeed();
    if (currentTab === "map") renderMap();
    if (currentTab === "friends") renderFriends();
    if (currentTab === "profile") renderProfile();
    if (currentTab === "thread") renderThread();
  }

  // ---------- demo start-up ----------
  function startDemo() {
    if (!state.seen["demo:switcher:" + tonight()] && !tonightsPosts().some((p) => p.userId === "u_nick")) {
      const nick = window.ROLLING_SEED().posts.find((p) => p.userId === "u_nick" && p.history);
      if (nick && user("u_nick").name !== UNKNOWN.name) state.posts.push(nick);
      state.seen["demo:switcher:" + tonight()] = 1;
    }
    ensureIds();
    if (seedReplies) {
      const tp = (uid) => tonightsPosts().find((p) => p.userId === uid);
      const add = (uid, onUser, text, mins) => { const p = tp(onUser); if (p) state.replies.push({ id: uuid(), post: pid(p), userId: uid, text, at: Math.min(Date.now(), p.at + mins * 60000) }); };
      add("u_tyler", "u_jake", "already there in spirit", 3);
      add("u_olivia", "u_jake", "save me a spot by the window", 6);
      add("u_emma", "u_maddie", "wear the red top 👀", 4);
      add("u_nick", "u_ryan", "might join late", 20);
    }
    save();
    renderViewAs();
    render();
  }

  // ---------- live: sign in, load, keep fresh ----------
  let account = {}, refreshing = null, started = false;

  async function refresh() {
    if (!LIVE || !state.me) return;
    if (refreshing) return refreshing;
    refreshing = (async () => {
      try {
        const data = await API.loadAll(state.me);
        if (data.me !== state.me) return; // signed out meanwhile
        Object.assign(state, data);
        if (!state.users.some((u) => u.id === state.me)) {
          showAuth("signin", "Your account isn't set up yet. Ask Sam to finish the database setup, then sign in again.");
          return;
        }
        render();
        pingNew();
      } catch (e) {
        console.error(e);
        if (!started) toast("Couldn't load Word. Check your connection.");
      } finally { refreshing = null; }
    })();
    return refreshing;
  }

  async function enter(session) {
    account = { email: session.user.email };
    if (state.me === session.user.id && started) return;
    state.me = session.user.id;
    hideAuth();
    $("#tab-feed").innerHTML = `<div class="empty">Loading…</div>`;
    await refresh();
    started = true;
  }

  async function signOut() {
    try { await API.auth.signOut(); } catch (e) {}
    location.reload();
  }

  function startLive() {
    showAuth("loading");
    let recovering = /type=recovery/.test(location.hash);
    API.auth.onChange((event, session) => {
      // Came back from a "reset your password" email: pick a new one first.
      if (event === "PASSWORD_RECOVERY") { recovering = true; showAuth("newpass"); return; }
      if (event === "SIGNED_OUT") { state.me = null; started = false; showAuth("signin"); return; }
      if (session && !recovering && (event === "SIGNED_IN" || event === "INITIAL_SESSION")) setTimeout(() => enter(session), 0);
      if (!session && event === "INITIAL_SESSION") showAuth("signin");
    });
    API.auth.donePasswordReset = () => { recovering = false; };
    // Keep the feed fresh: every 30 seconds while open, and right away when you come back to it.
    setInterval(() => { if (!document.hidden) refresh(); }, 30000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
  }

  // ---------- sign-in screens ----------
  function hideAuth() { $("#auth").classList.add("hidden"); }
  function showAuth(mode, note) {
    const el = $("#auth");
    el.classList.remove("hidden");
    const logo = `<div class="auth-logo"><svg viewBox="0 0 260 50" aria-label="Word"><text x="2" y="44" textLength="248" lengthAdjust="spacingAndGlyphs">WORD</text></svg></div>`;
    const field = (id, label, type, extra = "") => `<label class="field-label" for="${id}">${label}</label><input class="search" id="${id}" type="${type}" ${extra} />`;
    let body = "";
    if (mode === "loading") body = `<div class="auth-sub">Loading…</div>`;
    if (mode === "signin") body = `
      <div class="auth-sub">What's the word? Sign in to see where your friends are headed tonight.</div>
      <form class="auth-card" id="authForm" novalidate>
        ${field("aEmail", "Email", "email", 'autocomplete="email" required')}
        ${field("aPass", "Password", "password", 'autocomplete="current-password" required')}
        <div class="auth-msg" id="authMsg"></div>
        <button class="btn primary" type="submit">Sign in</button>
        <button class="link-btn" type="button" data-mode="reset">Forgot password?</button>
      </form>
      <div class="auth-switch">New here? <button class="link-btn" type="button" data-mode="signup">Create an account</button></div>`;
    if (mode === "signup") body = `
      <div class="auth-sub">Make an account, then add your friends. Only friends you accept see your posts.</div>
      <form class="auth-card" id="authForm" novalidate>
        ${field("aName", "Name", "text", 'maxlength="30" autocomplete="given-name" placeholder="What friends call you" required')}
        ${field("aHandle", "Handle", "text", 'maxlength="20" autocapitalize="none" autocomplete="username" placeholder="@yourname" required')}
        ${field("aEmail", "Email", "email", 'autocomplete="email" required')}
        ${field("aPass", "Password", "password", 'autocomplete="new-password" minlength="6" placeholder="At least 6 characters" required')}
        <div class="auth-msg" id="authMsg"></div>
        <button class="btn primary" type="submit">Create account</button>
      </form>
      <div class="auth-switch">Already have an account? <button class="link-btn" type="button" data-mode="signin">Sign in</button></div>`;
    if (mode === "reset") body = `
      <div class="auth-sub">We'll email you a link to choose a new password.</div>
      <form class="auth-card" id="authForm" novalidate>
        ${field("aEmail", "Email", "email", 'autocomplete="email" required')}
        <div class="auth-msg" id="authMsg"></div>
        <button class="btn primary" type="submit">Send link</button>
      </form>
      <div class="auth-switch"><button class="link-btn" type="button" data-mode="signin">Back to sign in</button></div>`;
    if (mode === "newpass") body = `
      <div class="auth-sub">Choose a new password.</div>
      <form class="auth-card" id="authForm" novalidate>
        ${field("aPass", "New password", "password", 'autocomplete="new-password" minlength="6" placeholder="At least 6 characters" required')}
        <div class="auth-msg" id="authMsg"></div>
        <button class="btn primary" type="submit">Save password</button>
      </form>`;
    el.innerHTML = `<div class="auth-inner">${logo}${body}</div>`;
    const msg = (t, good) => { const m = $("#authMsg"); if (m) { m.textContent = t || ""; m.classList.toggle("good", !!good); } };
    if (note) msg(note);
    el.querySelectorAll("[data-mode]").forEach((b) => b.onclick = () => showAuth(b.dataset.mode));
    const form = $("#authForm");
    if (!form) return;
    const val = (id) => ($("#" + id) ? $("#" + id).value.trim() : "");
    form.onsubmit = async (ev) => {
      ev.preventDefault();
      const btn = form.querySelector("[type=submit]");
      const email = val("aEmail"), pass = $("#aPass") ? $("#aPass").value : "";
      if ($("#aEmail") && !/^\S+@\S+\.\S+$/.test(email)) return msg("Enter your email address.");
      if (mode !== "reset" && pass.length < 6) return msg("Passwords are at least 6 characters.");
      btn.disabled = true; msg("");
      try {
        if (mode === "signin") {
          await API.auth.signIn(email, pass);
        } else if (mode === "signup") {
          const name = val("aName"), handle = val("aHandle").replace(/^@/, "").toLowerCase();
          if (!name) { btn.disabled = false; return msg("Add your name."); }
          if (!/^[a-z0-9_.]{2,20}$/.test(handle)) { btn.disabled = false; return msg("Handles are 2 to 20 letters, numbers, _ or ."); }
          if (!(await API.auth.handleAvailable(handle))) { btn.disabled = false; return msg("@" + handle + " is taken. Try another."); }
          const res = await API.auth.signUp({ email, password: pass, name, handle });
          // If the project asks people to confirm their email, there's no session yet.
          if (!res.session) { showAuth("signin"); msg("Check your email for a link to confirm your account, then sign in here.", true); return; }
        } else if (mode === "reset") {
          await API.auth.sendReset(email);
          btn.disabled = false;
          return msg("If that email has an account, a reset link is on its way.", true);
        } else if (mode === "newpass") {
          await API.auth.setPassword(pass);
          API.auth.donePasswordReset();
          history.replaceState(null, "", location.pathname);
          toast("Password updated");
          const session = await API.auth.session();
          if (session) enter(session);
        }
      } catch (e) {
        btn.disabled = false;
        msg(authError(e));
      }
    };
    const first = form.querySelector("input"); if (first) setTimeout(() => first.focus(), 50);
  }
  function authError(e) {
    const m = String((e && e.message) || e || "");
    if (/invalid login credentials/i.test(m)) return "That email and password don't match.";
    if (/email not confirmed/i.test(m)) return "Confirm your email first: check your inbox for the link.";
    if (/already registered|already been registered/i.test(m)) return "There's already an account with that email. Sign in instead.";
    if (/rate limit|too many/i.test(m)) return "Too many tries. Wait a minute and try again.";
    if (/password/i.test(m)) return m;
    if (/fetch|network/i.test(m)) return "Can't reach Word. Check your connection.";
    return m || "Something went wrong. Try again.";
  }

  if (LIVE) startLive(); else startDemo();
  // Keep "12m ago" labels and the bell fresh.
  setInterval(() => { if (!state.me) return; renderBell(); if (currentTab === "feed") renderFeed(); if (!LIVE) pingNew(); }, 60000);
})();
