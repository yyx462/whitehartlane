// Promote is a gate in front of ship, in the spirit of no-mistakes:
// findings first, a PR only if the gate is clean, never a merge.
// The human runs it. A clean Job is not permission to publish.
import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import { appendEvent, saveJob, type JobRecord } from "../adapters/store.ts"

export type Finding = { check: string; detail: string }

export function promoteFindings(input: {
  job: JobRecord | null
  worktreeExists: boolean
  hasWork: boolean
}): Finding[] {
  const findings: Finding[] = []
  const job = input.job
  if (!job) return [{ check: "job", detail: "no such Job" }]
  if (job.state !== "retired") {
    findings.push({ check: "state", detail: `${job.id} is ${job.state}, not retired` })
  }
  if (!job.receipt) {
    findings.push({ check: "receipt", detail: "no receipt" })
  } else {
    if (job.receipt.status !== "done") {
      findings.push({ check: "receipt", detail: `status ${job.receipt.status} is not a ship` })
    }
    if (job.receipt.panesRemaining !== 0) {
      findings.push({ check: "receipt", detail: `${job.receipt.panesRemaining} panes still open` })
    }
  }
  if (!job.worktree) findings.push({ check: "worktree", detail: "session has no worktree to ship" })
  else if (!input.worktreeExists) findings.push({ check: "worktree", detail: `gone: ${job.worktree}` })
  else if (!input.hasWork) findings.push({ check: "diff", detail: "nothing ahead of trunk" })
  return findings
}

export function formatGate(jobId: string, findings: Finding[], shipped?: string): string {
  const lines = [`promote ${jobId}`]
  if (findings.length === 0) {
    lines.push("  gate        clean")
    lines.push(`  pr          ${shipped ?? "opened"}`)
    lines.push("  merge       not done — a PR is not a merge")
  } else {
    for (const finding of findings) lines.push(`  finding     ${finding.check}: ${finding.detail}`)
    lines.push("  stopped     nothing was pushed")
  }
  return lines.join("\n")
}

export function markPromoted(job: JobRecord, note: string): JobRecord {
  const at = new Date().toISOString()
  job.promoted = { at, note }
  saveJob(job)
  appendEvent(job.sid, { actor: "first_mate", kind: "job.promoted", jid: job.id, note })
  return job
}

export function submitPr(worktree: string, title: string, body: string): string {
  const bin = process.env.AGENTIC_OS_SUBMIT ?? "gwt"
  const args = bin === "gwt" ? ["submit-pr", title, body] : [title, body]
  return execFileSync(bin, args, { cwd: worktree, encoding: "utf8", timeout: 180_000 }).trim()
}

export function worktreeHasWork(worktree: string): boolean {
  if (!existsSync(worktree)) return false
  try {
    const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: worktree, encoding: "utf8" }).trim()
    if (dirty) return true
    const ahead = execFileSync("git", ["rev-list", "--count", "@{upstream}..HEAD"], {
      cwd: worktree,
      encoding: "utf8",
    }).trim()
    return ahead !== "0" && ahead !== ""
  } catch {
    return false
  }
}
