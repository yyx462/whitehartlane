// adapters/herdr-transport.ts — today's Transport: the herdr CLI.
//
// Every herdr-spelling in the rail lives HERE and nowhere else: the
// exec relay (with the logging policy — failing ACTIONS are findings,
// failing READS stay quiet), the pane/tab verbs, and the stdout-JSON
// pickers. A plugin transport implements the same interface with
// another multiplexer underneath.
import { jsonAt } from "../doors/runners.ts"
import type { CmdResult, PaneLayout, Transport } from "../ports/transport.ts"

export type TransportRunner = (args: string[]) => CmdResult

export class HerdrTransport implements Transport {
  private readonly run: TransportRunner
  private readonly log: (msg: string) => void

  constructor(run: TransportRunner, log: (msg: string) => void = () => {}) {
    this.run = run
    this.log = log
  }

  exec(...args: string[]): CmdResult {
    const r = this.run(args)
    // a failing ACTION call is a real finding — log it, so a silent
    // CLI exit never hides behind a blocked sweep. Failing reads
    // (agent get/read/wait) are how the rail probes pane state; they
    // stay quiet or every beat would spam on each dead pane.
    if (r.status !== 0 && !(args[0] === "agent" && ["get", "read", "wait"].includes(args[1] ?? ""))) {
      this.log(`herdr ${args.slice(0, 3).join(" ")}${args.length > 3 ? " …" : ""} → rc=${r.status}`)
    }
    return r
  }

  splitPane(from: string, direction: string, cwd: string, ratio: number): string | null {
    const r = this.exec(
      "pane", "split", "--pane", from, "--direction", direction,
      "--ratio", String(ratio), "--cwd", cwd, "--no-focus",
    )
    return jsonAt(r.stdout, (d) => (d as { result?: { pane?: { pane_id?: string } } }).result?.pane?.pane_id ?? null)
  }

  closePane(pane: string): void {
    this.exec("pane", "close", pane)
  }

  renamePane(pane: string, name: string): void {
    this.exec("pane", "rename", pane, name)
  }

  layoutOf(pane: string): PaneLayout | null {
    const r = this.exec("pane", "layout", "--pane", pane)
    return jsonAt(r.stdout, (d) => (d as { result?: { layout?: never } }).result?.layout ?? null)
  }

  tabCreate(label: string, cwd: string, workspace: string | null): { root: string | null; tab: string | null; status: number } {
    const r = this.exec(
      "tab", "create", "--label", label, "--cwd", cwd, "--no-focus",
      ...(workspace ? ["--workspace", workspace] : []),
    )
    return {
      root: jsonAt(r.stdout, (d) => (d as { result?: { root_pane?: { pane_id?: string } } }).result?.root_pane?.pane_id ?? null),
      tab: jsonAt(r.stdout, (d) => (d as { result?: { tab?: { tab_id?: string } } }).result?.tab?.tab_id ?? null),
      status: r.status ?? 1,
    }
  }

  closeTab(tab: string): void {
    this.exec("tab", "close", tab)
  }
}
