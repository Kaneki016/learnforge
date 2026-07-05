// The three agents of the pipeline:
//   1. Scope agent   – decides if the topic is too broad; asks clarifying questions
//   2. Planner agent – researches + produces a structured learning outline (JSON)
//   3. Notes agent   – writes atomic Obsidian concept notes per module (JSON)

import { callLLM } from "./providers.js";

// ---------- helpers ----------

export function extractJSON(text) {
  // Strip code fences, then find the first {...} or [...] block.
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.search(/[{[]/);
  if (start === -1) throw new Error("No JSON found in model response");
  // Try progressively from the first bracket to the last closing bracket.
  for (let end = cleaned.length; end > start; end--) {
    const candidate = cleaned.slice(start, end);
    try {
      return JSON.parse(candidate);
    } catch {
      /* keep shrinking */
    }
  }
  throw new Error("Could not parse JSON from model response");
}

// ---------- 1. Scope agent ----------

const SCOPE_SYSTEM = `You are a learning-scope analyst. A curious learner gives you a topic they want to learn.
Decide whether the topic is focused enough to build a concrete learning path (roughly a 4-10 module curriculum).

If it is TOO BROAD (e.g. "physics", "programming", "history"), produce 2-4 clarifying questions.
Each question must have 3-5 concrete example options, but the learner may also answer freely.
Questions should uncover: their goal/motivation, preferred angle or subfield, current level, and practical vs theoretical preference.

If it is focused enough, no questions are needed.

Respond ONLY with JSON:
{
  "tooBroad": true|false,
  "reason": "one sentence",
  "questions": [
    { "question": "...", "options": ["...", "..."] }
  ]
}
If tooBroad is false, "questions" must be [].`;

export async function scopeTopic(topic) {
  const text = await callLLM({
    system: SCOPE_SYSTEM,
    user: `Topic: ${topic}`,
    maxTokens: 1500,
  });
  const json = extractJSON(text);
  return {
    tooBroad: !!json.tooBroad,
    reason: json.reason || "",
    questions: Array.isArray(json.questions) ? json.questions : [],
  };
}

// ---------- 2. Planner agent ----------

const PLAN_SYSTEM = `You are an expert curriculum designer and researcher. Design a structured learning path for the learner's topic, using their scoping answers if provided.

Requirements:
- 4 to 8 modules, ordered from prerequisites/foundations to advanced/applied.
- Each module: 3 to 6 atomic concepts. A concept is one idea small enough for a single note.
- Concept names must be globally unique, specific, and noun-phrase style (they become note titles, e.g. "Bayes' Theorem", not "Learn about Bayes").
- For each module list 2-4 high-quality learning resources (books, courses, docs, videos) with a short note on why. Only include resources you are confident actually exist; prefer well-known, durable ones.
- Give each module a milestone: a concrete thing the learner can do/build/explain to prove they finished it.
- List overall prerequisites (things assumed known before module 1).

Respond ONLY with JSON:
{
  "title": "Short curriculum title",
  "summary": "2-3 sentence overview of the path and who it is for",
  "prerequisites": ["..."],
  "modules": [
    {
      "name": "Module name",
      "goal": "one sentence",
      "concepts": ["Concept A", "Concept B"],
      "resources": [ { "title": "...", "type": "book|course|video|docs|article", "why": "..." } ],
      "milestone": "..."
    }
  ]
}`;

export async function planCurriculum(topic, answers) {
  const answerText =
    answers && answers.length
      ? "Scoping answers:\n" + answers.map((a) => `- ${a.question} -> ${a.answer}`).join("\n")
      : "No scoping answers (topic was already focused).";
  const text = await callLLM({
    system: PLAN_SYSTEM,
    user: `Topic: ${topic}\n${answerText}`,
    maxTokens: 6000,
  });
  const json = extractJSON(text);
  if (!Array.isArray(json.modules) || json.modules.length === 0) {
    throw new Error("Planner returned no modules");
  }
  return json;
}

// ---------- 3. Notes agent (per module) ----------

const NOTES_SYSTEM = `You are an expert teacher writing atomic Obsidian notes. For EACH concept given, write one self-contained note.

Each note must contain, in this order:
1. "explanation": 150-350 words teaching the concept clearly from first principles, with an example or analogy. Use Obsidian [[wikilinks]] inline whenever you mention another concept from the provided concept list (exact names).
2. "keyPoints": 3-5 bullet takeaways.
3. "diagram": a Mermaid diagram that genuinely illustrates the concept (a process -> flowchart, relationships/structure -> flowchart or classDiagram, interactions over time -> sequenceDiagram, branches of an idea -> mindmap). Rules for valid Mermaid:
   - Keep it small: 4-10 nodes.
   - Always wrap node labels in double quotes, e.g. A["Label here"]. Never use parentheses, brackets, or quotes inside labels.
   - Node IDs must be simple alphanumerics (n1, n2...).
   - No [[wikilinks]], no HTML, no markdown inside the diagram.
   - First line must be the diagram type (flowchart TD, sequenceDiagram, mindmap, classDiagram).
   If no diagram adds real value, use an empty string "".
4. "related": 2-4 exact concept names from the provided list that connect most strongly (for the knowledge graph).
5. "review": 2-3 spaced-repetition question/answer pairs testing understanding (not trivia).

Respond ONLY with JSON:
{
  "notes": [
    {
      "concept": "exact concept name",
      "explanation": "...",
      "keyPoints": ["..."],
      "diagram": "flowchart TD\\n  n1[\\"...\\"] --> n2[\\"...\\"]",
      "related": ["..."],
      "review": [ { "q": "...", "a": "..." } ]
    }
  ]
}`;

// ---------- 4. Clarify agent (comments on existing notes) ----------

const CLARIFY_SYSTEM = `You are a patient expert teacher. The learner is reading one of their study notes and asks a follow-up question about it.
Answer the question clearly and concretely in 80-250 words of plain markdown (no headings, no code fences unless showing code/math). Ground your answer in the note's content, add an example if it helps, and be honest if the question goes beyond the note's scope.`;

export async function clarifyNote(noteContent, question) {
  const text = await callLLM({
    system: CLARIFY_SYSTEM,
    user: `NOTE:\n${noteContent.slice(0, 12000)}\n\nQUESTION: ${question}`,
    maxTokens: 2000,
  });
  return text.trim();
}

export async function writeModuleNotes(topic, module, allConcepts) {
  const text = await callLLM({
    system: NOTES_SYSTEM,
    user: [
      `Topic: ${topic}`,
      `Module: ${module.name} — ${module.goal}`,
      `Write notes for these concepts: ${module.concepts.join("; ")}`,
      `Full concept list across the whole curriculum (valid [[wikilink]] targets): ${allConcepts.join("; ")}`,
    ].join("\n"),
    maxTokens: 8000,
  });
  const json = extractJSON(text);
  return Array.isArray(json.notes) ? json.notes : [];
}
