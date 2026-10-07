export const dag = {
  name: "two-signoffs",
  steps: [
    { id: "writer", does: "actor" },
    { id: "drafts", does: "wave", after: ["writer"] },
    { id: "signoff-legal", does: "gate", after: ["drafts"] },
    { id: "signoff-security", does: "gate", after: ["drafts"] },
    { id: "report", does: "report", after: ["signoff-legal", "signoff-security"] },
  ],
}
