// Spaced repetition over the Q&A pairs embedded in every concept note.
// Card schedule state lives in vault/.learnforge/review.json (dot-folder, hidden in Obsidian).
// Simplified SM-2: grades are "again" | "hard" | "good" | "easy".

import fs from "node:fs";
import path from "node:path";
import { vaultPath, collectCards } from "./vault.js";

function storeFile() {
  return path.join(vaultPath(), ".learnforge", "review.json");
}

function loadStore() {
  try {
    return JSON.parse(fs.readFileSync(storeFile(), "utf8"));
  } catch {
    return {};
  }
}

function saveStore(store) {
  fs.mkdirSync(path.dirname(storeFile()), { recursive: true });
  fs.writeFileSync(storeFile(), JSON.stringify(store, null, 2), "utf8");
}

function nextState(prev, grade) {
  let { ease = 2.5, interval = 0, reps = 0 } = prev || {};
  if (grade === "again") {
    reps = 0;
    interval = 0; // due again immediately (same session)
    ease = Math.max(1.3, ease - 0.2);
  } else if (grade === "hard") {
    interval = Math.max(1, Math.round(interval * 1.2) || 1);
    ease = Math.max(1.3, ease - 0.15);
    reps += 1;
  } else if (grade === "easy") {
    interval = reps === 0 ? 3 : Math.round(interval * ease * 1.3);
    ease += 0.15;
    reps += 1;
  } else {
    // good
    interval = reps === 0 ? 1 : Math.round(interval * ease);
    reps += 1;
  }
  const due = new Date(Date.now() + interval * 86400000).toISOString();
  return { ease: Number(ease.toFixed(2)), interval, reps, due };
}

export function reviewStatus() {
  const cards = collectCards();
  const store = loadStore();
  const now = new Date().toISOString();
  const due = cards.filter((c) => {
    const s = store[c.id];
    return !s || s.due <= now;
  });
  return { totalCards: cards.length, due };
}

export function gradeCard(cardId, grade) {
  if (!["again", "hard", "good", "easy"].includes(grade)) {
    throw new Error("Grade must be again|hard|good|easy");
  }
  const store = loadStore();
  store[cardId] = nextState(store[cardId], grade);
  // Prune schedule entries whose notes no longer exist.
  const liveIds = new Set(collectCards().map((c) => c.id));
  for (const id of Object.keys(store)) if (!liveIds.has(id)) delete store[id];
  saveStore(store);
  return store[cardId];
}
