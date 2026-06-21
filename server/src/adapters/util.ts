// Defensive JSON extraction from an LLM response that may wrap JSON in prose or
// ```json fences.
export function extractJsonBlock(text: string): any | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  try {
    return JSON.parse(candidate);
  } catch {
    // try to find the first {...} balanced-ish blob
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}
