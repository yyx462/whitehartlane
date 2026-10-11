export const spur = {
  name: "skill-rsi",
  steps: [
    { id: "professor", does: "actor" },
    { id: "students", does: "wave", after: ["professor"] },
    { id: "grade", does: "grade", after: ["students"] },
    { id: "report", does: "report", after: ["grade"] },
  ],
}
