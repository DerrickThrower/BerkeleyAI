import { DEMO_FILES } from "./src/seed.js";
import { runMock } from "./src/adapters/mock.js";
import { threeWayMerge } from "./src/merge.js";
const before = DEMO_FILES["api.py"];
const a = await runMock({ prompt:"add input validation to create_user", before, symbol:"create_user", model:"mock" } as any);
const b = await runMock({ prompt:"add structured logging to delete_user", before, symbol:"delete_user", model:"mock" } as any);
const m = threeWayMerge(before, a.newContent, b.newContent);
console.log("=== MERGED api.py (case 2) ===\n" + m.merged);
console.log("\nconflict:", m.conflict, "| via:", m.via);
