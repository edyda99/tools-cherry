// Crash cleanup for pdf-to-word R2 storage.
//
// Happy-path uploads/<uuid>.pdf and results/<uuid>.docx objects are deleted
// in-request by the pdf-to-word backend. Anything still present after 2 hours
// means the request crashed before cleanup ran, so it's garbage. This worker
// runs hourly and deletes it. A 1-day bucket lifecycle rule is the backstop
// if this worker itself fails to run.

const PREFIXES = ["uploads/", "results/"];
const MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours
const DELETE_CHUNK_SIZE = 1000; // R2 bulk delete limit

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(purge(env));
  },
};

async function purge(env) {
  const cutoff = Date.now() - MAX_AGE_MS;
  let scanned = 0;
  let deleted = 0;

  for (const prefix of PREFIXES) {
    const staleKeys = [];
    let cursor;

    do {
      const listing = await env.PDF_BUCKET.list({
        prefix,
        cursor,
        limit: 1000,
      });

      for (const object of listing.objects) {
        scanned++;
        if (object.uploaded.getTime() < cutoff) {
          staleKeys.push(object.key);
        }
      }

      cursor = listing.truncated ? listing.cursor : undefined;
    } while (cursor);

    for (let i = 0; i < staleKeys.length; i += DELETE_CHUNK_SIZE) {
      const chunk = staleKeys.slice(i, i + DELETE_CHUNK_SIZE);
      await env.PDF_BUCKET.delete(chunk);
      deleted += chunk.length;
    }
  }

  console.log(JSON.stringify({ m: "purge", scanned, deleted }));
}
