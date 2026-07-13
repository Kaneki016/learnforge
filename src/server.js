import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scopeTopic, planCurriculum, writeModuleNotes, writeModuleExercises, clarifyNote } from "./agents.js";
import {
  writeVault,
  vaultPath,
  listTopics,
  searchVault,
  readNote,
  deleteEntry,
  findSimilarTopics,
  appendClarification,
  toggleConcept,
  getGraph,
  getAllConceptNames,
} from "./vault.js";
import { reviewStatus, gradeCard } from "./review.js";
import { providerLabel } from "./providers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "..", "public")));

app.get("/api/info", (_req, res) => {
  res.json({ provider: providerLabel(), vault: vaultPath() });
});

// ---------- learn pipeline ----------

// Step 1: scope check — also reports similar topics already in the knowledge base.
app.post("/api/scope", async (req, res) => {
  try {
    const topic = String(req.body.topic || "").trim();
    if (!topic) return res.status(400).json({ error: "Topic is required" });
    const existing = findSimilarTopics(topic);
    const scope = await scopeTopic(topic);
    res.json({ ...scope, existing });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Step 2: full pipeline with live progress over SSE.
app.post("/api/generate", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  const send = (event, data) =>
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  try {
    const topic = String(req.body.topic || "").trim();
    const answers = Array.isArray(req.body.answers) ? req.body.answers : [];
    if (!topic) throw new Error("Topic is required");

    send("status", { msg: "Researching topic and designing your learning path…" });
    const plan = await planCurriculum(topic, answers);
    send("outline", plan);

    // Cross-topic linking: let the notes agent link to concepts already in the vault.
    const existingConcepts = getAllConceptNames().slice(0, 150);
    const allConcepts = [...plan.modules.flatMap((m) => m.concepts), ...existingConcepts];
    const notesByModule = [];
    const exercisesByModule = [];
    for (const [i, module] of plan.modules.entries()) {
      send("status", {
        msg: `Writing notes — module ${i + 1}/${plan.modules.length}: ${module.name}`,
        module: i,
      });
      try {
        notesByModule[i] = await writeModuleNotes(topic, module, allConcepts);
      } catch (e) {
        notesByModule[i] = [];
        send("warn", { msg: `Module "${module.name}" notes failed: ${e.message}` });
      }
      send("moduleDone", { module: i, count: notesByModule[i].length });

      send("status", {
        msg: `Designing practice exercises — module ${i + 1}/${plan.modules.length}: ${module.name}`,
        module: i,
      });
      try {
        exercisesByModule[i] = await writeModuleExercises(topic, module);
      } catch (e) {
        exercisesByModule[i] = null;
        send("warn", { msg: `Module "${module.name}" exercises failed: ${e.message}` });
      }
      send("exercisesDone", { module: i, count: exercisesByModule[i]?.length || 0 });
    }

    send("status", { msg: "Writing notes into your Obsidian vault…" });
    const result = writeVault(topic, plan, notesByModule, existingConcepts, exercisesByModule);
    send("done", {
      vault: vaultPath(),
      topicDir: result.topicDir,
      noteCount: result.files.length,
      moc: path.basename(result.mocFile, ".md"),
    });
  } catch (e) {
    send("error", { msg: e.message });
  } finally {
    res.end();
  }
});

// ---------- library ----------

app.get("/api/topics", (_req, res) => {
  try {
    res.json({ topics: listTopics() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/search", (req, res) => {
  try {
    res.json({ results: searchVault(String(req.query.q || "")) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/note", (req, res) => {
  try {
    const rel = String(req.query.path || "");
    res.json({ path: rel, content: readNote(rel) });
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

// Ask the agent a follow-up about a note; the Q&A is appended to the note.
app.post("/api/ask", async (req, res) => {
  try {
    const rel = String(req.body.path || "");
    const question = String(req.body.question || "").trim();
    if (!question) return res.status(400).json({ error: "Question is required" });
    const note = readNote(rel);
    const answer = await clarifyNote(note, question);
    appendClarification(rel, question, answer);
    res.json({ answer, content: readNote(rel) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Toggle a roadmap checkbox: { moc, concept, done }
app.post("/api/progress", (req, res) => {
  try {
    res.json(toggleConcept(String(req.body.moc || ""), String(req.body.concept || ""), !!req.body.done));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Knowledge graph (nodes + wikilink edges) for the whole vault.
app.get("/api/graph", (_req, res) => {
  try {
    res.json(getGraph());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Spaced repetition: due cards + grading.
app.get("/api/review/due", (_req, res) => {
  try {
    res.json(reviewStatus());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/review/grade", (req, res) => {
  try {
    res.json(gradeCard(String(req.body.id || ""), String(req.body.grade || "")));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Delete a note (file) or a whole topic (folder).
app.post("/api/delete", (req, res) => {
  try {
    res.json(deleteEntry(String(req.body.path || "")));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const port = Number(process.env.PORT || 3210);
app.listen(port, () => {
  console.log(`LearnForge running → http://localhost:${port}`);
  console.log(`Provider: ${providerLabel()} · Vault: ${vaultPath()}`);
});
