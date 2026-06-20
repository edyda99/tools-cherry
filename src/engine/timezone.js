// timezone.js — pure, dependency-free time-zone math built on the runtime's
// Intl time-zone database. Shared by the browser tool (time-zone-converter.js)
// and the unit tests. No data files, no network: the ECMAScript Intl engine
// already knows every IANA zone and its historical/future DST rules.
//
// tzOffsetMinutes(tz, date) -> the UTC offset (in minutes, east-of-UTC positive)
//                              that `tz` is observing at the instant `date`.
// formatOffset(min)         -> a "UTC+05:30" / "UTC-04:00" style label.
// listTimeZones()           -> array of supported IANA zone names.
// zonedWallTime(tz, date)   -> { year, month, day, hour, minute, second } as the
//                              wall-clock numbers shown in `tz` at `date`.
// wallTimeToInstant(tz, w)  -> a Date (UTC instant) for the wall-clock components
//                              `w` ({year,month,day,hour,minute}) interpreted as
//                              local time in `tz`. Resolves DST by iterating.
// convert(fromTz, toTz, w)  -> wall-clock components in `toTz` for the moment that
//                              is `w` in `fromTz`, plus the resolved instant.

// Read the wall-clock numbers a zone shows at a given instant.
export function zonedWallTime(tz, date) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  const p = Object.fromEntries(dtf.formatToParts(date).map((x) => [x.type, x.value]));
  // Intl can emit hour "24" for midnight; normalize to 0.
  const hour = p.hour === '24' ? 0 : Number(p.hour);
  return {
    year: Number(p.year), month: Number(p.month), day: Number(p.day),
    hour, minute: Number(p.minute), second: Number(p.second)
  };
}

// Offset (minutes east of UTC) that `tz` observes at the instant `date`.
export function tzOffsetMinutes(tz, date) {
  const w = zonedWallTime(tz, date);
  const asUTC = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return Math.round((asUTC - date.getTime()) / 60000);
}

// "UTC+05:30", "UTC-04:00", "UTC+00:00".
export function formatOffset(min) {
  const sign = min < 0 ? '-' : '+';
  const abs = Math.abs(min);
  const h = String(Math.floor(abs / 60)).padStart(2, '0');
  const m = String(abs % 60).padStart(2, '0');
  return `UTC${sign}${h}:${m}`;
}

// All IANA zones the runtime supports, with 'UTC' guaranteed to lead the list
// (Intl.supportedValuesOf omits the plain 'UTC' alias on some engines). Falls
// back to a small set if the engine predates Intl.supportedValuesOf.
export function listTimeZones() {
  let zones;
  if (typeof Intl.supportedValuesOf === 'function') {
    zones = Intl.supportedValuesOf('timeZone');
  } else {
    zones = ['America/New_York', 'America/Los_Angeles', 'Europe/London', 'Asia/Tokyo'];
  }
  return zones.includes('UTC') ? zones : ['UTC', ...zones];
}

// Convert wall-clock components, interpreted as local time in `tz`, to the
// matching UTC instant. Because the offset depends on the instant (DST), we
// guess with the offset at a naive UTC reading, then correct once — two passes
// converge for every real wall time. (Ambiguous/skipped DST hours resolve to a
// stable, deterministic choice, which is all a converter needs.)
export function wallTimeToInstant(tz, w) {
  const naive = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute || 0, w.second || 0);
  let offset = tzOffsetMinutes(tz, new Date(naive));
  let instant = naive - offset * 60000;
  // Re-check the offset at the corrected instant and adjust if DST shifted it.
  const offset2 = tzOffsetMinutes(tz, new Date(instant));
  if (offset2 !== offset) instant = naive - offset2 * 60000;
  return new Date(instant);
}

// Convert a wall time in `fromTz` to the wall time in `toTz`.
// Returns { instant, from, to } where from/to are wall-time component objects
// with their offsets attached.
export function convert(fromTz, toTz, w) {
  const instant = wallTimeToInstant(fromTz, w);
  const from = { ...zonedWallTime(fromTz, instant), offset: tzOffsetMinutes(fromTz, instant) };
  const to = { ...zonedWallTime(toTz, instant), offset: tzOffsetMinutes(toTz, instant) };
  return { instant, from, to };
}
