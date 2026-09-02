/**
 * utils/csvSafety.js - Single, safe CSV implementation shared by the on-demand
 * admin report export and the scheduled daily attendance export.
 *
 * Provides:
 *   - RFC 4180 quoting (comma, quote, CR, LF inside a field)
 *   - quote escaping (" -> "")
 *   - CRLF row separators
 *   - CSV formula/injection protection for fields that begin with = + - @ tab CR
 *
 * This is the ONE CSV writer. Nothing else in the codebase should build CSV by
 * string concatenation.
 */

const INJECTION_START = /^[=+\-@\t\r]/;

function escapeField(value) {
  let s = value == null ? "" : String(value);
  // Formula-injection guard: neutralize dangerous leading characters so a
  // spreadsheet never executes text that originated from user data.
  if (INJECTION_START.test(s)) {
    s = "'" + s;
  }
  if (/[",\r\n]/.test(s)) {
    s = '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/**
 * Build one CSV line from a row of field values (array or object values).
 * @param {Array<*>} fields
 * @returns {string} a single \r\n-terminated line
 */
export function toCsvLine(fields) {
  return fields.map(escapeField).join(",") + "\r\n";
}

/**
 * Build a full CSV string from a header + rows.
 * @param {Array<string>} header
 * @param {Array<Array<*>>} rows
 * @returns {string}
 */
export function toCsv(header, rows) {
  return [toCsvLine(header), ...rows.map(toCsvLine)].join("");
}

export { escapeField };
