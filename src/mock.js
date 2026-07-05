// Deterministic mock LLM for offline testing: run with MOCK_LLM=1 npm start
// Routes by inspecting the user prompt of each agent.

export function mockResponse(user) {
  if (user.includes("Write notes for these concepts")) {
    const concepts = user
      .match(/Write notes for these concepts: (.+)/)[1]
      .split(";")
      .map((s) => s.trim());
    return JSON.stringify({
      notes: concepts.map((c, i) => ({
        concept: c,
        explanation: `This is a mock explanation of ${c}. It links to [[${concepts[(i + 1) % concepts.length]}]] to test graph edges.`,
        keyPoints: [`${c} key point 1`, `${c} key point 2`, `${c} key point 3`],
        diagram: `flowchart TD\n  n1["${c}"] --> n2["Example"]\n  n1 --> n3["Application"]`,
        related: [concepts[(i + 1) % concepts.length]],
        review: [
          { q: `What is ${c}?`, a: `A mock answer about ${c}.` },
          { q: `Why does ${c} matter?`, a: "Because testing." },
        ],
      })),
    });
  }

  if (user.includes("QUESTION:")) {
    const q = (user.match(/QUESTION: (.+)/) || [])[1] || "";
    return `Mock clarification: here is a deeper explanation responding to "${q}". It references the note content and gives an example.`;
  }

  if (user.includes("Scoping answers") || user.includes("No scoping answers")) {
    return JSON.stringify({
      title: "Mock Curriculum",
      summary: "A mock learning path used for end-to-end testing.",
      prerequisites: ["Basic curiosity"],
      modules: [
        {
          name: "Foundations",
          goal: "Learn the basics.",
          concepts: ["Alpha Concept", "Beta Concept", "Gamma Concept"],
          resources: [{ title: "Mock Book", type: "book", why: "It is mock." }],
          milestone: "Explain Alpha to a friend.",
        },
        {
          name: "Applications",
          goal: "Apply the basics.",
          concepts: ["Delta Concept", "Epsilon Concept"],
          resources: [{ title: "Mock Course", type: "course", why: "Hands-on." }],
          milestone: "Build a tiny project.",
        },
      ],
    });
  }

  // Scope agent
  const topic = (user.match(/Topic: (.+)/) || [])[1] || "";
  const broad = topic.trim().split(/\s+/).length <= 1;
  return JSON.stringify({
    tooBroad: broad,
    reason: broad ? "Single-word topics are usually too broad." : "Topic is focused enough.",
    questions: broad
      ? [
          {
            question: `Which angle of ${topic} interests you most?`,
            options: ["Theory", "Practice", "History"],
          },
          {
            question: "What is your current level?",
            options: ["Beginner", "Intermediate", "Advanced"],
          },
        ]
      : [],
  });
}
