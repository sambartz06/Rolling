/* Rolling: web prototype.
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
  function avatar(u, cls = "") {
    return `<div class="avatar ${cls}" style="background:${u.color}">${esc(u.name[0])}</div>`;
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
  $("#postBtn").addEventListener("click", () => openComposer());

  // ---------- view-as switcher (stand-in for sign-in) ----------
  function renderViewAs() {
    $("#viewAs").innerHTML = state.users.map((u) => `<option value="${u.id}" ${u.id === state.me ? "selected" : ""}>${esc(u.name)}</option>`).join("");
  }
  $("#viewAs").addEventListener("change", (e) => { state.me = e.target.value; save(); render(); });
  function renderBadge() {
    const n = incoming().length;
    const b = $("#reqBadge");
    b.textContent = n;
    b.classList.toggle("hidden", !n);
  }

  // ---------- feed ----------
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
        <div class="label">You're rolling to</div>
        <div class="bar">${esc(b.name)}</div>
        ${postDetails(mine)}
        <div style="margin-top:12px"><button class="btn small" id="editMine">Change tonight's post</button></div>
      </div>`;
    } else {
      html += `<div class="card mine">
        <div class="label">Tonight</div>
        <div class="bar">Where are you rolling?</div>
        <div class="sub small">One post a night. Your friends see it in their feed and on the map.</div>
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
            ${postDetails(p)}
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
      <h3>Where are you rolling tonight?</h3>
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

      <label class="field-label" for="hype">Excitement</label>
      <div class="hype">
        <input type="range" id="hype" min="0" max="100" step="1" value="${draft.excitement}" />
        <div class="hype-ends"><span>Low</span><b id="hypeLabel"></b><span>High</span></div>
      </div>

      <label class="field-label" for="arrive">Getting there around</label>
      <select id="arrive" class="select">${TIMES.map((t) => `<option value="${t}" ${t === draft.arrive ? "selected" : ""}>${fmtTime(t)}</option>`).join("")}</select>

      <label class="field-label" for="comment">What's the move?</label>
      <textarea class="comment" id="comment" placeholder="Pregame plans, a birthday, a drink special… give your friends a reason to pull up.">${esc(draft.comment || "")}</textarea>
      <div class="small counter" id="cc"></div>

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
      state.posts = state.posts.filter((p) => !(p.userId === state.me && nightKey(p.at) === tonight()));
      state.posts.push({ userId: state.me, barId: draft.barId, at: Date.now(), excitement: draft.excitement, arrive: draft.arrive, comment: draft.comment.trim() });
      save();
      closeSheet();
      toast("You're rolling to " + b.name);
      render();
    };
  }

  // ---------- map ----------
  let map, barLayer, countLayer, showAllBars = false, fittedFor = null;
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

  function renderMap() {
    initMap();
    barLayer.clearLayers();
    countLayer.clearLayers();
    const by = goersByBar();
    const mine = myPost();

    if (showAllBars) {
      for (const b of BARS) {
        if (by[b.id]) continue;
        L.marker([b.lat, b.lon], { icon: L.divIcon({ className: "", html: '<div class="bar-dot"></div>', iconSize: [12, 12] }) })
          .on("click", () => openBar(b.id)).addTo(barLayer);
      }
    }
    for (const [barId, posts] of Object.entries(by)) {
      const b = BAR_BY_ID[barId];
      const isMine = mine && mine.barId === barId;
      const friendsHere = posts.filter((p) => p.userId !== state.me).length;
      const label = friendsHere ? friendsHere : "You";
      L.marker([b.lat, b.lon], {
        icon: L.divIcon({ className: "", html: `<div class="count-marker ${isMine ? "me" : ""} ${friendsHere ? "" : "only-me"}">${label}</div>`, iconSize: [40, 40], iconAnchor: [20, 20] }),
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

  // Tap a bar on the map: who's going, how hyped, and when they'll get there.
  function openBar(barId) {
    const b = BAR_BY_ID[barId];
    const posts = (goersByBar()[barId] || []).slice().sort((x, y) => timeKey(x.arrive) - timeKey(y.arrive));
    const avg = posts.length ? Math.round(posts.reduce((a, p) => a + p.excitement, 0) / posts.length) : null;
    const mine = myPost();
    openSheet(`
      <h3>${esc(b.name)}</h3>
      <div class="sub">${esc(b.addr || b.type)}${posts.length ? ` · ${posts.length} going tonight` : ""}</div>
      ${avg !== null ? `<div class="field-label">Group excitement</div>${meter(avg)}` : ""}
      <div class="goers">${posts.length ? posts.map((p) => {
        const u = user(p.userId);
        return `<div class="g">${avatar(u, "sm")}<div class="g-body">
          <div><b>${u.id === state.me ? "You" : esc(u.name)}</b> <span class="sub small">· ~${fmtTime(p.arrive)}</span></div>
          ${meter(p.excitement, true)}
          ${p.comment ? `<div class="small g-comment">${esc(p.comment)}</div>` : ""}
        </div></div>`;
      }).join("") : `<div class="empty" style="padding:14px">No friends here yet tonight.</div>`}</div>
      <div class="sheet-actions">
        <button class="btn" id="closeBar">Close</button>
        ${mine && mine.barId === barId ? "" : `<button class="btn primary" id="rollHere">I'm rolling here</button>`}
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
    const friends = [...f].map(user).sort((a, b) => a.name.localeCompare(b.name));
    const others = state.users.filter((u) => u.id !== state.me && !f.has(u.id) && !gotFrom.has(u.id));
    const mutuals = (uid) => [...friendIds(uid)].filter((x) => f.has(x)).length;
    const person = (u, sub, actions) => `
      <div class="person" data-name="${esc((u.name + " " + u.handle).toLowerCase())}">${avatar(u)}
        <div class="meta"><div class="n">${esc(u.name)}</div><div class="h">@${esc(u.handle)}${sub ? " · " + sub : ""}</div></div>
        <div class="actions">${actions}</div></div>`;

    el.innerHTML = `
      ${inc.length ? `<h2>Friend requests · ${inc.length}</h2>
      <div class="card list">${inc.map((r) => person(user(r.from), ago(r.at),
        `<button class="btn small" data-decline="${r.from}">Decline</button><button class="btn small primary" data-accept="${r.from}">Accept</button>`)).join("")}</div>` : ""}

      <h2>Find people</h2>
      <input class="search" id="friendSearch" placeholder="Search by name or @handle" autocomplete="off" />
      <div class="card list" id="addList" style="margin-top:10px">${others.length ? others.map((u) => person(u,
        mutuals(u.id) ? mutuals(u.id) + " mutual" : "",
        sentTo.has(u.id)
          ? `<button class="btn small" data-cancel="${u.id}">Requested</button>`
          : `<button class="btn small primary" data-request="${u.id}">Add friend</button>`)).join("")
        : `<div class="sub small">You're friends with everyone in the demo.</div>`}</div>

      <h2>Your friends · ${friends.length}</h2>
      <div class="card list">${friends.length ? friends.map((u) => person(u, "",
        `<button class="btn small ghost" data-remove="${u.id}">Remove</button>`)).join("")
        : `<div class="sub small">No friends yet. Send some requests above.</div>`}</div>

      <h2>Demo</h2>
      <div class="sub small" style="margin-bottom:10px">There's no sign-in yet. Use "Viewing as" at the top to be someone else, for example to accept a request you sent. Everything is saved in this browser only.</div>
      <button class="btn small" id="resetDemo">Reset demo data</button>`;

    const on = (attr, fn) => el.querySelectorAll(`[data-${attr}]`).forEach((b) => b.onclick = () => fn(b.dataset[attr]));
    on("request", (id) => { state.requests.push({ from: state.me, to: id, at: Date.now() }); save(); toast("Request sent to " + user(id).name); render(); });
    on("cancel", (id) => { state.requests = state.requests.filter((r) => !(r.from === state.me && r.to === id)); save(); toast("Request canceled"); render(); });
    on("accept", (id) => {
      state.requests = state.requests.filter((r) => !((r.from === id && r.to === state.me) || (r.from === state.me && r.to === id)));
      state.friendships.push([state.me, id]); save();
      toast("You and " + user(id).name + " are now friends"); render();
    });
    on("decline", (id) => { state.requests = state.requests.filter((r) => !(r.from === id && r.to === state.me)); save(); render(); });
    on("remove", (id) => {
      state.friendships = state.friendships.filter(([x, y]) => !((x === state.me && y === id) || (y === state.me && x === id)));
      save(); render();
    });
    $("#friendSearch", el).addEventListener("input", (e) => {
      const q = e.target.value.trim().toLowerCase().replace(/^@/, "");
      $("#addList", el).querySelectorAll(".person").forEach((p) => p.classList.toggle("hidden", !!q && !p.dataset.name.includes(q)));
    });
    $("#resetDemo", el).onclick = () => { state = window.ROLLING_SEED(); save(); renderViewAs(); fittedFor = null; render(); toast("Demo data reset"); };
  }

  // ---------- render ----------
  function render() {
    renderBadge();
    if (currentTab === "feed") renderFeed();
    if (currentTab === "map") renderMap();
    if (currentTab === "friends") renderFriends();
  }

  renderViewAs();
  render();
  // Keep "12m ago" labels fresh.
  setInterval(() => { if (currentTab === "feed") renderFeed(); }, 60000);
})();
