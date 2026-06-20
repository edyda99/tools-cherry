// json-format.js — pure, dependency-free JSON validation and formatting.
// Shared by the browser tool (json-formatter.js) and the unit tests.
//
// validateJson(text)         -> { ok: true, value } | { ok: false, message, line, column }
// formatJson(text, indent)   -> pretty-printed string (throws on invalid JSON)
// minifyJson(text)           -> compact, whitespace-free string (throws on invalid JSON)
//
// All parsing uses the built-in JSON.parse; on failure we recover a 1-based
// line/column from the parser's character offset so the UI can point at the error.

// Pull a character offset out of the various engine-specific SyntaxError messages
// (V8: "...at position 123", some report "...line 4 column 5"). Returns -1 when
// no position can be recovered.
function offsetFromError(err, text) {
  const msg = String(err && err.message);

  // V8 / modern Node & Chrome: "... in JSON at position 123"
  const posMatch = msg.match(/position\s+(\d+)/i);
  if (posMatch) return Math.min(Number(posMatch[1]), text.length);

  // Spidermonkey/Firefox: "... at line 4 column 5 of the JSON data"
  const lcMatch = msg.match(/line\s+(\d+)\s+column\s+(\d+)/i);
  if (lcMatch) {
    const line = Number(lcMatch[1]);
    const col = Number(lcMatch[2]);
    let off = 0;
    let curLine = 1;
    while (off < text.length && curLine < line) {
      if (text[off] === '\n') curLine++;
      off++;
    }
    return Math.min(off + (col - 1), text.length);
  }

  // Newer V8 (Node 21+): "Unexpected token 'X', \"snippet\" is not valid JSON"
  // or "Unexpected token 'X', ...\"snippet\"... is not valid JSON". No offset is
  // given, so locate the offending token character within the source ourselves.
  const tokMatch = msg.match(/Unexpected token '(.)'/);
  if (tokMatch) {
    const idx = text.indexOf(tokMatch[1]);
    if (idx >= 0) return idx;
  }
  // "Unexpected end of JSON input" -> point at the very end.
  if (/Unexpected end of JSON input/i.test(msg)) return text.length;

  return -1;
}

// 1-based { line, column } for a character offset into text.
function lineColumn(text, offset) {
  if (offset < 0) return { line: 0, column: 0 };
  let line = 1;
  let column = 1;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === '\n') {
      line++;
      column = 1;
    } else {
      column++;
    }
  }
  return { line, column };
}

export function validateJson(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    return { ok: false, message: 'Nothing to validate — paste some JSON first.', line: 0, column: 0 };
  }
  try {
    const value = JSON.parse(text);
    return { ok: true, value };
  } catch (err) {
    const offset = offsetFromError(err, text);
    const { line, column } = lineColumn(text, offset);
    // Strip the engine's trailing position/snippet phrasing for a cleaner message.
    let message = String(err && err.message)
      .replace(/\s*(in JSON\s+)?at position\s+\d+.*/i, '')
      .replace(/,\s*"[\s\S]*"\s+is not valid JSON\s*$/i, '')
      .replace(/\s+is not valid JSON\s*$/i, '')
      .trim();
    if (!message) message = 'Invalid JSON.';
    return { ok: false, message, line, column };
  }
}

export function formatJson(text, indent = 2) {
  const result = validateJson(text);
  if (!result.ok) {
    const e = new Error(result.message);
    e.line = result.line;
    e.column = result.column;
    throw e;
  }
  const pad = indent === 'tab' ? '\t' : Math.max(0, Math.min(8, Number(indent) || 0));
  return JSON.stringify(result.value, null, pad);
}

export function minifyJson(text) {
  const result = validateJson(text);
  if (!result.ok) {
    const e = new Error(result.message);
    e.line = result.line;
    e.column = result.column;
    throw e;
  }
  return JSON.stringify(result.value);
}
