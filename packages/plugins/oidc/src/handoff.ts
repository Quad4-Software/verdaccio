/**
 * HTML pages the OAuth flow serves directly: the token handoff for the web UI,
 * the CLI approval prompt, and the error page. Values go through escapeHtml or
 * JSON embedding ; never raw interpolation ; so claim values cannot break out.
 */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function page(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>body{font-family:system-ui,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#f6f6f6}.card{background:#fff;padding:2rem 3rem;border-radius:8px;box-shadow:0 1px 4px rgba(0,0,0,.2);text-align:center;max-width:30rem}button{margin:.5rem;padding:.6rem 2rem;border:0;border-radius:4px;cursor:pointer;font-size:1rem}.allow{background:#1565c0;color:#fff}</style>
</head><body><div class="card">${body}</div></body></html>`;
}

/** JSON-embed a value in a script tag; < is escaped so the tag cannot close. */
function js(value: string): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

/**
 * Stores the issued web token the way store/storage.ts does (plain token
 * and username keys) and navigates on. Plain strings, not JSON, on purpose.
 */
export function handoffPage(username: string, token: string, next: string): string {
  const u = js(username);
  const t = js(token);
  const n = js(next);
  return page(
    'Signed in',
    `<h1>Signed in</h1><p>Returning to the registry...</p>
<script>try{localStorage.setItem('username',${u});localStorage.setItem('token',${t});}catch(e){}location.replace(${n});</script>`
  );
}

/**
 * CLI approval page: the browser has finished OIDC, but the token only reaches
 * the waiting npm login session after an explicit click. Without this a
 * crafted authorize URL could hand the victim's token to an attacker's
 * session (login CSRF).
 */
export function cliConfirmPage(username: string, confirmPath: string): string {
  return page(
    'Approve CLI login',
    `<h1>Approve CLI login</h1>
<p>Sign in to the npm CLI as <b>${escapeHtml(username)}</b>?</p>
<form method="post" action="${escapeHtml(confirmPath)}"><button class="allow" type="submit">Allow</button></form>`
  );
}

export function cliDonePage(): string {
  return page('CLI login complete', '<h1>CLI login complete</h1><p>You can close this window.</p>');
}

export function errorPage(message: string): string {
  return page('Sign-in failed', `<h1>Sign-in failed</h1><p>${escapeHtml(message)}</p>`);
}
