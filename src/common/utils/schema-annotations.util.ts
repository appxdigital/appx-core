/**
 * The part of a schema `///` comment that carries annotations (`@Role(...)`,
 * `@NoWrite`). Backtick-quoted spans are dropped, so a comment can mention a
 * tag in prose — `` /// unlike `role` (`@NoWrite`) … `` — without applying it.
 */
export function annotationText(documentation?: string): string {
    return (documentation || '').replace(/`[^`]*`/g, '');
}
