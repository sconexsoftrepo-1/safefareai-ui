// Static V10 contract analysis of the frontend's BFF calls.
//
// Uses the TypeScript compiler (type checker) over src/features/drive-vision/api/*.ts to find every
// BFF call site — api.get/post/put/patch/delete<T>(path, …), sourced<T>(path, query) and the raw
// send<T>("METHOD", path) used for token refresh — and resolves, from the real types:
//   - the request path, expanding `${x}` spans whose type is a literal union (e.g. "approve" | "reject")
//   - the query object's properties (name, optional, literal values)
//   - the request body's properties (recursively)
//   - the response type argument T (recursively, arrays unwrapped)
// Each call is matched to a V10 operation and compared with its parameters, request-body schema and
// the `data` schema of its 2xx envelope. Pure analysis: nothing is executed and nothing is sent.
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const ROOT = path.join(__dirname, "..", "..");
const API_DIR = path.join(ROOT, "src", "features", "drive-vision", "api");
const SPEC_FILE = path.join(ROOT, "docs", "openapi", "api-docs-v10.json");
const HTTP = ["get", "post", "put", "patch", "delete"];
const MAX_DEPTH = 5;

function loadSpec(file = SPEC_FILE) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

// ── Spec helpers ─────────────────────────────────────────────────────────────

function specOperations(spec) {
  const out = [];
  for (const [p, item] of Object.entries(spec.paths)) {
    for (const m of HTTP) if (item[m]) out.push({ method: m.toUpperCase(), path: p, op: item[m], key: `${m.toUpperCase()} ${p}` });
  }
  return out;
}

function deref(spec, schema, seen = new Set()) {
  let s = schema;
  while (s && s.$ref) {
    const name = s.$ref.split("/").pop();
    if (seen.has(name)) return { schema: {}, name, cyclic: true };
    seen.add(name);
    s = spec.components.schemas[name];
  }
  if (s && s.allOf) {
    const merged = { type: "object", properties: {}, required: [] };
    for (const part of s.allOf) {
      const r = deref(spec, part, new Set(seen)).schema;
      Object.assign(merged.properties, r.properties || {});
      merged.required.push(...(r.required || []));
    }
    return { schema: merged, seen };
  }
  return { schema: s || {}, seen };
}

/** "Required permission" text of an operation, or "public" / null. */
function permissionOf(op) {
  const d = op.description || "";
  const m = d.match(/\*\*Required permission:\*\*\s*([^\n]*)/);
  if (m) return m[1].trim().replace(/\.$/, "");
  if (d.includes("**Public:**")) return "public";
  return null;
}

/** Permission codes in a permission text ("a or b" → [a, b]; "none (…)" → []). */
function permissionCodes(text) {
  if (!text || text === "public" || /^none\b/.test(text)) return [];
  return text.split(/\s+or\s+/).map((s) => s.trim());
}

function isTenantSelector(p) {
  return p.name === "X-Tenant-Id" || (p.in === "query" && p.name === "tenantId" && /X-Tenant-Id/.test(p.description || ""));
}

function queryParams(op) {
  return (op.parameters || []).filter((p) => p.in === "query" && !isTenantSelector(p));
}

function bodySchema(spec, op) {
  const c = op.requestBody?.content;
  if (!c) return null;
  const media = c["application/json"] || Object.values(c)[0];
  return media?.schema || null;
}

/** The `data` schema of the 2xx envelope, or null. */
function responseDataSchema(spec, op) {
  const ok = Object.entries(op.responses || {}).find(([code]) => /^2/.test(code));
  if (!ok || !ok[1].content) return null;
  const media = ok[1].content["application/json"] || ok[1].content["*/*"] || Object.values(ok[1].content)[0];
  const env = deref(spec, media.schema).schema;
  return env.properties?.data ?? null;
}

/**
 * Allowed values of a string schema: `enum`, or a `pattern` that is a plain alternation of code
 * tokens (V10 writes many value sets as e.g. `"pattern": "ACTIVE|DISABLED"`). Null when open-ended.
 */
