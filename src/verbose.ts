export function verboseOn(toml: string, env?: string): boolean {
  if (env === "1") return true
  return /^verbose\s*=\s*true\s*$/m.test(toml)
}

export function beat(who: "watcher" | "operator" | "rail", what: string): string {
  return `${who} ${what}`
}

export function note(seen: Map<string, string>, key: string, line: string): string | null {
  if (seen.get(key) === line) return null
  seen.set(key, line)
  return line
}

export function closes(end: string | null): boolean {
  return end === "done"
}
