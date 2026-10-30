// SPDX-License-Identifier: Apache-2.0
// Is a route served yet? The server answers an unknown path with its router's generic 404
// (`{"error":{"type":"not_found","message":"Not found."}}`); any other answer (401, 405, a domain 404…) means a route
// is there. Lets a scenario switch itself on the day its route lands on main, without editing the bench.
const GENERIC_404 = 'Not found.';

/** True when `path` reaches a route (whatever it answers), false on the router's generic 404. */
export async function isServed(base: string, path: string, method = 'GET'): Promise<boolean> {
  const r = await fetch(base.replace(/\/$/, '') + path, { method });
  if (r.status !== 404) return true;
  const text = await r.text();
  try {
    return (JSON.parse(text) as { error?: { message?: string } }).error?.message !== GENERIC_404;
  } catch {
    return true;
  }
}

/** The first of `paths` that is served, or undefined. */
export async function firstServed(base: string, paths: readonly string[], method = 'GET'): Promise<string | undefined> {
  for (const p of paths) if (await isServed(base, p, method)) return p;
  return undefined;
}