function valueSet(schema) {
  if (!schema) return null;
  if (Array.isArray(schema.enum)) return schema.enum;
  const m = typeof schema.pattern === "string" && schema.pattern.match(/^\^?\(?([A-Za-z0-9_.-]+(?:\|[A-Za-z0-9_.-]+)+)\)?\$?$/);
  return m ? m[1].split("|") : null;
}

const schemaName = (s) => (s && s.$ref ? s.$ref.split("/").pop() : s?.type === "array" ? `${schemaName(s.items)}[]` : s?.type || null);

// ── Path matching ────────────────────────────────────────────────────────────

/** Best V10 operation for a concrete call path ("{}" = dynamic segment). Literal segment matches win. */
function matchOperation(ops, method, callPath) {
  const segs = callPath.split("/").filter(Boolean);
  let best = null;
  for (const o of ops) {
    if (o.method !== method) continue;
    const ss = o.path.replace(/^\/api\/v1/, "").split("/").filter(Boolean);
    if (ss.length !== segs.length) continue;
    let score = 0;
    let ok = true;
    for (let i = 0; i < ss.length; i++) {
      const param = /^\{.+\}$/.test(ss[i]);
      if (segs[i] === "{}") {
        if (!param) ok = false;
      } else if (param) {
        // a literal call segment may fill a path parameter (rare), but literal spec segments score higher
      } else if (ss[i] === segs[i]) score++;
      else ok = false;
      if (!ok) break;
    }
    if (ok && (!best || score > best.score)) best = { op: o, score };
  }
  return best ? best.op : null;
}

// ── TypeScript side ──────────────────────────────────────────────────────────

function createProgram() {
  const files = fs.readdirSync(API_DIR).filter((f) => f.endsWith(".ts")).map((f) => path.join(API_DIR, f));
  return ts.createProgram(files, {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts", "lib.esnext.d.ts"],
    baseUrl: ROOT,
    paths: { "@/*": ["./src/*"] },
  });
}

function stripNullish(checker, type) {
  if (!type.isUnion()) return type;
  const parts = type.types.filter((t) => !(t.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null | ts.TypeFlags.Void)));
  if (parts.length === 1) return parts[0];
  return type;
}

/** Literal string values when the type is a string literal or a union of them; else null. */
function literalValues(type) {
  const parts = type.isUnion() ? type.types : [type];
  const vals = [];
  for (const t of parts) {
    if (t.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null)) continue;
    if (t.isStringLiteral()) vals.push(t.value);
    else if (t.flags & ts.TypeFlags.BooleanLiteral) continue;
    else return null;
  }
  return vals.length ? vals : null;
}

function isPrimitiveLike(type) {
  const f = type.flags;
  if (f & (ts.TypeFlags.StringLike | ts.TypeFlags.NumberLike | ts.TypeFlags.BooleanLike | ts.TypeFlags.BigIntLike | ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never)) return true;
  if (type.isUnion()) return type.types.every((t) => isPrimitiveLike(t) || t.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null));
  return false;
}

/**
 * Shape of a TS type: { kind: "primitive", literals } | { kind: "array", items } | { kind: "object", props, index }.
 * `index` = has a string index signature (Record<string, …>); such objects aren't compared field by field.
 */
function shapeOf(checker, type, depth = 0) {
  type = stripNullish(checker, type);
  if (depth > MAX_DEPTH) return { kind: "deep" };
  if (isPrimitiveLike(type)) return { kind: "primitive", literals: literalValues(type) };
  if (checker.isArrayType(type) || checker.isTupleType(type)) {
    const [el] = checker.getTypeArguments(type);
    return { kind: "array", items: el ? shapeOf(checker, el, depth + 1) : { kind: "primitive" } };
  }
  const index = !!checker.getIndexInfoOfType(type, ts.IndexKind.String);
  const props = {};
  for (const sym of checker.getPropertiesOfType(type)) {
    const decl = sym.valueDeclaration || sym.declarations?.[0];
    const pt = decl ? checker.getTypeOfSymbolAtLocation(sym, decl) : checker.getTypeOfSymbol(sym);
    props[sym.name] = { optional: !!(sym.flags & ts.SymbolFlags.Optional), shape: shapeOf(checker, pt, depth + 1) };
  }
  return { kind: "object", props, index };
}

