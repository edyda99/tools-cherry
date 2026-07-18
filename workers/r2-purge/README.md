# r2-purge

Hourly cron worker that garbage-collects crashed pdf-to-word R2 objects
(`uploads/*.pdf`, `results/*.docx`) older than 2 hours — the happy path
deletes them in-request, so anything left is from a crash.

Deploy: `npx wrangler deploy` (run from this directory).

Backstop: a 1-day bucket lifecycle rule on `pdf-to-word-files` covers the
case where this worker itself fails to run.
