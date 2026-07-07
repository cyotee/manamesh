// Launcher that spawns a PnP-activated node process running the Vite CLI bin directly.
// Includes post-build patch to guarantee classic <script> (no type=module) for file://.
const cp = require('child_process');
const path = require('path');
const fs = require('fs');

const pnp = require('pnpapi');
const frontendDir = __dirname;
const rootDir = path.resolve(frontendDir, '../../../..');
const issuer = path.join(frontendDir, 'package.json');

let viteBin;
try {
  const pkgPath = pnp.resolveRequest('vite/package.json', issuer);
  const viteDir = path.dirname(pkgPath);
  const pkg = require(path.join(viteDir, 'package.json'));
  const binRel = (pkg.bin && (pkg.bin.vite || pkg.bin['vite'])) || 'bin/vite.js';
  viteBin = path.join(viteDir, binRel);
} catch (e) {
  console.error('Failed to resolve vite bin via pnp:', e.message);
  process.exit(1);
}

const configPath = path.resolve(frontendDir, 'vite.config.ts');

console.log('[build-spa] Spawning via yarn node + vite build');
console.log('[build-spa] config:', configPath);

const child = cp.spawn(
  'yarn',
  ['node', viteBin, 'build', '--config', configPath],
  {
    stdio: 'inherit',
    cwd: rootDir,
    env: { ...process.env }
  }
);

child.on('exit', (code) => {
  if (code === 0) {
    // Post-process: guarantee classic <script> (no type=module) AND correct DOM order
    // for file:// (script must appear after #root in source so getElementById succeeds).
    const targets = [
      path.join(rootDir, 'dist/timestreams.html'),
      path.join(rootDir, 'dist/packages/manamesh/packages/frontend/src/pages/timestreams/index.html')
    ];
    const deep = targets[1];
    const convenient = targets[0];

    function extractLongestScript(html) {
      // Find all <script>...</script> and pick the one with most content (the inlined bundle)
      const re = /<script[^>]*>([\s\S]*?)<\/script>/gi;
      let match;
      let best = null;
      while ((match = re.exec(html)) !== null) {
        const content = match[1] || '';
        if (!best || content.length > best.content.length) {
          best = { full: match[0], content, start: match.index, end: match.index + match[0].length };
        }
      }
      return best;
    }

    function buildCleanSPA(inlinedJS, title = 'Timestreams - ManaMesh') {
      // Minimal valid shell that matches original intent, script placed at end of body after #root.
      const style = "body { margin: 0; background: #0f172a; color: #e2e8f0; font-family: system-ui, sans-serif; } #root { min-height: 100vh; }";
      return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    <style>${style}</style>
  </head>
  <body>
    <div id="root"></div>
    <script>${inlinedJS}</script>
  </body>
</html>`;
    }

    function processHtml(p) {
      if (!fs.existsSync(p)) return false;
      let html = fs.readFileSync(p, 'utf8');

      // Remove module + crossorigin first
      html = html.replace(/<script[^>]*type=["']module["'][^>]*>/gi, '<script>');
      html = html.replace(/ type=["']module["']/gi, '');
      html = html.replace(/ crossorigin[^>\s]*/gi, '');

      const scriptInfo = extractLongestScript(html);
      let finalHtml;
      if (scriptInfo && scriptInfo.content.trim().length > 1000) {
        // Rebuild with guaranteed order: #root then the big script
        finalHtml = buildCleanSPA(scriptInfo.content);
      } else {
        // Fallback: at least ensure a script is after root if possible, do light surgery
        finalHtml = html;
        // If script is before #root, move it.
        const rootPos = finalHtml.indexOf('<div id="root">');
        const scriptStart = finalHtml.indexOf('<script');
        if (rootPos > -1 && scriptStart > -1 && scriptStart < rootPos) {
          const closeIdx = finalHtml.indexOf('</script>', scriptStart);
          if (closeIdx > scriptStart) {
            const scriptTag = finalHtml.substring(scriptStart, closeIdx + 9);
            let rest = finalHtml.substring(0, scriptStart) + finalHtml.substring(closeIdx + 9);
            const bodyEnd = rest.lastIndexOf('</body>');
            if (bodyEnd > -1) {
              rest = rest.slice(0, bodyEnd) + scriptTag + rest.slice(bodyEnd);
            } else {
              rest += scriptTag;
            }
            finalHtml = rest;
          }
        }
      }

      fs.writeFileSync(p, finalHtml);
      console.log('[build-spa] Patched clean classic script (post #root) for file://:', p, 'size=', finalHtml.length);
      return true;
    }

    let deepOk = processHtml(deep);
    let convOk = processHtml(convenient);

    // Force convenient to be the good deep version (prefer size and validity)
    if (deepOk && fs.existsSync(deep)) {
      const deepSize = fs.statSync(deep).size;
      const convSize = fs.existsSync(convenient) ? fs.statSync(convenient).size : 0;
      if (deepSize > convSize + 1000) {
        fs.copyFileSync(deep, convenient);
        console.log('[build-spa] Copied deep inlined SPA to top-level dist/timestreams.html');
      }
    }
  }
  console.log('[build-spa] Vite exited with code', code);
  process.exit(code || 0);
});