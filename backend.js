/* Word backend: talks to Supabase (hosted database + sign-in).
 * If config.js has no Supabase keys, `live` is false and app.js runs the old
 * browser-only demo instead. Everything here returns data in the same shapes
 * the app already uses (users, friendships, requests, posts, replies...).
 * Who can read or change what is enforced in the database (supabase/schema.sql),
 * not here. */
window.WordBackend = (function () {
  "use strict";
  const cfg = window.WORD_CONFIG || {};
  if (!cfg.supabaseUrl || !cfg.supabaseKey || !window.supabase) return { live: false };

  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  const DAY = 24 * 3600 * 1000;
  const ms = (t) => new Date(t).getTime();
  const iso = (t) => new Date(t).toISOString();
  const ok = ({ data, error }) => { if (error) throw error; return data; };
  // Where email links (password reset, confirm email) send people back to.
  const here = () => location.origin + location.pathname;

  const toPost = (r) => ({
    id: r.id, userId: r.user_id, barId: r.bar_id, at: ms(r.posted_at), night: r.night,
    excitement: r.excitement, arrive: r.arrive, comment: r.comment || "", history: r.history || [],
  });

  // ---------- account ----------
  const auth = {
    session: async () => ok(await sb.auth.getSession()).session,
    onChange: (fn) => sb.auth.onAuthStateChange((event, session) => fn(event, session)),
    signIn: async (email, password) => ok(await sb.auth.signInWithPassword({ email, password })),
    signUp: async ({ email, password, name, handle }) =>
      ok(await sb.auth.signUp({ email, password, options: { data: { name, handle }, emailRedirectTo: here() } })),
    signOut: async () => ok(await sb.auth.signOut()),
    sendReset: async (email) => ok(await sb.auth.resetPasswordForEmail(email, { redirectTo: here() })),
    setPassword: async (password) => ok(await sb.auth.updateUser({ password })),
    handleAvailable: async (handle) => ok(await sb.rpc("handle_available", { h: handle })),
  };

  // ---------- read everything this person is allowed to see ----------
  // Small friend group, so we load it all at once and refresh every so often.
  async function loadAll(me) {
    const since = iso(Date.now() - 120 * DAY);
    const [profiles, friendships, requests, posts, replies, favs, settings, pop] = await Promise.all([
      sb.from("profiles").select("id,name,handle").limit(5000),
      sb.from("friendships").select("a,b,requested_by,created_at"),
      sb.from("friend_requests").select("from_id,to_id,created_at"),
      // Friends' posts from the last 4 months (map + popularity), plus all of mine (profile stats).
      sb.from("posts").select("*").or(`posted_at.gte."${since}",user_id.eq.${me}`).order("posted_at", { ascending: false }).limit(5000),
      sb.from("replies").select("id,post_id,user_id,text,created_at").gte("created_at", iso(Date.now() - 3 * DAY)).limit(5000),
      sb.from("favorites").select("friend"),
      sb.from("user_settings").select("prefs").maybeSingle(),
      sb.rpc("bar_popularity"),
    ].map((q) => q.then(ok)));
    return {
      me,
      users: profiles,
      friendships: friendships.map((f) => [f.a, f.b, { by: f.requested_by, at: ms(f.created_at) }]),
      requests: requests.map((r) => ({ from: r.from_id, to: r.to_id, at: ms(r.created_at) })),
      posts: posts.map(toPost),
      replies: replies.map((r) => ({ id: r.id, post: r.post_id, userId: r.user_id, text: r.text, at: ms(r.created_at) })),
      favorites: { [me]: favs.map((f) => f.friend) },
      settings: { [me]: (settings && settings.prefs) || {} },
      popularity: Object.fromEntries(pop.map((p) => [p.bar_id, { score: p.score, month: p.month_count }])),
    };
  }

  // ---------- writes ----------
  const api = {
    // Tonight's post. Same id all night, so replies stay attached when you switch bars.
    savePost: async (p) => ok(await sb.from("posts").upsert({
      id: p.id, night: p.night, bar_id: p.barId, arrive: p.arrive, excitement: p.excitement,
      comment: p.comment, history: p.history || [], posted_at: iso(p.at),
    }, { onConflict: "id" })),
    addReply: async (r) => ok(await sb.from("replies").insert({ id: r.id, post_id: r.post, text: r.text })),
    sendRequest: async (to) => ok(await sb.from("friend_requests").insert({ to_id: to })),
    deleteRequest: async (from, to) => ok(await sb.from("friend_requests").delete().eq("from_id", from).eq("to_id", to)),
    accept: async (from) => ok(await sb.rpc("accept_friend_request", { requester: from })),
    unfriend: async (me, other) => ok(await sb.from("friendships").delete()
      .eq("a", me < other ? me : other).eq("b", me < other ? other : me)),
    setFavorite: async (friend, on) => on
      ? ok(await sb.from("favorites").upsert({ friend }, { onConflict: "owner,friend", ignoreDuplicates: true }))
      : ok(await sb.from("favorites").delete().eq("friend", friend)),
    saveSettings: async (me, prefs) => ok(await sb.from("user_settings").upsert({ user_id: me, prefs, updated_at: iso(Date.now()) })),
    updateProfile: async (me, name, handle) => ok(await sb.from("profiles").update({ name, handle }).eq("id", me)),
  };

  return Object.assign({ live: true, auth, loadAll }, api);
})();
