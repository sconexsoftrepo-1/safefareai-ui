// Loads the app's real TypeScript modules (transpiled with the project's TypeScript) into an
// isolated vm context, so one test can run several "tabs" each with their own module state.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const ts = require("typescript");

const SRC = path.join(__dirname, "..", "..", "src");

function resolve(fromFile, spec) {
  const base = spec.startsWith("@/") ? path.join(SRC, spec.slice(2)) : path.resolve(path.dirname(fromFile), spec);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  throw new Error(`Cannot resolve ${spec} from ${fromFile}`);
}

/**
 * Creates a context from `globals` and returns a require() for files under src/.
 * `modules` stubs bare package imports (e.g. { react: { useSyncExternalStore } }).
 */
function createRealm(globals = {}, modules = {}) {
  const sandbox = { console, setTimeout, clearTimeout, URLSearchParams, TextEncoder, ...globals };
  sandbox.globalThis = sandbox;
  if (!("window" in globals)) sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const { outputText } = ts.transpileModule(fs.readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
      fileName: file,
    });
    const module = { exports: {} };
    cache.set(file, module);
    const fn = vm.runInContext(`(function (exports, require, module) {${outputText}\n})`, context, { filename: file });
    fn(module.exports, (spec) => (Object.hasOwn(modules, spec) ? modules[spec] : load(resolve(file, spec))), module);
    return module.exports;
  }
  return { context: sandbox, require: (rel) => load(resolve(path.join(SRC, "x"), `./${rel}`)) };
}

module.exports = { createRealm };
