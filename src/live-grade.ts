export function gradeCall(end: string | null, seen: boolean): boolean {
  return end === "done" && !seen
}
