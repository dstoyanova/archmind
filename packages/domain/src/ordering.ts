/**
 * Locale-independent string ordering (UTF-16 code unit order).
 *
 * Every sort that feeds snapshot output or the content hash must use this
 * comparator. `String.prototype.localeCompare` depends on the process locale
 * and ICU build, so it can order the same input differently across machines.
 */
export function compareStrings(left: string, right: string): number {
  if (left < right) {
    return -1;
  }

  return left > right ? 1 : 0;
}
