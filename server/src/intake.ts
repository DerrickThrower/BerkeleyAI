// Prompt intake + the arbitration window.
//
// Every submitted prompt is appended to the Redis Stream (the append-only
// ledger of everything anyone ever asked for in this room) and broadcast as
// "queued". Prompts that arrive within ARB_WINDOW_MS are treated as
// SIMULTANEOUS and arbitrated together — this is what produces the live
// "2 queued · arbitrating" demo beat and lets two people's intent meet.

import { ARB_WINDOW_MS } from "./config.js";
import { appendPrompt, publishEvent } from "./redis.js";
import { arbitrate } from "./arbiter.js";
import { withSpan } from "./tracing.js";
import type { PromptRequest, ServerMsg } from "./types.js";

type Broadcast = (room: string, msg: ServerMsg) => void;

interface Batch {
  prompts: PromptRequest[];
  timer: NodeJS.Timeout;
}

export class Intake {
  private batches = new Map<string, Batch>();
  private queueDepth = new Map<string, number>();
  constructor(private broadcast: Broadcast) {}

  async submit(p: PromptRequest): Promise<void> {
    // 1) durable ledger
    await appendPrompt(p.roomId, p);

    // 2) visible queue
    const depth = (this.queueDepth.get(p.roomId) ?? 0) + 1;
    this.queueDepth.set(p.roomId, depth);
    this.broadcast(p.roomId, { type: "prompt_queued", prompt: p, queueDepth: depth });

    // 3) join / open the arbitration window
    const existing = this.batches.get(p.roomId);
    if (existing) {
      existing.prompts.push(p);
    } else {
      const timer = setTimeout(() => void this.flush(p.roomId), ARB_WINDOW_MS);
      this.batches.set(p.roomId, { prompts: [p], timer });
    }
  }

  private async flush(room: string): Promise<void> {
    const batch = this.batches.get(room);
    if (!batch) return;
    this.batches.delete(room);
    clearTimeout(batch.timer);
    const prompts = batch.prompts;
    this.queueDepth.set(room, 0);

    await withSpan(
      "prompt.lifecycle",
      { "vibedocs.room": room, "vibedocs.batch_size": prompts.length },
      async () => {
        // Announce "arbitrating" as soon as classification is done, so the UI
        // shows the in-flight state DURING execute+merge (not after).
        const outcome = await arbitrate(room, prompts, (arbCase, classifications) => {
          this.broadcast(room, {
            type: "arbitrating",
            promptIds: prompts.map((p) => p.id),
            arbCase,
            classifications,
          });
        });

        // emit each resolution + push the resulting file state to all clients
        for (const r of outcome.resolutions) {
          this.broadcast(room, { type: "resolution", resolution: r });
          for (const [file, content] of Object.entries(r.appliedFiles)) {
            this.broadcast(room, { type: "file_update", file, content });
          }
          await publishEvent(room, { type: "resolution", resolution: r });
        }
      }
    );
  }
}
