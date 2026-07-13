// Writes and manages the Obsidian vault: linked markdown notes, topic library,
// search, deletion, and clarification appends.
//
// Vault layout per topic:
//   vault/
//     Home.md                          <- index of all topics (auto-updated)
//     <Topic>/
//       <Topic> MOC.md                 <- map of content / learning roadmap
//       <Concept>.md                   <- one atomic note per concept

import fs from "node:fs";
import path from "node:path";

export function vaultPath() {
  return path.resolve(process.env.VAULT_PATH || "./vault");
}

export function safeName(name) {
  // Obsidian-safe file/link name (also strips Windows-illegal chars).
  return name
    .replace(/[\\/:*?"<>|#^[\]]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

// Resolve a vault-relative path and refuse anything that escapes the vault.
function resolveInVault(rel) {
  const root = vaultPath();
  const abs = path.resolve(root, rel);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new Error("Path escapes the vault");
  }
  return abs;
}

function toRel(abs) {
  return path.relative(vaultPath(), abs).split(path.sep).join("/");
}

function fm(obj) {
  const lines = Object.entries(obj).map(([k, v]) =>
    Array.isArray(v) ? `${k}:\n${v.map((x) => `  - ${x}`).join("\n")}` : `${k}: ${v}`
  );
  return `---\n${lines.join("\n")}\n---\n`;
}

function tagify(s) {
  return safeName(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// Basic sanity check so a malformed LLM diagram never breaks a note.
const MERMAID_TYPES = /^(flowchart|graph|sequenceDiagram|mindmap|classDiagram|stateDiagram|erDiagram|timeline|pie)/;
function mermaidBlock(diagram) {
  const d = (diagram || "").trim();
  if (!d || !MERMAID_TYPES.test(d)) return [];
  return ["## Diagram", "", "```mermaid", d, "```", ""];
}

function mermaidLabel(s) {
  // Mermaid labels: keep them quote/paren/bracket-free.
  return safeName(s).replace(/["'()[\]{}]/g, "").slice(0, 40);
}

// Deterministic roadmap flowchart for the MOC.
function roadmapDiagram(plan) {
  const lines = ["flowchart TD"];
  if (plan.prerequisites?.length) {
    lines.push(`  P["Prerequisites: ${mermaidLabel(plan.prerequisites.join(", "))}"]`);
  }
  plan.modules.forEach((m, i) => {
    const id = `M${i + 1}`;
    lines.push(`  subgraph ${id}["Module ${i + 1}: ${mermaidLabel(m.name)}"]`);
    lines.push("    direction TB");
    const ids = m.concepts.map((c, j) => {
      lines.push(`    ${id}c${j}["${mermaidLabel(c)}"]`);
      return `${id}c${j}`;
    });
    for (let j = 0; j + 1 < ids.length; j++) lines.push(`    ${ids[j]} --> ${ids[j + 1]}`);
    lines.push("  end");
  });
  if (plan.prerequisites?.length && plan.modules.length) lines.push("  P --> M1");
  for (let i = 1; i < plan.modules.length; i++) lines.push(`  M${i} --> M${i + 1}`);
  return lines.join("\n");
}

// ---------- writing a new topic ----------

export function writeVault(topic, plan, notesByModule, extraLinkable = [], exercisesByModule = []) {
  const root = vaultPath();
  const topicName = safeName(plan.title || topic);
  const topicDir = path.join(root, topicName);
  fs.mkdirSync(topicDir, { recursive: true });

  const today = new Date().toISOString().slice(0, 10);
  const topicTag = tagify(topic);
  const files = [];

  // --- concept notes ---
  const conceptNames = plan.modules.flatMap((m) => m.concepts.map(safeName));
  const linkable = new Set([...conceptNames, ...extraLinkable.map(safeName)]);
  for (const [mi, module] of plan.modules.entries()) {
    const notes = notesByModule[mi] || [];
    for (const note of notes) {
      const name = safeName(note.concept);
      const related = (note.related || [])
        .map(safeName)
        .filter((r) => r !== name && linkable.has(r));
      const body = [
        fm({
          tags: [`topic/${topicTag}`, `module/${tagify(module.name)}`, "concept"],
          topic: `"[[${topicName} MOC]]"`,
          created: today,
        }),
        `# ${name}`,
        "",
        `> [!info] Part of [[${topicName} MOC]] · Module ${mi + 1}: ${module.name}`,
        "",
        note.explanation || "",
        "",
        "## Key points",
        "",
        ...(note.keyPoints || []).map((k) => `- ${k}`),
        "",
        ...mermaidBlock(note.diagram),
        "## Related concepts",
        "",
        ...(related.length ? related.map((r) => `- [[${r}]]`) : ["- (none)"]),
        "",
        "## Review",
        "",
        ...(note.review || []).flatMap((r) => [`**Q:** ${r.q}`, `**A:** ${r.a}`, ""]),
      ].join("\n");
      const file = path.join(topicDir, `${name}.md`);
      fs.writeFileSync(file, body, "utf8");
      files.push(file);
    }

    // --- exercises note for this module (only when the agent deemed it practicable) ---
    const exs = exercisesByModule[mi];
    if (exs && exs.length) {
      const exName = safeName(`${module.name} — Exercises`);
      const quote = (s) => String(s).replace(/\n/g, "\n> ");
      const exLines = [
        fm({
          tags: [`topic/${topicTag}`, `module/${tagify(module.name)}`, "exercises"],
          topic: `"[[${topicName} MOC]]"`,
          created: today,
        }),
        `# ${exName}`,
        "",
        `> [!info] Practice for [[${topicName} MOC]] · Module ${mi + 1}: ${module.name}`,
        "",
      ];
      exs.forEach((ex, i) => {
        exLines.push(`## ${i + 1}. ${safeName(ex.title || "Exercise")} · *${ex.difficulty || "medium"}*`, "", ex.task || "", "");
        (ex.hints || []).forEach((h, j) => exLines.push(`> [!question]- Hint ${j + 1}`, `> ${quote(h)}`, ""));
        if (ex.solution) exLines.push(`> [!success]- Solution / success criteria`, `> ${quote(ex.solution)}`, "");
      });
      exLines.push("💬 *Tip: in the app, paste your attempt into the \"Ask the agent\" box below for feedback.*");
      const exFile = path.join(topicDir, `${exName}.md`);
      fs.writeFileSync(exFile, exLines.join("\n"), "utf8");
      files.push(exFile);
    }
  }

  // --- MOC / roadmap note ---
  const mocLines = [
    fm({ tags: [`topic/${topicTag}`, "moc"], created: today }),
    `# ${topicName} — Learning Roadmap`,
    "",
    plan.summary || "",
    "",
    "## Path at a glance",
    "",
    "```mermaid",
    roadmapDiagram(plan),
    "```",
    "",
  ];
  if (plan.prerequisites?.length) {
    mocLines.push("## Prerequisites", "", ...plan.prerequisites.map((p) => `- ${p}`), "");
  }
  for (const [mi, module] of plan.modules.entries()) {
    mocLines.push(`## Module ${mi + 1}: ${safeName(module.name)}`, "", `*${module.goal || ""}*`, "");
    mocLines.push(...module.concepts.map((c) => `- [ ] [[${safeName(c)}]]`), "");
    if (module.resources?.length) {
      mocLines.push(
        "**Resources**",
        "",
        ...module.resources.map((r) => `- *${r.type || "resource"}*: **${r.title}** — ${r.why || ""}`),
        ""
      );
    }
    if (exercisesByModule[mi]?.length) {
      mocLines.push(`**Practice**: 🛠 [[${safeName(`${module.name} — Exercises`)}]]`, "");
    }
    if (module.milestone) mocLines.push(`> [!success] Milestone: ${module.milestone}`, "");
  }
  const mocFile = path.join(topicDir, `${topicName} MOC.md`);
  fs.writeFileSync(mocFile, mocLines.join("\n"), "utf8");
  files.push(mocFile);

  // --- Home index ---
  const homeFile = path.join(root, "Home.md");
  let home = fs.existsSync(homeFile)
    ? fs.readFileSync(homeFile, "utf8")
    : `# Home\n\nEverything I'm learning, one roadmap per topic.\n\n## Topics\n`;
  const link = `- [[${topicName} MOC]] — started ${today}`;
  if (!home.includes(`[[${topicName} MOC]]`)) {
    home = home.trimEnd() + "\n" + link + "\n";
    fs.writeFileSync(homeFile, home, "utf8");
  }

  return { topicDir, files, mocFile };
}

// ---------- library: list / search / read ----------

export function listTopics() {
  const root = vaultPath();
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("."))
    .map((d) => {
      const dir = path.join(root, d.name);
      const mdFiles = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
      const mocFile = mdFiles.find((f) => f.endsWith(" MOC.md"));
      let created = "";
      let summary = "";
      let done = 0;
      let total = 0;
      if (mocFile) {
        const txt = fs.readFileSync(path.join(dir, mocFile), "utf8");
        created = (txt.match(/^created: (.+)$/m) || [])[1] || "";
        // First non-empty prose line after the H1 title.
        const afterTitle = txt.split(/^# .+$/m)[1] || "";
        summary = (afterTitle.split("\n").find((l) => l.trim() && !l.startsWith("#")) || "").trim();
        done = (txt.match(/^- \[x\] \[\[/gim) || []).length;
        total = done + (txt.match(/^- \[ \] \[\[/gm) || []).length;
      }
      return {
        name: d.name,
        created,
        summary,
        done,
        total,
        noteCount: mdFiles.length - (mocFile ? 1 : 0),
        moc: mocFile ? toRel(path.join(dir, mocFile)) : null,
      };
    })
    .sort((a, b) => (b.created || "").localeCompare(a.created || ""));
}

export function searchVault(query) {
  const q = query.toLowerCase().trim();
  if (!q) return [];
  const root = vaultPath();
  if (!fs.existsSync(root)) return [];
  const results = [];
  for (const t of listTopics()) {
    const dir = path.join(root, t.name);
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".md"))) {
      const title = f.slice(0, -3);
      const txt = fs.readFileSync(path.join(dir, f), "utf8");
      const titleHit = title.toLowerCase().includes(q);
      let snippet = "";
      const lines = txt.split("\n");
      const hitLine = lines.find(
        (l) => l.toLowerCase().includes(q) && !l.startsWith("---") && !l.startsWith("tags:")
      );
      if (hitLine) snippet = hitLine.trim().slice(0, 180);
      if (titleHit || hitLine) {
        results.push({
          topic: t.name,
          title,
          path: toRel(path.join(dir, f)),
          snippet,
          isMoc: f.endsWith(" MOC.md"),
          score: (titleHit ? 2 : 0) + (hitLine ? 1 : 0) + (f.endsWith(" MOC.md") ? 1 : 0),
        });
      }
    }
  }
  return results.sort((a, b) => b.score - a.score).slice(0, 50);
}

export function readNote(rel) {
  const abs = resolveInVault(rel);
  if (!fs.existsSync(abs) || !abs.endsWith(".md")) throw new Error("Note not found");
  return fs.readFileSync(abs, "utf8");
}

// ---------- duplicate-topic detection ----------

const STOPWORDS = new Set(["the", "and", "for", "with", "how", "what", "learn", "learning", "intro", "introduction", "basics", "guide"]);

export function findSimilarTopics(topic) {
  const words = tagify(topic).split("-").filter((w) => w.length > 2 && !STOPWORDS.has(w));
  const tLower = topic.toLowerCase().trim();
  return listTopics().filter((t) => {
    const nameLower = t.name.toLowerCase();
    if (nameLower.includes(tLower) || tLower.includes(nameLower)) return true;
    if (!words.length) return false;
    const nameWords = tagify(t.name).split("-");
    const overlap = words.filter((w) => nameWords.some((nw) => nw.includes(w) || w.includes(nw))).length;
    return overlap >= Math.ceil(words.length / 2);
  });
}

// ---------- delete ----------

export function deleteEntry(rel) {
  const abs = resolveInVault(rel);
  const root = vaultPath();
  if (abs === root) throw new Error("Refusing to delete the whole vault");
  if (!fs.existsSync(abs)) throw new Error("Not found");

  const stat = fs.statSync(abs);
  if (stat.isDirectory()) {
    // Deleting a topic: remove its line from Home.md too.
    const topicName = path.basename(abs);
    fs.rmSync(abs, { recursive: true, force: true });
    const homeFile = path.join(root, "Home.md");
    if (fs.existsSync(homeFile)) {
      const home = fs
        .readFileSync(homeFile, "utf8")
        .split("\n")
        .filter((l) => !l.includes(`[[${topicName} MOC]]`))
        .join("\n");
      fs.writeFileSync(homeFile, home, "utf8");
    }
    return { deleted: "topic", name: topicName };
  }
  fs.unlinkSync(abs);
  return { deleted: "note", name: path.basename(abs, ".md") };
}

// ---------- progress (roadmap checkboxes) ----------

export function toggleConcept(mocRel, concept, done) {
  const abs = resolveInVault(mocRel);
  let txt = fs.readFileSync(abs, "utf8");
  const c = safeName(concept);
  const from = done ? `- [ ] [[${c}]]` : `- [x] [[${c}]]`;
  const to = done ? `- [x] [[${c}]]` : `- [ ] [[${c}]]`;
  if (!txt.includes(from) && !txt.includes(to)) throw new Error("Concept not found in roadmap");
  txt = txt.replace(from, to);
  fs.writeFileSync(abs, txt, "utf8");
  const doneCount = (txt.match(/^- \[x\] \[\[/gim) || []).length;
  const total = doneCount + (txt.match(/^- \[ \] \[\[/gm) || []).length;
  return { done: doneCount, total };
}

// ---------- review cards ----------

export function collectCards() {
  const root = vaultPath();
  if (!fs.existsSync(root)) return [];
  const cards = [];
  for (const t of listTopics()) {
    const dir = path.join(root, t.name);
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".md") && !x.endsWith(" MOC.md"))) {
      const rel = toRel(path.join(dir, f));
      const txt = fs.readFileSync(path.join(dir, f), "utf8");
      // Only pairs in the Review section (not Clarifications).
      const reviewSection = (txt.split(/^## Review$/m)[1] || "").split(/^## /m)[0];
      const re = /\*\*Q:\*\* (.+)\n\*\*A:\*\* (.+)/g;
      let m;
      while ((m = re.exec(reviewSection))) {
        cards.push({
          id: Buffer.from(`${rel}::${m[1]}`).toString("base64url"),
          topic: t.name,
          note: f.slice(0, -3),
          path: rel,
          q: m[1].trim(),
          a: m[2].trim(),
        });
      }
    }
  }
  return cards;
}

// ---------- knowledge graph ----------

export function getGraph() {
  const root = vaultPath();
  if (!fs.existsSync(root)) return { nodes: [], edges: [] };
  const nodes = [];
  const byTitle = new Map(); // title -> [rel, ...]
  const contents = new Map(); // rel -> text

  for (const t of listTopics()) {
    const dir = path.join(root, t.name);
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".md"))) {
      const rel = toRel(path.join(dir, f));
      const title = f.slice(0, -3);
      nodes.push({ id: rel, label: title, topic: t.name, isMoc: f.endsWith(" MOC.md") });
      if (!byTitle.has(title)) byTitle.set(title, []);
      byTitle.get(title).push(rel);
      contents.set(rel, fs.readFileSync(path.join(dir, f), "utf8"));
    }
  }

  const edges = [];
  const seen = new Set();
  for (const [rel, txt] of contents) {
    const topicDir = rel.split("/")[0];
    for (const m of txt.matchAll(/\[\[([^\]]+)\]\]/g)) {
      const targets = byTitle.get(m[1]) || [];
      // Prefer a note in the same topic folder, otherwise first match anywhere.
      const target = targets.find((r) => r.startsWith(topicDir + "/")) || targets[0];
      if (!target || target === rel) continue;
      const key = [rel, target].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ from: rel, to: target });
    }
  }
  return { nodes, edges };
}

export function getAllConceptNames() {
  const root = vaultPath();
  if (!fs.existsSync(root)) return [];
  const names = [];
  for (const t of listTopics()) {
    const dir = path.join(root, t.name);
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".md") && !x.endsWith(" MOC.md"))) {
      names.push(f.slice(0, -3));
    }
  }
  return names;
}

// ---------- clarifications (agent comments) ----------

export function appendClarification(rel, question, answer) {
  const abs = resolveInVault(rel);
  let txt = fs.readFileSync(abs, "utf8");
  const today = new Date().toISOString().slice(0, 10);
  if (!txt.includes("\n## Clarifications")) {
    txt = txt.trimEnd() + "\n\n## Clarifications\n";
  }
  txt =
    txt.trimEnd() +
    `\n\n> [!question] ${question.replace(/\n/g, " ")} *(asked ${today})*\n\n${answer.trim()}\n`;
  fs.writeFileSync(abs, txt, "utf8");
}
