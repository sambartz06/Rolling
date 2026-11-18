/* Rolling: web prototype.
 * No build step and no backend: state lives in localStorage so it can be demoed
 * by opening index.html. The data shapes (users, friendships, posts) are the ones
 * a real backend would store, so swapping in an API later is straightforward. */
(function () {
  "use strict";

  const STORE_KEY = "rolling.state.v1";
  const BARS = window.ROLLING_BARS;
  const BAR_BY_ID = Object.fromEntries(BARS.map((b) => [b.id, b]));
  const CATS = window.ROLLING_CATEGORIES;
  const CAMPUS = [43.0745, -89.3925]; // Library Mall / State St

  // ---------- state ----------
  let state = load();
  // Demo convenience: if nobody has posted tonight (e.g. you open it tomorrow),
  // refresh the mock posts so the feed and map aren't empty. Friends are kept.
  if (!state.posts.some((p) => nightKey(p.at) === nightKey(Date.now()))) {
    state.posts = window.ROLLING_SEED().posts;
  }
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(STORE_KEY));
      if (s && s.version === 1) return s;
    } catch (e) {}
    return window.ROLLING_SEED();
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {}
  }

  const user = (id) => state.users.find((u) => u.id === id);
  const me = () => user(state.me);

  function friendIds(uid) {
    const out = new Set();
    for (const [a, b] of state.friendships) {
      if (a === uid) out.add(b);
      if (b === uid) out.add(a);
    }
    return out;
  }
  const areFriends = (a, b) => friendIds(a).has(b);

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

  // ---------- helpers ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  function ago(ts) {
    const m = Math.max(0, Math.round((Date.now() - ts) / 60000));
    if (m < 1) return "just now";
    if (m < 60) return m + "m ago";
    const h = Math.floor(m / 60);
    return h + "h ago";
  }
  function avatar(u, cls = "") {
    return `<div class="avatar ${cls}" style="background:${u.color}">${esc(u.name[0])}</div>`;
  }
  function chips(r) {
    return `<div class="chips">${CATS.map((c) => r && r[c.key]
      ? `<span class="chip">${c.emoji} ${c.label} <span class="score">${r[c.key]}</span>/5</span>` : "").join("")}</div>`;
  }
  function distKm(a, b) {
    const R = 6371, toR = Math.PI / 180;
    const dLat = (b[0] - a[0]) * toR, dLon = (b[1] - a[1]) * toR;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * toR) * Math.cos(b[0] * toR) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
  }
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
  $("#postBtn").addEventListener("click", () => openComposer());

  // ---------- view-as switcher (stand-in for sign-in) ----------
  function renderViewAs() {
    const sel = $("#viewAs");
    sel.innerHTML = state.users.map((u) => `<option value="${u.id}" ${u.id === state.me ? "selected" : ""}>${esc(u.name)}</option>`).join("");
  }
  $("#viewAs").addEventListener("change", (e) => { state.me = e.target.value; save(); render(); });

  // ---------- feed ----------
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
        <div class="label">You're rolling to</div>
        <div class="bar">${esc(b.name)}</div>
        ${chips(mine.ratings)}
        ${mine.comment ? `<div class="comment" style="margin-top:8px">${esc(mine.comment)}</div>` : ""}
        <div style="margin-top:12px"><button class="btn small" id="editMine">Change tonight's post</button></div>
      </div>`;
    } else {
      html += `<div class="card mine">
        <div class="label">Tonight</div>
        <div class="bar">Where are you rolling?</div>
        <div class="muted small" style="margin-bottom:12px">One post a night. Your friends see it in their feed and on the map.</div>
        <button class="btn primary" id="startPost">Post where I'm rolling</button>
      </div>`;
    }

    html += `<h2>Friends tonight · ${posts.length}</h2>`;
    if (!posts.length) {
      html += friendIds(state.me).size
        ? `<div class="empty">None of your friends have posted yet tonight.</div>`
        : `<div class="empty">Add some friends to see where they're rolling.<br><br><button class="btn small" data-goto="friends">Find friends</button></div>`;
    } else {
      html += `<div class="stack">` + posts.map((p) => {
        const u = user(p.userId), b = BAR_BY_ID[p.barId];
        return `<div class="card post">
          ${avatar(u)}
          <div class="body">
            <div class="line1"><span class="who">${esc(u.name)}</span><span class="time">${ago(p.at)}</span></div>
            <div class="where">rolling to <b data-bar="${b.id}">${esc(b.name)}</b></div>
            ${chips(p.ratings)}
            ${p.comment ? `<div class="comment">${esc(p.comment)}</div>` : ""}
          </div>
        </div>`;
      }).join("") + `</div>`;
    }

    if (quiet.length) {
      html += `<h2>Haven't posted yet</h2><div class="waiting">` +
        quiet.map((u) => `<div class="w">${avatar(u, "sm")}${esc(u.name)}</div>`).join("") + `</div>`;
    }
    el.innerHTML = html;

    const s = $("#startPost", el); if (s) s.onclick = () => openComposer();
    const e = $("#editMine", el); if (e) e.onclick = () => openComposer();
    el.querySelectorAll("[data-bar]").forEach((n) => n.onclick = () => { showTab("map"); focusBar(n.dataset.bar); });
    el.querySelectorAll("[data-goto]").forEach((n) => n.onclick = () => showTab(n.dataset.goto));
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

  // ---------- composer: pick bar -> rate -> comment ----------
  function openComposer(preselectBarId) {
    const existing = myPost();
    const draft = {
      barId: preselectBarId || (existing && existing.barId) || null,
      ratings: Object.assign({}, existing ? existing.ratings : {}),
      comment: existing ? existing.comment : "",
    };
    draft.barId ? renderRate(draft) : renderPick(draft);
  }

  function friendCountsByBar() {
    const counts = {};
    for (const p of visiblePosts()) if (p.userId !== state.me) counts[p.barId] = (counts[p.barId] || 0) + 1;
    return counts;
  }

  function renderPick(draft) {
    openSheet(`
      <h3>Where are you rolling tonight?</h3>
      <div class="sub">Madison bars from OpenStreetMap</div>
      <input class="search" id="barSearch" placeholder="Search bars" autocomplete="off" />
      <div class="barlist" id="barList"></div>`);
    const counts = friendCountsByBar();
    // Bars your friends are at first, then closest to campus.
    const sorted = BARS.slice().sort((a, b) =>
      (counts[b.id] || 0) - (counts[a.id] || 0) || distKm(CAMPUS, [a.lat, a.lon]) - distKm(CAMPUS, [b.lat, b.lon]));
    const list = $("#barList"), input = $("#barSearch");
    function draw() {
      const q = input.value.trim().toLowerCase();
      const rows = sorted.filter((b) => !q || b.name.toLowerCase().includes(q) || b.addr.toLowerCase().includes(q)).slice(0, 60);
      list.innerHTML = rows.length ? rows.map((b) => `
        <button class="baropt" data-id="${b.id}">
          <span><div class="n">${esc(b.name)}</div><div class="a">${esc(b.addr || b.type)}</div></span>
          ${counts[b.id] ? `<span class="f">${counts[b.id]} friend${counts[b.id] > 1 ? "s" : ""}</span>` : ""}
        </button>`).join("") : `<div class="empty">No bars match "${esc(q)}"</div>`;
      list.querySelectorAll(".baropt").forEach((n) => n.onclick = () => { draft.barId = n.dataset.id; renderRate(draft); });
    }
    input.addEventListener("input", draw);
    draw();
  }

  function renderRate(draft) {
    const b = BAR_BY_ID[draft.barId];
    openSheet(`
      <h3>Rate it</h3>
      <div class="sub">Optional. Tap a number for each one.</div>
      <div class="picked"><span><div class="n">${esc(b.name)}</div><div class="muted small">${esc(b.addr || b.type)}</div></span>
        <button class="btn small" id="changeBar">Change</button></div>
      <div class="hud">${CATS.map((c) => `
        <div class="row"><span class="lbl">${c.emoji} ${c.label}</span>
          <div class="pips" data-cat="${c.key}">${[1, 2, 3, 4, 5].map((n) =>
            `<button class="pip ${draft.ratings[c.key] >= n ? "on" : ""}" data-n="${n}">${n}</button>`).join("")}</div>
        </div>`).join("")}
      </div>
      <textarea class="comment" id="comment" maxlength="140" placeholder="Add a short comment (optional)">${esc(draft.comment || "")}</textarea>
      <div class="small muted" style="text-align:right" id="cc"></div>
      <div class="sheet-actions">
        <button class="btn" id="cancel">Cancel</button>
        <button class="btn primary" id="submit">${myPost() ? "Update post" : "Post"}</button>
      </div>`);
    $("#changeBar").onclick = () => renderPick(draft);
    $("#cancel").onclick = closeSheet;
    document.querySelectorAll(".pips").forEach((row) => row.addEventListener("click", (e) => {
      const btn = e.target.closest(".pip"); if (!btn) return;
      const n = +btn.dataset.n, k = row.dataset.cat;
      draft.ratings[k] = draft.ratings[k] === n ? 0 : n; // tap again to clear
      row.querySelectorAll(".pip").forEach((p) => p.classList.toggle("on", +p.dataset.n <= draft.ratings[k]));
    }));
    const ta = $("#comment"), cc = $("#cc");
    const upd = () => { draft.comment = ta.value; cc.textContent = ta.value.length + "/140"; };
    ta.addEventListener("input", upd); upd();
    $("#submit").onclick = () => {
      const ratings = {};
      for (const c of CATS) if (draft.ratings[c.key]) ratings[c.key] = draft.ratings[c.key];
      // One post per night: replace any earlier post from tonight.
      state.posts = state.posts.filter((p) => !(p.userId === state.me && nightKey(p.at) === tonight()));
      state.posts.push({ userId: state.me, barId: draft.barId, at: Date.now(), ratings, comment: draft.comment.trim() });
      save();
      closeSheet();
      toast("You're rolling to " + b.name);
      render();
    };
  }

  // ---------- map ----------
  let map, barLayer, countLayer, showAllBars = false;
  function initMap() {
    if (map) return;
    map = L.map("map", { zoomControl: false, attributionControl: true }).setView(CAMPUS, 15);
    // Esri dark gray basemap: free, no API key, attribution required.
    const esri = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/";
    const attribution = 'Tiles &copy; Esri &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors | Bars: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
    L.tileLayer(esri + "World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19, maxNativeZoom: 16, attribution }).addTo(map);
    L.tileLayer(esri + "World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19, maxNativeZoom: 16 }).addTo(map);
    barLayer = L.layerGroup().addTo(map);
    countLayer = L.layerGroup().addTo(map);
  }

  function goersByBar() {
    const by = {};
    for (const p of visiblePosts()) (by[p.barId] = by[p.barId] || []).push(p);
    return by;
  }

  let fittedFor = null;
  function renderMap() {
    initMap();
    barLayer.clearLayers();
    countLayer.clearLayers();
    const by = goersByBar();
    const mine = myPost();

    if (showAllBars) {
      for (const b of BARS) {
        if (by[b.id]) continue;
        L.marker([b.lat, b.lon], { icon: L.divIcon({ className: "", html: '<div class="bar-dot"></div>', iconSize: [10, 10] }) })
          .on("click", () => openBar(b.id)).addTo(barLayer);
      }
    }
    for (const [barId, posts] of Object.entries(by)) {
      const b = BAR_BY_ID[barId];
      const isMine = mine && mine.barId === barId;
      const friendsHere = posts.filter((p) => p.userId !== state.me).length;
      const label = friendsHere || "You";
      L.marker([b.lat, b.lon], {
        icon: L.divIcon({ className: "", html: `<div class="count-marker ${isMine ? "me" : ""}" style="${label === "You" ? "font-size:11px" : ""}">${label}</div>`, iconSize: [38, 38], iconAnchor: [19, 19] }),
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
      <div class="pill"><b>${totalFriends}</b> friend${totalFriends === 1 ? "" : "s"} out at <b>${barsCount}</b> bar${barsCount === 1 ? "" : "s"}</div>
      <label class="pill toggle"><input type="checkbox" id="allBars" ${showAllBars ? "checked" : ""}/> All bars</label>`;
    $("#allBars").onchange = (e) => { showAllBars = e.target.checked; renderMap(); };
  }

  function focusBar(barId) {
    const b = BAR_BY_ID[barId];
    map.setView([b.lat, b.lon], 17);
    openBar(barId);
  }

  // Tap a bar on the map: who's going + their ratings.
  function openBar(barId) {
    const b = BAR_BY_ID[barId];
    const posts = goersByBar()[barId] || [];
    const avg = {};
    for (const c of CATS) {
      const vals = posts.map((p) => p.ratings[c.key]).filter(Boolean);
      if (vals.length) avg[c.key] = (vals.reduce((a, v) => a + v, 0) / vals.length).toFixed(1).replace(/\.0$/, "");
    }
    const mine = myPost();
    openSheet(`
      <h3>${esc(b.name)}</h3>
      <div class="sub">${esc(b.addr || b.type)}${posts.length ? ` · ${posts.length} going tonight` : ""}</div>
      ${Object.keys(avg).length ? `<div class="small muted">Tonight's average rating</div>${chips(avg)}` : ""}
      <div class="goers" style="margin-top:10px">${posts.length ? posts.map((p) => {
        const u = user(p.userId);
        return `<div class="g">${avatar(u, "sm")}<div style="flex:1;min-width:0">
          <div><b>${u.id === state.me ? "You" : esc(u.name)}</b> <span class="muted small">· ${ago(p.at)}</span></div>
          ${p.comment ? `<div class="small" style="margin-top:2px">${esc(p.comment)}</div>` : ""}
        </div></div>`;
      }).join("") : `<div class="empty" style="padding:14px">No friends here yet tonight.</div>`}</div>
      <div class="sheet-actions">
        ${mine && mine.barId === barId
          ? `<button class="btn" id="closeBar">Close</button>`
          : `<button class="btn" id="closeBar">Close</button><button class="btn primary" id="rollHere">I'm rolling here</button>`}
      </div>`);
    $("#closeBar").onclick = closeSheet;
    const r = $("#rollHere"); if (r) r.onclick = () => openComposer(barId);
  }

  // ---------- friends ----------
  function renderFriends() {
    const el = $("#tab-friends");
    const f = friendIds(state.me);
    const friends = [...f].map(user).sort((a, b) => a.name.localeCompare(b.name));
    const others = state.users.filter((u) => u.id !== state.me && !f.has(u.id));
    const mutuals = (uid) => [...friendIds(uid)].filter((x) => f.has(x)).length;
    el.innerHTML = `
      <input class="search" id="friendSearch" placeholder="Search people by name or @handle" autocomplete="off" />
      <h2>Add friends</h2>
      <div class="card list" id="addList">${others.length ? others.map((u) => `
        <div class="person" data-name="${esc((u.name + " " + u.handle).toLowerCase())}">${avatar(u)}
          <div class="meta"><div class="n">${esc(u.name)}</div><div class="h">@${esc(u.handle)}${mutuals(u.id) ? ` · ${mutuals(u.id)} mutual` : ""}</div></div>
          <button class="btn small primary" data-add="${u.id}">Add</button></div>`).join("")
        : `<div class="muted small">You're friends with everyone in the demo.</div>`}</div>
      <h2>Your friends · ${friends.length}</h2>
      <div class="card list" id="friendList">${friends.length ? friends.map((u) => `
        <div class="person" data-name="${esc((u.name + " " + u.handle).toLowerCase())}">${avatar(u)}
          <div class="meta"><div class="n">${esc(u.name)}</div><div class="h">@${esc(u.handle)}</div></div>
          <button class="btn small" data-remove="${u.id}">Remove</button></div>`).join("")
        : `<div class="muted small">No friends yet. Add some above.</div>`}</div>
      <h2>Demo</h2>
      <div class="muted small" style="margin-bottom:10px">There's no sign-in yet. Use "Viewing as" at the top to be a different person. Everything is saved in this browser only.</div>
      <button class="btn small" id="resetDemo">Reset demo data</button>`;

    el.querySelectorAll("[data-add]").forEach((b) => b.onclick = () => {
      state.friendships.push([state.me, b.dataset.add]); save();
      toast("You and " + user(b.dataset.add).name + " are now friends"); render();
    });
    el.querySelectorAll("[data-remove]").forEach((b) => b.onclick = () => {
      const id = b.dataset.remove;
      state.friendships = state.friendships.filter(([x, y]) => !((x === state.me && y === id) || (y === state.me && x === id)));
      save(); render();
    });
    $("#friendSearch", el).addEventListener("input", (e) => {
      const q = e.target.value.trim().toLowerCase().replace(/^@/, "");
      el.querySelectorAll(".person").forEach((p) => p.classList.toggle("hidden", !!q && !p.dataset.name.includes(q)));
    });
    $("#resetDemo", el).onclick = () => { state = window.ROLLING_SEED(); save(); renderViewAs(); render(); toast("Demo data reset"); };
  }

  // ---------- render ----------
  function render() {
    if (currentTab === "feed") renderFeed();
    if (currentTab === "map") renderMap();
    if (currentTab === "friends") renderFriends();
  }

  renderViewAs();
  render();
  // Keep "12m ago" labels fresh.
  setInterval(() => { if (currentTab === "feed") renderFeed(); }, 60000);
})();
