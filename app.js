/* Word ("what's the word?"): web prototype.
 * No build step and no backend: state lives in localStorage so it runs as a static
 * site (GitHub Pages) or by opening index.html. The data shapes (users, friendships,
 * requests, posts) are the ones a real backend would store. */
(function () {
  "use strict";

  const STORE_KEY = "rolling.state.v2";
  const BARS = window.ROLLING_BARS;
  const BAR_BY_ID = Object.fromEntries(BARS.map((b) => [b.id, b]));
  const CAMPUS = [43.0745, -89.3925]; // Library Mall / State St
  const COMMENT_WORDS = 100;
  const DAY = 24 * 3600 * 1000;

  // ---------- state ----------
  let state = load();
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
  // replies: [{ post: "<userId>@<timestamp>", userId, text, at }]
  const seedReplies = !state.replies;
  state.replies = state.replies || [];
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(STORE_KEY));
      if (s && s.version === 2) return s;
    } catch (e) {}
    return window.ROLLING_SEED();
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {}
  }

  const user = (id) => state.users.find((u) => u.id === id);

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
    return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
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
  function popularity() {
    const now = Date.now(), score = {}, month = {};
    for (const p of state.posts) {
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
  let currentTab = "feed";
  function showTab(name) {
    currentTab = name;
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.id === "tab-" + name));
    document.querySelectorAll(".tabbar [data-tab]").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
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
      // One post per night: replace any earlier post from tonight.
      const prev = myPost();
      state.posts = state.posts.filter((p) => !(p.userId === state.me && nightKey(p.at) === tonight()));
      const post = { userId: state.me, barId: draft.barId, at: Date.now(), excitement: draft.excitement, arrive: draft.arrive, comment: draft.comment.trim() };
      // Switching bars keeps the old pick, so the feed can show the whole saga.
      const history = prev ? (prev.history || []).slice() : [];
      if (prev && prev.barId !== post.barId) history.push({ barId: prev.barId, at: prev.at, excitement: prev.excitement, arrive: prev.arrive, comment: prev.comment || "" });
      if (history.length) post.history = history;
      state.posts.push(post);
      if (prev) state.replies.forEach((r) => { if (r.post === pid(prev)) r.post = pid(post); });
      onPost(post, prev);
      save();
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
    if (showSpots) {
      const { score } = friendSpots();
      const max = Math.max(1, ...Object.values(score));
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
      if (settingsFor(id).requests) notify(id, "request", `${user(state.me).name} sent you a friend request`);
      save(); toast("Request sent to " + user(id).name); render(); });
    on("cancel", (id) => { state.requests = state.requests.filter((r) => !(r.from === state.me && r.to === id)); save(); toast("Request canceled"); render(); });
    on("accept", (id) => {
      state.requests = state.requests.filter((r) => !((r.from === id && r.to === state.me) || (r.from === state.me && r.to === id)));
      state.friendships.push([state.me, id]);
      if (settingsFor(id).requests) notify(id, "accept", `${user(state.me).name} accepted your friend request`);
      save();
      toast("You and " + user(id).name + " are now friends"); render();
    });
    on("decline", (id) => { state.requests = state.requests.filter((r) => !(r.from === id && r.to === state.me)); save(); render(); });
    on("remove", (id) => {
      state.friendships = state.friendships.filter(([x, y]) => !((x === state.me && y === id) || (y === state.me && x === id)));
      setFav(state.me, id, false); setFav(id, state.me, false);
      save(); render();
    });
    bindStars(bodyEl);
  }
  let friendQuery = "";

  // ---------- replies ----------
  // A post's id is "<userId>@<timestamp>". Replies point at it, and move along
  // when someone edits tonight's post.
  const pid = (p) => p.userId + "@" + p.at;
  const findPost = (id) => state.posts.find((p) => pid(p) === id);
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
  function openThread(id, opts = {}) {
    let p = findPost(id);
    // An alert can point at a post that was later changed; show that person's post tonight instead.
    if (!p || nightKey(p.at) !== tonight()) {
      const uid = id.split("@")[0];
      p = tonightsPosts().find((x) => x.userId === uid);
    }
    if (!p) { closeSheet(); toast("That post is from an earlier night"); return; }
    const canSee = p.userId === state.me || friendIds(state.me).has(p.userId);
    if (!canSee) { closeSheet(); toast("Only friends can see that post"); return; }
    const u = user(p.userId), b = BAR_BY_ID[p.barId], rs = repliesFor(pid(p));
    openSheet(`
      <div class="thread-post ${opts.highlight ? "flash" : ""}" data-post="${pid(p)}">
        ${postBody(p)}
      </div>
      <div class="field-label">${rs.length} ${rs.length === 1 ? "reply" : "replies"}</div>
      <div class="replies">${rs.map((r) => {
        const ru = user(r.userId);
        return `<div class="reply"><div class="reply-body">
          <div><b>${r.userId === state.me ? "You" : esc(ru.name)}</b> <span class="sub small">· ${ago(r.at)}</span></div>
          <div class="reply-text">${esc(r.text)}</div></div></div>`;
      }).join("") || `<div class="sub small">No replies yet. Start the conversation.</div>`}</div>
      <div class="reply-compose">
        <textarea class="comment" id="replyText" rows="2" placeholder="Reply to ${u.id === state.me ? "your friends" : esc(u.name)}…"></textarea>
        <div class="reply-compose-row"><span class="small counter" id="replyCount">0/${COMMENT_WORDS} words</span>
          <button class="btn primary small" id="sendReply" disabled>Reply</button></div>
      </div>
      <div class="sheet-actions"><button class="btn" id="closeThread">Close</button></div>`);
    $("#closeThread").onclick = closeSheet;
    $("#sheet").querySelectorAll("[data-bar]").forEach((n) => n.onclick = () => { closeSheet(); showTab("map"); focusBar(n.dataset.bar); });
    const ta = $("#replyText"), cnt = $("#replyCount"), send = $("#sendReply");
    ta.addEventListener("input", () => {
      if (wordCount(ta.value) > COMMENT_WORDS) ta.value = limitWords(ta.value, COMMENT_WORDS);
      const n = wordCount(ta.value);
      cnt.textContent = n + "/" + COMMENT_WORDS + " words";
      cnt.classList.toggle("full", n >= COMMENT_WORDS);
      send.disabled = !n;
    });
    send.onclick = () => {
      const text = ta.value.trim();
      if (!text) return;
      const postId = pid(p);
      // Tell the post's owner and anyone else already in the thread.
      const people = new Set([p.userId, ...rs.map((r) => r.userId)]);
      people.delete(state.me);
      state.replies.push({ post: postId, userId: state.me, text, at: Date.now() });
      const me = user(state.me).name;
      for (const to of people) {
        if (!settingsFor(to).replies) continue;
        const what = to === p.userId ? "your post" : `${u.name}'s post`;
        notify(to, "reply", `${me} replied to ${what}: "${text.length > 60 ? text.slice(0, 57) + "…" : text}"`, { post: postId, barId: p.barId });
      }
      save();
      openThread(postId);
      render();
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
      setFav(state.me, id, on); save();
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
  // In this prototype every user's inbox lives in the same browser, so switching
  // "Viewing as" shows that person's notifications. A real app would push them.
  const myNotes = () => (state.notifications || []).filter((n) => n.to === state.me).sort((a, b) => b.at - a.at);

  function notify(to, kind, text, opts = {}) {
    if (opts.key) {
      if (state.seen[opts.key]) return;
      state.seen[opts.key] = 1;
    }
    state.notifications.push({ to, kind, text, barId: opts.barId || null, post: opts.post || null, at: opts.at || Date.now(), read: false });
    const s = settingsFor(to);
    if (!opts.quiet && s.browser && "Notification" in window && Notification.permission === "granted") {
      try { new Notification("Word" + (to === state.me ? "" : " · for " + user(to).name), { body: text }); } catch (e) {}
    }
  }

  // Someone posted (or changed) tonight's bar: tell each of their friends what
  // they asked to hear about. Only the most relevant alert per friend, plus the
  // "bar is filling up" alert, which is tracked separately.
  function onPost(post, prev, opts = {}) {
    const poster = user(post.userId), bar = BAR_BY_ID[post.barId];
    const night = nightKey(post.at);
    const postsTonight = state.posts.filter((p) => nightKey(p.at) === night);
    for (const fid of friendIds(post.userId)) {
      const s = settingsFor(fid);
      const theirs = postsTonight.find((p) => p.userId === fid && p.at <= post.at);
      const fav = isFav(fid, post.userId);
      // Alerts about a friend link to their post; the crowd alert links to the bar.
      const base = Object.assign({ barId: bar.id, post: pid(post) }, opts);
      if (prev && prev.barId !== post.barId) {
        if (s.switched) notify(fid, "switch", `${poster.name} switched from ${BAR_BY_ID[prev.barId].name} to ${bar.name}`, base);
      } else if (!prev && s.sameBar && theirs && theirs.barId === post.barId) {
        notify(fid, "same", `${poster.name} is headed to ${bar.name} too`, base);
      } else if (!prev && ((fav && s.favPosts) || s.anyPosts)) {
        notify(fid, fav ? "fav" : "post", `${poster.name} is headed to ${bar.name}, around ${fmtTime(post.arrive)}`, base);
      }
      if (s.hyped && post.excitement >= 95 && !(prev && prev.excitement >= 95)) {
        notify(fid, "hype", `${poster.name} is ${hypeLabel(post.excitement).toLowerCase()} for ${bar.name} tonight`, Object.assign({ key: `hype:${fid}:${post.userId}:${night}` }, base));
      }
      if (s.barCrowd) {
        const myFriends = friendIds(fid);
        const n = postsTonight.filter((p) => p.barId === post.barId && myFriends.has(p.userId)).length;
        if (n >= s.crowdSize) {
          notify(fid, "crowd", `${n} of your friends are headed to ${bar.name} tonight`, Object.assign({ key: `crowd:${fid}:${bar.id}:${night}` }, base, { post: null }));
        }
      }
    }
  }

  // "Remind me to post": fires once a night after the chosen time, if I haven't posted.
  function checkReminder() {
    const s = settingsFor(state.me);
    if (!s.reminder || myPost()) return;
    const d = new Date();
    let nowMin = d.getHours() * 60 + d.getMinutes();
    if (d.getHours() < 6) nowMin += 24 * 60;
    if (nowMin >= timeKey(s.reminderTime)) {
      notify(state.me, "reminder", "You haven't posted yet tonight. What's the word? Where are you headed?", { key: `rem:${state.me}:${tonight()}` });
      save();
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
    notes.forEach((n) => (n.read = true));
    save(); renderBell();
    $("#closeInbox").onclick = closeSheet;
    $("#inboxSettings").onclick = () => { closeSheet(); showTab("settings"); };
    document.querySelectorAll(".note[data-bar]").forEach((x) => x.onclick = () => { closeSheet(); showTab("map"); focusBar(x.dataset.bar); });
    document.querySelectorAll(".note[data-goto]").forEach((x) => x.onclick = () => { closeSheet(); showTab(x.dataset.goto); });
    document.querySelectorAll(".note[data-post]").forEach((x) => x.onclick = () => { showTab("feed"); openThread(x.dataset.post, { highlight: true }); });
    document.querySelectorAll(".note[data-compose]").forEach((x) => x.onclick = () => openComposer());
  }
  $("#bellBtn").addEventListener("click", openInbox);
  $("#gearBtn").addEventListener("click", () => showTab("settings"));

  // ---------- settings ----------
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

      <h2>Demo</h2>
      <div class="sub small" style="margin-bottom:10px">There's no sign-in yet. Use "Viewing as" at the top to be someone else; each person has their own settings and notifications. Everything is saved in this browser only.</div>
      <button class="btn small" id="resetDemo">Reset demo data</button>`;

    el.querySelectorAll("[data-set]").forEach((inp) => inp.onchange = async () => {
      const key = inp.dataset.set;
      if (key === "browser" && inp.checked) {
        if (!("Notification" in window)) { inp.checked = false; return; }
        const perm = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
        if (perm !== "granted") { inp.checked = false; toast("Notifications aren't allowed in this browser"); renderSettings(); return; }
      }
      s[key] = inp.checked; save();
      if (key === "reminder") { checkReminder(); renderBell(); }
    });
    el.querySelectorAll("[data-step]").forEach((b) => b.onclick = () => {
      s.crowdSize = Math.min(8, Math.max(2, s.crowdSize + +b.dataset.step)); save();
      $("#crowdSize").textContent = s.crowdSize;
    });
    $("#reminderTime").onchange = (e) => { s.reminderTime = e.target.value; save(); checkReminder(); renderBell(); };
    $("#settingsBack").onclick = () => showTab("feed");
    bindStars(el);
    $("#resetDemo", el).onclick = () => {
      state = window.ROLLING_SEED();
      state.favorites = { u_sam: ["u_jake", "u_maddie"] }; state.settings = {}; state.seen = {};
      save(); location.reload();
    };
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
      <label class="viewas card" title="No sign-in yet: pick which demo user you are">
        <span>Demo: viewing as</span><select id="viewAs"></select>
      </label>
      <div class="card stats">
        <div><b>${nights}</b><span>nights out</span></div>
        <div><b>${Object.keys(counts).length}</b><span>bars</span></div>
        <div><b>${switches}</b><span>switches</span></div>
      </div>
      <h2>Your usual spots</h2>
      <div class="card list">${top.length ? top.map(([id, n], i) => `
        <button class="spot-row" data-bar="${id}"><span class="rank top">${i + 1}</span>
          <span class="info"><div class="n">${esc(BAR_BY_ID[id].name)}</div><div class="sub small">${n} night${n > 1 ? "s" : ""}</div></span></button>`).join("")
        : `<div class="sub small">Post where you're headed and your favorite bars show up here.</div>`}</div>`;
    renderViewAs();
    el.querySelectorAll("[data-bar]").forEach((n) => n.onclick = () => { showTab("map"); focusBar(n.dataset.bar); });
    $("#editProfile").onclick = () => {
      openSheet(`<h3>Edit profile</h3><div class="sub">Your friends see this.</div>
        <label class="field-label" for="pfName">Name</label><input class="search" id="pfName" maxlength="30" value="${esc(me.name)}" />
        <label class="field-label" for="pfHandle">Handle</label><input class="search" id="pfHandle" maxlength="20" value="${esc(me.handle)}" />
        <div class="small counter" id="pfErr"></div>
        <div class="sheet-actions"><button class="btn" id="pfCancel">Cancel</button><button class="btn primary" id="pfSave">Save</button></div>`);
      $("#pfCancel").onclick = closeSheet;
      $("#pfSave").onclick = () => {
        const name = $("#pfName").value.trim(), handle = $("#pfHandle").value.trim().replace(/^@/, "").toLowerCase();
        if (!name || !/^[a-z0-9_.]{2,20}$/.test(handle)) { $("#pfErr").textContent = "Add a name, and a handle of 2 to 20 letters, numbers, _ or ."; return; }
        if (state.users.some((u) => u.id !== me.id && u.handle === handle)) { $("#pfErr").textContent = "@" + handle + " is taken."; return; }
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
  }

  // Rename (Rolling -> Word): reword alerts saved before the rename.
  for (const n of state.notifications || []) {
    n.text = n.text.replace(/ (is|are) rolling to /, " $1 headed to ").replace("Where are you rolling?", "What's the word? Where are you headed?");
  }

  // First run: build the starting inbox by replaying tonight's posts and pending requests.
  if (!state.notifications) {
    state.notifications = [];
    const posts = tonightsPosts().sort((a, b) => a.at - b.at);
    for (const p of posts) onPost(p, null, { quiet: true, at: p.at });
    for (const r of state.requests) if (settingsFor(r.to).requests) notify(r.to, "request", `${user(r.from).name} sent you a friend request`, { quiet: true, at: r.at });
    save();
  }

  if (!state.seen["demo:switcher:" + tonight()] && !tonightsPosts().some((p) => p.userId === "u_nick")) {
    const nick = window.ROLLING_SEED().posts.find((p) => p.userId === "u_nick" && p.history);
    if (nick && user("u_nick")) state.posts.push(nick);
    state.seen["demo:switcher:" + tonight()] = 1;
    save();
  }
  if (seedReplies) {
    const tp = (uid) => tonightsPosts().find((p) => p.userId === uid);
    const add = (uid, onUser, text, mins) => { const p = tp(onUser); if (p) state.replies.push({ post: pid(p), userId: uid, text, at: Math.min(Date.now(), p.at + mins * 60000) }); };
    add("u_tyler", "u_jake", "already there in spirit", 3);
    add("u_olivia", "u_jake", "save me a spot by the window", 6);
    add("u_emma", "u_maddie", "wear the red top 👀", 4);
    add("u_nick", "u_ryan", "might join late", 20);
    save();
  }

  renderViewAs();
  checkReminder();
  render();
  // Keep "12m ago" labels fresh and check the posting reminder.
  setInterval(() => { checkReminder(); if (currentTab === "feed") renderFeed(); }, 60000);
})();
