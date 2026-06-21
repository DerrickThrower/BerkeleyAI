// Deterministic mock adapter. Lets the ENTIRE system run end-to-end with no API
// keys — presence, classification, arbitration, merge, conflict surfacing, UI.
// It makes believable *localized* edits keyed on the target symbol so that two
// different symbols produce two genuinely mergeable diffs, and the same symbol
// produces a real conflict.

import { insertIntoBody, replaceReturnInBody, findSymbol } from "../pyutil.js";
import type { AdapterInput, AdapterOutput } from "./index.js";

export async function runMock(input: AdapterInput): Promise<AdapterOutput> {
  const { prompt, before, symbol } = input;
  const p = prompt.toLowerCase();
  const sym = symbol ?? firstDef(before);

  if (!sym || !findSymbol(before, sym)) {
    const after = before + `\n# vibedocs: ${prompt}\n`;
    return { newContent: after, summary: `appended note for: ${prompt}` };
  }

  // intent → localized edit
  if (/json/.test(p)) {
    return {
      newContent: replaceReturnInBody(before, sym, `jsonify({"user": user_id, "format": "json"})`),
      summary: `made ${sym} return JSON`,
    };
  }
  if (/xml/.test(p)) {
    return {
      newContent: replaceReturnInBody(
        before,
        sym,
        `Response(f"<user><id>{user_id}</id></user>", mimetype="application/xml")`
      ),
      summary: `made ${sym} return XML`,
    };
  }
  if (/validat/.test(p)) {
    return {
      newContent: insertIntoBody(
        before,
        sym,
        `if not payload:  # added: input validation\n        raise ValueError("payload required")`
      ),
      summary: `added input validation to ${sym}`,
    };
  }
  if (/log/.test(p)) {
    return {
      newContent: insertIntoBody(before, sym, `logger.info("vibedocs: ${sym} called")  # added: logging`),
      summary: `added logging to ${sym}`,
    };
  }
  if (/auth|token|jwt|middleware/.test(p)) {
    return {
      newContent: insertIntoBody(before, sym, `require_auth(request)  # added: auth check`),
      summary: `added auth check to ${sym}`,
    };
  }
  // generic localized note
  return {
    newContent: insertIntoBody(before, sym, `# vibedocs change: ${prompt}`),
    summary: `applied "${prompt}" to ${sym}`,
  };
}

function firstDef(src: string): string | null {
  const m = src.match(/^\s*def\s+([A-Za-z_][A-Za-z0-9_]*)/m);
  return m ? m[1] : null;
}
