export const spur = {
  name: "inbox-zero",
  steps: [
    { id: "tickets", does: "wave" },
    { id: "grade", does: "grade", after: ["tickets"] },
    { id: "await-human", does: "gate", after: ["grade"] },
    { id: "report", does: "report", after: ["await-human"] },
  ],
}
