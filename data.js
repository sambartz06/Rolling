// Mock users, friendships, friend requests and post history so the prototype is
// demoable before sign-in and a real backend exist. Everything is saved in the
// browser (localStorage). "Reset demo data" in the Friends tab restores this seed.

window.ROLLING_SEED = function seed() {
  const users = [
    { id: "u_sam",    name: "Sam",    handle: "sam",    color: "#C5050C" },
    { id: "u_jake",   name: "Jake",   handle: "jakeb",  color: "#2f6fb5" },
    { id: "u_maddie", name: "Maddie", handle: "madds",  color: "#d97a00" },
    { id: "u_tyler",  name: "Tyler",  handle: "ty",     color: "#2f8f4e" },
    { id: "u_emma",   name: "Emma",   handle: "emmak",  color: "#7b4fc2" },
    { id: "u_ryan",   name: "Ryan",   handle: "ryguy",  color: "#b5462f" },
    { id: "u_olivia", name: "Olivia", handle: "liv",    color: "#1c8c8c" },
    { id: "u_nick",   name: "Nick",   handle: "nickp",  color: "#8a6d00" },
    { id: "u_grace",  name: "Grace",  handle: "gracie", color: "#c2407e" },
    { id: "u_ben",    name: "Ben",    handle: "benw",   color: "#4a5bc2" },
    { id: "u_hannah", name: "Hannah", handle: "hannah", color: "#5f8f1c" },
  ];

  // Sam starts with 7 friends. Hannah has sent Sam a request, Sam has a pending
  // request out to Ben, and Grace is a stranger you can send a request to.
  const friendships = [
    ["u_sam", "u_jake"], ["u_sam", "u_maddie"], ["u_sam", "u_tyler"], ["u_sam", "u_emma"],
    ["u_sam", "u_ryan"], ["u_sam", "u_olivia"], ["u_sam", "u_nick"],
    ["u_jake", "u_tyler"], ["u_maddie", "u_emma"], ["u_grace", "u_ben"], ["u_hannah", "u_olivia"],
  ];
  const now = Date.now();
  const minsAgo = (m) => now - m * 60 * 1000;
  const requests = [
    { from: "u_hannah", to: "u_sam", at: minsAgo(180) },
    { from: "u_sam", to: "u_ben", at: minsAgo(60 * 26) },
  ];

  // Tonight's posts. excitement is 0-100, arrive is "HH:MM" (24h).
  const posts = [
    { userId: "u_jake",   barId: "n1182263550", at: minsAgo(12), excitement: 92, arrive: "22:30", comment: "KK till close, who's in" },
    { userId: "u_tyler",  barId: "n1182263550", at: minsAgo(25), excitement: 74, arrive: "23:00", comment: "" },
    { userId: "u_maddie", barId: "w1441901386", at: minsAgo(40), excitement: 80, arrive: "22:00", comment: "Mondays then maybe Chasers" },
    { userId: "u_emma",   barId: "w1441901386", at: minsAgo(55), excitement: 88, arrive: "22:00", comment: "girls night 💃" },
    { userId: "u_ryan",   barId: "n1182056217", at: minsAgo(70), excitement: 41, arrive: "21:30", comment: "chill one tonight" },
    { userId: "u_olivia", barId: "n1182263550", at: minsAgo(95), excitement: 65, arrive: "23:30", comment: "" },
    { userId: "u_grace",  barId: "w1441672606", at: minsAgo(30), excitement: 70, arrive: "22:15", comment: "" },
    { userId: "u_ben",    barId: "n7216954964", at: minsAgo(50), excitement: 55, arrive: "22:45", comment: "" },
    // Nick can't decide. Each earlier pick tonight is kept in history.
    { userId: "u_nick", barId: "n1182263550", at: minsAgo(4), excitement: 97, arrive: "23:30", comment: "ok THIS is the one. final answer",
      history: [
        ["w1441901386", 150, 60, "mondays for sure"], ["w875584137", 132, 45, "actually wando's, fishbowls"],
        ["n2522840399", 118, 70, ""], ["n4184659489", 101, 30, "lowkey just want a burger"],
        ["n8949860975", 84, 85, "red shed or bust"], ["w875584136", 61, 50, ""],
        ["n4479808708", 37, 75, "double u, trust me"], ["w1441672606", 19, 90, "ok mackesey's is the move"],
      ].map(([barId, m, excitement, comment]) => ({ barId, at: minsAgo(m), excitement, arrive: "22:30", comment })) },
  ];

  // ~8 weeks of past posts from everyone, so "popular" has history to rank on.
  // Deterministic, so every reset produces the same history.
  let s = 7;
  const rand = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  const favorites = [
    ["n1182263550", 14], ["w1441901386", 11], ["n2522840399", 9], ["n4184659489", 8],
    ["n8949860975", 7], ["w875584137", 7], ["n4479808708", 6], ["w875584136", 5],
    ["w1441672606", 5], ["n1182056217", 4], ["n7216954964", 4], ["n2522817555", 3],
    ["n12112935176", 3], ["w1435231298", 3], ["n2522840414", 2], ["n2424444561", 2],
    ["n5642308355", 2], ["n2968974531", 2], ["w369451920", 2], ["n13130307635", 2],
  ];
  const total = favorites.reduce((a, [, w]) => a + w, 0);
  const pick = () => { let r = rand() * total; for (const [id, w] of favorites) { if ((r -= w) <= 0) return id; } return favorites[0][0]; };
  const day = 24 * 3600 * 1000;
  for (let d = 1; d <= 56; d++) {
    const weekday = new Date(now - d * day).getDay(); // busier Thu-Sat
    const goers = [4, 5, 6].includes(weekday) ? 0.7 : 0.25;
    for (const u of users) {
      if (rand() < goers) {
        posts.push({ userId: u.id, barId: pick(), at: now - d * day, excitement: Math.round(30 + rand() * 70), arrive: "22:00", comment: "" });
      }
    }
  }

  return { me: "u_sam", users, friendships, requests, posts, version: 2 };
};
