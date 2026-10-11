export const dag = {
  name: "git-wave",
  steps: [
    { id: "professor", does: "actor" },
    { id: "students", does: "wave", after: ["professor"] },
    { id: "grade", does: "grade", after: ["students"] },
    { id: "await-review", does: "gate", after: ["grade"] },
    { id: "report", does: "report", after: ["await-review"] },
  ],
}
