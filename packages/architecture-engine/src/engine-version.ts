/**
 * Version of the analysis engine, recorded on every snapshot and part of the
 * local idempotency key. Bump it whenever a change alters analysis output; the
 * golden-snapshot test in `@archmind/analysis-pipeline` fails when output changes
 * without a bump.
 */
export const ENGINE_VERSION = "0.2.0";
