export function chapterFileName(ordinal: number): string {
  return `source/ch${String(ordinal).padStart(2, "0")}.txt`;
}
