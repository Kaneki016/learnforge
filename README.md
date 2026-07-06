# LearnForge

Type a topic → AI agents scope it, research it, and design a structured learning path → linked Obsidian notes appear in your vault as a knowledge graph.

## How it works

Three agents run in a pipeline:

1. **Scope agent** — checks if your topic is too broad. If so, it asks 2–4 clarifying questions (goal, angle, level) before anything else happens.
2. **Planner agent** — designs a 4–8 module curriculum: ordered concepts, prerequisites, curated resources, and a milestone per module.
3. **Notes agent** — writes one atomic Obsidian note per concept: a first-principles explanation, key points, a Mermaid diagram illustrating the concept, `[[wikilinks]]` to related concepts, and spaced-repetition review Q&As.

The MOC roadmap also gets a "Path at a glance" Mermaid flowchart of all modules and concepts. Obsidian renders these diagrams natively — no plugin needed.

## Library tab

The **Library** tab is your window into everything already saved: full-text search across all notes and roadmaps, topic cards, and a note viewer that renders markdown and diagrams in the browser. From a note you can ask the agent follow-up questions (answers are saved into the note under "Clarifications", so they appear in Obsidian too) or delete notes/whole topics. When you try to learn a topic similar to one already in your knowledge base, LearnForge points you to the existing one first instead of building a duplicate.

Everything is written to your vault:

```
vault/
  Home.md                      ← index of all topics you've learned
  <Topic>/
    <Topic> MOC.md             ← roadmap with checkboxes, resources, milestones
    <Concept>.md               ← one linked note per concept
```

## Review tab (spaced repetition)

Every concept note's review Q&As become flashcards. The **Review** tab shows what's due (SM-2 scheduling: Again / Hard / Good / Easy), with a due-count badge. Schedule state lives in `vault/.learnforge/review.json`.

## Progress & graph

Topic cards show a progress bar; roadmap checkboxes are clickable in the app and sync to the MOC file (so Obsidian sees them too). The Library's **Graph** sub-tab renders your full knowledge graph — colored by topic, clickable to open notes. New topics automatically link to concepts you've already learned, so graphs connect across topics over time.

## Setup (once)

Requires [Node.js 18+](https://nodejs.org).

```
npm install
copy .env.example .env
```

Edit `.env`: set `PROVIDER` to `claude` or `gemini` and paste the matching API key
(Claude: console.anthropic.com · Gemini: aistudio.google.com/apikey).

## Run

```
npm start
```

Open http://localhost:3210, type a topic, answer the scoping questions, wait ~1–3 minutes.

## Open the knowledge graph

In Obsidian: **Open folder as vault** → select the `vault` folder here. Open the topic's MOC note, or the Graph view to see all concepts linked. Tick the roadmap checkboxes as you learn; new topics get added to the same vault so graphs connect over time.

## Test without an API key

```
MOCK_LLM=1 npm start        (PowerShell: $env:MOCK_LLM="1"; npm start)
```

Runs the whole pipeline with a fake model — useful to verify setup.

## License

[MIT](LICENSE)
