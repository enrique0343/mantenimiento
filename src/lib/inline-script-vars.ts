/**
 * Keep database/request text outside the HTML parser's script-closing syntax.
 * Astro 5's define:vars serializer does not escape every </script> variant.
 * Upstream advisory: https://github.com/withastro/astro/security/advisories/GHSA-j687-52p2-xcff
 * URI encoding removes raw '<' before that serializer receives the payload;
 * JSON.parse(decodeURIComponent(...)) restores the original JSON values.
 */
export function encodeInlineScriptVars(vars: Record<string, unknown>): string {
  return encodeURIComponent(JSON.stringify(vars));
}