/** Concrete call paths for a path argument, expanding literal-union template spans. */
function expandPath(checker, node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
  if (!ts.isTemplateExpression(node)) return null;
  let paths = [node.head.text];
  for (const span of node.templateSpans) {
    const vals = literalValues(checker.getTypeAtLocation(span.expression));
    const options = vals ?? ["{}"];
    const next = [];
    for (const p of paths) for (const v of options) next.push(p + v + span.literal.text);
    paths = next;
  }
  return paths;
}

/** Service object (`export const fooService = { … }`) and member/function enclosing a call. */
function enclosingName(node) {
  let method = null;
  let service = null;
  for (let n = node.parent; n; n = n.parent) {
    if (!method && (ts.isPropertyAssignment(n) || ts.isMethodDeclaration(n) || ts.isFunctionDeclaration(n)) && n.name) method = n.name.getText();
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && ts.isObjectLiteralExpression(n.initializer)) {
      service = n.name.text;
      break;
    }
  }
  return { method, service };
}

/** Value expression of property `name` in an object literal (shorthand `{ body }` → the identifier). */
function objectProp(node, name) {
  if (!node || !ts.isObjectLiteralExpression(node)) return null;
  for (const p of node.properties) {
    if (ts.isPropertyAssignment(p) && p.name.getText() === name) return p.initializer;
    if (ts.isShorthandPropertyAssignment(p) && p.name.text === name) return p.name;
  }
  return null;
}

