'use strict';
/*
 * Build the REST reference from the routes themselves.
 *
 * There are around 480 endpoints. Hand-written documentation for that many
 * would be wrong within a month and nobody would notice, so the reference is
 * generated and regenerating it is part of the release checklist.
 *
 *   npm run docs:api
 *
 * What this reads is the route table, not the implementation: paths, methods,
 * the middleware each endpoint is wrapped in and the controller it lands on.
 * Request and response bodies are not inferred, because guessing at them would
 * produce documentation that looks authoritative and is not.
 */
const fs = require('fs');
const path = require('path');
const { loadAll } = require('./lib/parse-validation');

const ROUTES_DIR = path.join(__dirname, '..', 'src', 'routes');
const MIDDLEWARE_DIR = path.join(__dirname, '..', 'src', 'middleware');
const DOCS_DIR = path.join(__dirname, '..', '..', 'docs');
const OUT = path.join(DOCS_DIR, 'API.md');
const OUT_SPEC = path.join(DOCS_DIR, 'openapi.json');

const pkg = require(path.join(__dirname, '..', '..', 'package.json'));

// Mount points come from routes/index.js, so an alias added there shows up here
// without anyone remembering to update a list.
function readMounts() {
  const file = path.join(ROUTES_DIR, 'index.js');
  const text = fs.readFileSync(file, 'utf8');
  const mounts = new Map(); // routeFile -> [mountPath, ...]
  const varToFile = new Map();

  for (const m of text.matchAll(/(\w+)\s*=\s*require\(["']\.\/([\w.-]+)["']\)/g)) {
    varToFile.set(m[1], m[2].replace(/\.js$/, '') + '.js');
  }
  for (const m of text.matchAll(/router\.use\(\s*["']([^"']+)["']\s*,\s*(\w+)\s*\)(.*)/g)) {
    const [, mountPath, varName, trailing] = m;
    const file = varToFile.get(varName);
    if (!file) continue;
    const note = (trailing.match(/\/\/\s*(.+)$/) || [])[1] || null;
    if (!mounts.has(file)) mounts.set(file, []);
    mounts.get(file).push({ path: mountPath, note });
  }
  return mounts;
}

// Middleware names between the path and the handler tell a reader whether an
// endpoint needs a token and what it validates, which is the question people
// actually have when they open an API reference.
function parseRoutes(file) {
  const text = fs.readFileSync(path.join(ROUTES_DIR, file), 'utf8');
  const out = [];

  // Matched against the whole file rather than line by line: roughly a fifth of
  // the routes put the path on the line after router.get(, and a line-based
  // parser silently drops every one of them.
  const re = /router\.(get|post|put|patch|delete)\(\s*["']([^"']*)["']/g;

  for (const m of text.matchAll(re)) {
    const [, method, routePath] = m;

    // Walk forward from the path to the closing paren of this call, tracking
    // depth so a nested call in an inline handler does not end it early.
    let i = m.index + m[0].length;
    let depth = 1;
    while (i < text.length && depth > 0) {
      const c = text[i];
      if (c === '(') depth++;
      else if (c === ')') depth--;
      i++;
    }
    const rest = text.slice(m.index + m[0].length, i - 1);

    // Only bare identifiers and dotted references count as middleware or a
    // handler; an inline arrow function has no name worth printing.
    const names = (rest.match(/(?<![\w$.])[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*/g) || []).filter(
      (n) => !/^(req|res|next|async|await|function|return|const|let|var|new|typeof|null|true|false)$/.test(n)
    );
    const handler = names.length ? names[names.length - 1] : null;
    const middleware = names.slice(0, -1);

    out.push({ method: method.toUpperCase(), path: routePath, middleware, handler });
  }
  return out;
}

/*
 * Turn the route table plus recovered validation into an OpenAPI document.
 *
 * Endpoints without validation middleware get their path, method, auth and
 * handler but no request schema, and say so. An endpoint that showed an empty
 * body would imply none is needed, which sends people down the wrong path more
 * effectively than admitting the gap.
 */
function buildSpec(groups, validators) {
  const paths = {};
  let documented = 0;
  let undocumented = 0;

  for (const g of groups) {
    for (const r of g.routes) {
      // Express :id becomes OpenAPI {id}.
      const full = ((g.primary + r.path).replace(/\/+$/, '') || '/').replace(/:(\w+)/g, '{$1}');
      const fields = r.middleware.flatMap((m) => validators[m.split('.').pop()] || []);
      if (fields.length) documented++; else undocumented++;

      const inPath = [...full.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);

      const parameters = fields
        .filter((f) => f.in !== 'body')
        // A validator occasionally declares a path parameter the route does not
        // actually have — /variants/getVariantDetails validates param('id') on a
        // path with no :id. Publishing it would describe a parameter nobody can
        // supply, so it is dropped here and left as a source bug to fix.
        .filter((f) => f.in !== 'path' || inPath.includes(f.name))
        .map((f) => ({
          name: f.name, in: f.in, required: !!f.required,
          schema: f.schema, description: f.description,
        }));

      // Path parameters are part of the URL whether or not anyone validated
      // them, so they are added from the path itself when validation missed them.
      for (const name of inPath) {
        if (!parameters.some((p) => p.name === name && p.in === 'path')) {
          parameters.push({ name, in: 'path', required: true, schema: { type: 'string' } });
        }
      }

      const bodyFields = fields.filter((f) => f.in === 'body');

      // operationId has to be unique across the whole document, and the same
      // handler is mounted at several paths often enough that naming it after
      // the handler alone collides. Method plus path is unique by construction.
      const opId = (r.method.toLowerCase() + full.replace(/[{}]/g, '').replace(/[^\w]+/g, '_'))
        .replace(/_+$/, '');

      const op = {
        summary: r.handler ? r.handler.split('.').pop() : undefined,
        operationId: opId,
        tags: [g.tag],
        parameters: parameters.length ? parameters : undefined,
        responses: {
          200: { description: 'Success' },
          400: { description: 'Validation failed' },
          401: { description: 'Authentication required' },
          500: { description: 'Server error' },
        },
      };

      if (bodyFields.length) {
        const properties = {};
        const required = [];
        for (const f of bodyFields) {
          properties[f.name] = f.description
            ? { ...f.schema, description: f.description }
            : f.schema;
          if (f.required) required.push(f.name);
        }
        op.requestBody = {
          required: required.length > 0,
          content: {
            'application/json': {
              schema: { type: 'object', properties, required: required.length ? required : undefined },
            },
          },
        };
      } else if (['POST', 'PUT', 'PATCH'].includes(r.method)) {
        op.description =
          'Request body is not yet documented. This endpoint has no validation ' +
          'middleware, so its shape cannot be derived from the source. ' +
          'Adding validation improves both runtime safety and this document.';
      }

      paths[full] = paths[full] || {};
      paths[full][r.method.toLowerCase()] = op;
    }
  }

  return {
    spec: {
      openapi: '3.0.3',
      info: {
        title: 'Posnic API',
        version: pkg.version || '0.0.0',
        description:
          'REST API for the Posnic point of sale.\n\n' +
          'Generated from the route table and express-validator chains by ' +
          '`npm run docs:api`. Do not edit by hand.\n\n' +
          'Request schemas are present for endpoints that carry validation ' +
          'middleware. The rest are listed with their path, method and handler ' +
          'but no body schema, because inventing one would be worse than the gap.',
        license: { name: 'AGPL-3.0-only', url: 'https://www.gnu.org/licenses/agpl-3.0.html' },
        contact: { name: 'Posnic', url: 'https://posnic.com', email: 'info@posnic.com' },
      },
      servers: [
        { url: 'http://127.0.0.1:42590', description: 'Local desktop install (stock Posnic)' },
      ],
      tags: groups.map((g) => ({ name: g.tag, description: `Mounted at ${g.primary}` })),
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
      },
      security: [{ bearerAuth: [] }],
      paths,
    },
    documented,
    undocumented,
  };
}

function main() {
  const mounts = readMounts();
  const files = fs.readdirSync(ROUTES_DIR).filter((f) => f.endsWith('.js') && f !== 'index.js').sort();

  const validators = loadAll(MIDDLEWARE_DIR);

  let total = 0;
  const sections = [];
  const groups = [];

  for (const file of files) {
    const routes = parseRoutes(file);
    if (!routes.length) continue;
    total += routes.length;

    const mountList = mounts.get(file) || [];
    const primary = mountList[0] ? mountList[0].path : '/' + file.replace(/\.routes\.js$/, '');
    const aliases = mountList.slice(1);

    const title = file.replace(/\.routes\.js$/, '').replace(/-/g, ' ');
    const tag = title.charAt(0).toUpperCase() + title.slice(1);
    groups.push({ tag, primary, routes, file });

    let s = `\n### ${tag}\n\n`;
    s += `Mounted at \`${primary}\`. Source: \`api/src/routes/${file}\`.\n\n`;
    if (aliases.length) {
      s += 'Also reachable at ' +
        aliases.map((a) => `\`${a.path}\`${a.note ? ` (${a.note.toLowerCase()})` : ''}`).join(', ') +
        '.\n\n';
    }
    s += '| Method | Path | Body documented | Handler |\n|---|---|---|---|\n';
    for (const r of routes) {
      const full = (primary + r.path).replace(/\/+$/, '') || '/';
      const has = r.middleware.some((m) => validators[m.split('.').pop()]);
      s += `| ${r.method} | \`${full}\` | ${has ? 'yes' : '—'} | ${r.handler ? `\`${r.handler}\`` : '—'} |\n`;
    }
    sections.push(s);
  }

  const { spec, documented, undocumented } = buildSpec(groups, validators);

  const header = `# REST API reference

Generated from \`api/src/routes/\` by \`npm run docs:api\`. Do not edit this file
by hand; edit the routes and regenerate.

**${total} endpoints across ${sections.length} route groups.**

All paths below are relative to the API root. On a desktop install the API runs
on a port derived per installation (see \`local-ports.js\`); in the cloud it sits
behind the tenant hostname.

## Machine-readable spec

[\`openapi.json\`](openapi.json) is generated alongside this file. Import it into
Postman, Insomnia or Bruno, point Swagger UI or Redoc at it, or generate a
client from it. It is OpenAPI 3.0.3.

**${documented} of ${total} endpoints carry a request schema** (${Math.round((documented / total) * 100)}%), recovered from
their \`express-validator\` middleware. The remaining ${undocumented} are listed with
path, method and handler but no body, because inventing a schema is worse than
admitting the gap.

Adding validation to an endpoint improves runtime safety *and* this document in
the same commit, which makes it one of the more useful contributions available.

## Conventions

- Authentication is a bearer token unless an endpoint's middleware says otherwise.
- Several groups carry a second mount path kept for compatibility with the older
  PHP application. New work should use the primary path.
- Response bodies are not documented. They are not inferable from the source.

## Endpoints
`;

  fs.mkdirSync(DOCS_DIR, { recursive: true });
  fs.writeFileSync(OUT, header + sections.join('') + '\n');
  fs.writeFileSync(OUT_SPEC, JSON.stringify(spec, null, 2) + '\n');
  console.log(`  wrote ${path.relative(process.cwd(), OUT)}: ${total} endpoints, ${sections.length} groups`);
  console.log(
    `  wrote ${path.relative(process.cwd(), OUT_SPEC)}: ${Object.keys(spec.paths).length} paths, ` +
    `${documented} with a request schema, ${undocumented} without`
  );
}

main();
