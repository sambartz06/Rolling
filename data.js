// Mock users, friendships and tonight's posts so the prototype is demoable
// before sign-in and a real backend exist. Everything is saved in the browser
// (localStorage). "Reset demo" in the Friends tab restores this seed.

window.ROLLING_CATEGORIES = [
  { key: "vibe",   label: "Vibe",   emoji: "✨" },
  { key: "crowd",  label: "Crowd",  emoji: "👥" },
  { key: "drinks", label: "Drinks", emoji: "🍺" },
  { key: "music",  label: "Music",  emoji: "🎶" },
];

window.ROLLING_SEED = function seed() {
  const users = [
    { id: "u_sam",    name: "Sam",    handle: "sam",    color: "#ff5c8a" },
    { id: "u_jake",   name: "Jake",   handle: "jakeb",  color: "#5cc8ff" },
    { id: "u_maddie", name: "Maddie", handle: "madds",  color: "#ffb84d" },
    { id: "u_tyler",  name: "Tyler",  handle: "ty",     color: "#7dff9b" },
    { id: "u_emma",   name: "Emma",   handle: "emmak",  color: "#c58cff" },
    { id: "u_ryan",   name: "Ryan",   handle: "ryguy",  color: "#ff7b5c" },
    { id: "u_olivia", name: "Olivia", handle: "liv",    color: "#5cffe1" },
    { id: "u_nick",   name: "Nick",   handle: "nickp",  color: "#ffe45c" },
    { id: "u_grace",  name: "Grace",  handle: "gracie", color: "#ff8ce0" },
    { id: "u_ben",    name: "Ben",    handle: "benw",   color: "#8ca8ff" },
    { id: "u_hannah", name: "Hannah", handle: "hannah", color: "#b4ff5c" },
  ];

  // Sam starts with 7 friends; Grace, Ben and Hannah are there to try "Add friend".
  const friendships = [
    ["u_sam", "u_jake"], ["u_sam", "u_maddie"], ["u_sam", "u_tyler"], ["u_sam", "u_emma"],
    ["u_sam", "u_ryan"], ["u_sam", "u_olivia"], ["u_sam", "u_nick"],
    ["u_jake", "u_tyler"], ["u_maddie", "u_emma"], ["u_grace", "u_ben"], ["u_hannah", "u_olivia"],
  ];

  const now = Date.now();
  const minsAgo = (m) => now - m * 60 * 1000;
  const posts = [
    { userId: "u_jake",   barId: "n1182263550", at: minsAgo(12),  ratings: { vibe: 5, crowd: 4, drinks: 3, music: 4 }, comment: "KK till close, who's in" },
    { userId: "u_tyler",  barId: "n1182263550", at: minsAgo(25),  ratings: { vibe: 4, crowd: 5, drinks: 3, music: 3 }, comment: "" },
    { userId: "u_maddie", barId: "n2522523790", at: minsAgo(40),  ratings: { vibe: 4, crowd: 3, drinks: 4, music: 5 }, comment: "Shamrock then maybe Plaza" },
    { userId: "u_emma",   barId: "n2522523790", at: minsAgo(55),  ratings: { vibe: 5, crowd: 4, drinks: 4, music: 4 }, comment: "girls night 💃" },
    { userId: "u_ryan",   barId: "n1182056217", at: minsAgo(70),  ratings: { vibe: 3, crowd: 4, drinks: 4, music: 2 }, comment: "chill one tonight" },
    { userId: "u_olivia", barId: "n1182263550", at: minsAgo(95),  ratings: { vibe: 4, crowd: 4, drinks: 2, music: 4 }, comment: "" },
    { userId: "u_grace",  barId: "w1441672606", at: minsAgo(30),  ratings: { vibe: 4, crowd: 3, drinks: 4, music: 3 }, comment: "not your friend yet, so you shouldn't see me" },
    { userId: "u_ben",    barId: "n7216954964", at: minsAgo(50),  ratings: { vibe: 3, crowd: 3, drinks: 4, music: 3 }, comment: "" },
  ];

  return { me: "u_sam", users, friendships, posts, version: 1 };
};