/** Every BFF call site under src/features/drive-vision/api. */
function collectCallSites() {
  const program = createProgram();
  const checker = program.getTypeChecker();
  const sites = [];
  for (const sf of program.getSourceFiles()) {
    if (!sf.fileName.replace(/\\/g, "/").startsWith(API_DIR.replace(/\\/g, "/"))) continue;
    const visit = (node) => {
      if (ts.isCallExpression(node)) {
        const callee = node.expression;
        let method = null;
        let pathArg = null;
        let queryNode = null;
        let bodyNode = null;
        let optsNode = null;
        let kind = null;
        if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === "api" && HTTP.includes(callee.name.text)) {
          kind = "api";
          method = callee.name.text.toUpperCase();
          pathArg = node.arguments[0];
          const hasBody = ["POST", "PUT", "PATCH"].includes(method);
          // A literal `undefined` sends no body: it only holds the place of the options argument.
          bodyNode = hasBody && node.arguments[1]?.getText() !== "undefined" ? node.arguments[1] : null;
          optsNode = hasBody ? node.arguments[2] : node.arguments[1];
          queryNode = objectProp(optsNode, "query");
        } else if (ts.isIdentifier(callee) && callee.text === "sourced") {
          kind = "sourced";
          method = "GET";
          pathArg = node.arguments[0];
          queryNode = node.arguments[1];
        } else if (ts.isIdentifier(callee) && callee.text === "send" && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
          kind = "send";
          method = node.arguments[0].text;
          pathArg = node.arguments[1];
          bodyNode = objectProp(node.arguments[2], "body");
          optsNode = node.arguments[2];
        }
        if (kind && pathArg) {
          const paths = expandPath(checker, pathArg);
          if (paths) {
            const typeArg = node.typeArguments?.[0];
            const respType = typeArg ? checker.getTypeFromTypeNode(typeArg) : null;
            const queryType = queryNode && !(queryNode.kind === ts.SyntaxKind.UndefinedKeyword || (ts.isIdentifier(queryNode) && queryNode.text === "undefined")) ? checker.getTypeAtLocation(queryNode) : null;
            const bodyType = bodyNode ? checker.getTypeAtLocation(bodyNode) : null;
            const authProp = objectProp(optsNode, "auth");
            const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
            const { method: fn, service } = enclosingName(node);
            for (const p of paths) {
              sites.push({
                file: path.relative(ROOT, sf.fileName).replace(/\\/g, "/"),
                line: line + 1,
                service,
                fn,
                method,
                path: p.split("?")[0],
                auth: !(authProp && authProp.kind === ts.SyntaxKind.FalseKeyword) && !(kind === "send" && node.arguments[3]?.kind === ts.SyntaxKind.NullKeyword),
                responseTypeText: typeArg ? typeArg.getText() : null,
                response: respType ? shapeOf(checker, respType) : null,
                query: queryType ? shapeOf(checker, queryType) : null,
                body: bodyType ? shapeOf(checker, bodyType) : null,
              });
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return sites;
}

// ── Comparison ───────────────────────────────────────────────────────────────

/**
 * Compares a TS shape with a schema. Findings: { level: "error" | "warn" | "info", where, msg }.
 * mode "response": TS fields missing from the spec → error (the UI reads a field V10 doesn't send);
 *                  spec fields missing from TS → info (available, not mapped); enum literals outside the
 *                  spec enum → error.
 * mode "body":     TS fields missing from the spec → error (sends an unknown field); spec-required fields
 *                  absent in TS → error, optional in TS → warn; enum literals outside the spec → error.
 */
function compareShape(spec, tsShape, schema, mode, where, out, depth = 0, documented = null) {
  if (!tsShape || !schema || depth > MAX_DEPTH) return;
  const { schema: s, cyclic } = deref(spec, schema);
  if (cyclic) return;
  if (tsShape.kind === "array") {
    if (s.type === "array") return compareShape(spec, tsShape.items, s.items, mode, `${where}[]`, out, depth + 1, documented);
    out.push({ level: "error", where, msg: `frontend expects an array, spec has ${s.type || "object"}` });
    return;
  }
  if (tsShape.kind === "primitive") {
    const allowed = valueSet(s);
    if (tsShape.literals && allowed) {
      const extra = tsShape.literals.filter((v) => !allowed.includes(v));
      if (extra.length) out.push({ level: "error", where, msg: `frontend values ${JSON.stringify(extra)} not in spec values ${JSON.stringify(allowed)}` });
    }
    return;
  }
  if (tsShape.kind !== "object") return;
  if (s.type === "array") {
    out.push({ level: "error", where, msg: "frontend expects an object, spec has an array" });
    return;
  }
  const props = s.properties;
  if (!props) return; // free-form object / map in the spec
  if (tsShape.index && Object.keys(tsShape.props).length === 0) return;
  const required = new Set(s.required || []);
  for (const [name, p] of Object.entries(tsShape.props)) {
    const at = where ? `${where}.${name}` : name;
    if (!Object.hasOwn(props, name)) {
      // Fields documented by the operation's description rather than its schema (see documentedResponseFields).
      if (mode === "response" && documented?.has(at)) continue;
      out.push({ level: "error", where: at, msg: mode === "body" ? "field sent by the frontend is not in the V10 request schema" : "field read by the frontend is not in the V10 response schema" });
      continue;
    }
    compareShape(spec, p.shape, props[name], mode, at, out, depth + 1, documented);
  }
  for (const name of Object.keys(props)) {
    const at = where ? `${where}.${name}` : name;
    const t = tsShape.props[name];
    if (mode === "body") {
      if (required.has(name) && !t) out.push({ level: "error", where: at, msg: "V10-required request field is absent from the frontend type" });
      else if (required.has(name) && t.optional) out.push({ level: "warn", where: at, msg: "V10-required request field is optional in the frontend type" });
    } else if (!t) out.push({ level: "info", where: at, msg: "V10 response field not mapped in the frontend type" });
  }
}

/**
 * Response fields V10 documents in an operation's description instead of its schema. Only one such note
 * exists: "**Tenant columns:** every row also has `tenantId` (int64) and `tenantName` (string)" on list
 * operations — it allows exactly those two fields on list rows of exactly those operations.
 */
function documentedResponseFields(op) {
  return /\*\*Tenant columns:\*\*/.test(op.description || "") ? new Set(["data[].tenantId", "data[].tenantName"]) : null;
}

function compareQuery(spec, tsShape, op, out) {
  const params = queryParams(op);
  const byName = Object.fromEntries(params.map((p) => [p.name, p]));
  const props = tsShape?.kind === "object" ? tsShape.props : {};
  for (const [name, p] of Object.entries(props)) {
    if (!byName[name]) {
      out.push({ level: "error", where: `?${name}`, msg: "query parameter sent by the frontend is not a V10 parameter" });
      continue;
    }
    const sch = deref(spec, byName[name].schema).schema;
    const en = valueSet(sch) || (sch.type === "array" ? valueSet(deref(spec, sch.items).schema) : null);
    const lits = p.shape.kind === "primitive" ? p.shape.literals : p.shape.kind === "array" ? p.shape.items.literals : null;
    if (lits && en) {
      const extra = lits.filter((v) => !en.includes(v));
      if (extra.length) out.push({ level: "error", where: `?${name}`, msg: `frontend values ${JSON.stringify(extra)} not in spec enum ${JSON.stringify(en)}` });
    }
  }
  for (const p of params) {
    if (!p.required) continue;
    if (!props[p.name]) out.push({ level: "error", where: `?${p.name}`, msg: "V10-required query parameter is never sent" });
    else if (props[p.name].optional) out.push({ level: "warn", where: `?${p.name}`, msg: "V10-required query parameter is optional in the frontend type" });
  }
  for (const p of params) if (!p.required && !props[p.name]) out.push({ level: "info", where: `?${p.name}`, msg: "optional V10 query parameter not offered by the frontend" });
}

/**
 * Full analysis: call sites matched to V10 operations, with findings per site. `callSites` (from
 * collectCallSites) can be passed in to compare the same code against several specs; it isn't mutated.
 */
function analyse(spec = loadSpec(), callSites = collectCallSites()) {
  const ops = specOperations(spec);
  const sites = callSites.map((s) => ({ ...s }));
  for (const site of sites) {
    const match = matchOperation(ops, site.method, site.path);
    site.operation = match ? match.key : null;
    const findings = [];
    if (!match) {
      findings.push({ level: "error", where: site.path, msg: "no V10 operation matches this method and path" });
    } else {
      const op = match.op;
      const perm = permissionOf(op);
      if (perm === "public" && site.auth) findings.push({ level: "warn", where: "auth", msg: "public operation sent with the bearer token" });
      if (perm !== "public" && !site.auth) findings.push({ level: "error", where: "auth", msg: "authenticated operation sent without the bearer token" });
      compareQuery(spec, site.query, op, findings);
      const bs = bodySchema(spec, op);
      if (site.body && !bs) findings.push({ level: "error", where: "body", msg: "frontend sends a body; V10 operation has none" });
      if (!site.body && bs && op.requestBody?.required) findings.push({ level: "error", where: "body", msg: "V10 requires a request body; frontend sends none" });
      if (site.body && bs) compareShape(spec, site.body, bs, "body", "body", findings);
      const ds = responseDataSchema(spec, op);
      if (site.response && ds) compareShape(spec, site.response, ds, "response", "data", findings, 0, documentedResponseFields(op));
    }
    site.findings = findings;
  }
  return { spec, ops, sites };
}

module.exports = {
  documentedResponseFields, ROOT, SPEC_FILE, loadSpec, specOperations, permissionOf, permissionCodes, queryParams, bodySchema, responseDataSchema, schemaName, valueSet, isTenantSelector, matchOperation, collectCallSites, analyse, deref };
