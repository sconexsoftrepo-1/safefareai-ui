// Iris chat integration (direct browser → Python API calls; temporary demo integration). MOCKED ONLY: every request
// goes to a stub fetch, using the safety-score exchange supplied with the API contract. A pass says nothing about the live AI service (see docs/iris-chatbot-integration-report.md).
// The component itself is real and runs in jsdom, with real Radix, react-markdown and remark-gfm.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const { createRealm } = require("./helpers/load-ts.cjs");
const { IDENTITIES } = require("./helpers/identities.cjs");
const { MemoryStorage } = require("./helpers/browser-fakes.cjs");

const SRC = path.join(__dirname, "..", "src");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");
const same = (got, want) => assert.equal(JSON.stringify(got), JSON.stringify(want));

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost:3000/drive-vision/overview", pretendToBeVisual: true });
const { window } = dom;
for (const key of ["window", "document", "HTMLElement", "Element", "Node", "MutationObserver", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "CustomEvent", "Event", "DocumentFragment"]) {
  Object.defineProperty(globalThis, key, { value: key === "window" ? window : window[key], configurable: true, writable: true });
}
Object.defineProperty(globalThis, "navigator", { value: window.navigator, configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
window.HTMLElement.prototype.scrollTo = function () {
  scrolls.push(this);
};
window.HTMLElement.prototype.hasPointerCapture = () => false;

const React = require("react");
const { act } = React;
const { createRoot } = require("react-dom/client");
const { renderToStaticMarkup } = require("react-dom/server");

const SAFETY_QUESTION = "what is safety score";
const SAFETY_RESPONSE = {
  conversation_uuid: "51e96b9b-c1e0-4f96-877f-62e51956a861",
  user_message: SAFETY_QUESTION,
  assistant_message: "A **safety score** is a server-computed value...",
  created_at: "2026-11-06T04:57:23.174000",
};
const SAFETY_ISO = "2026-11-06T04:57:23.174Z";
const SECOND_UUID = "6f1c2f0e-7b3a-4c55-9b1e-0d8a1f3e2c44";

let scrolls = [];
let wide = false;
let requests = [];
let chatHandler = () => ok(SAFETY_RESPONSE);
const ok = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
const SESSION_TOKEN = "session.access.token";
const PY = "https://py.test/safe-fare-python";
const CHAT_URL = `${PY}/api/chat/message`;
let healthHandler = () => Response.json({ status: "ok" });
const stubFetch = async (url, init = {}) => {
  if (String(url) === `${PY}/health`) return healthHandler();
  requests.push({ url: String(url), method: init.method, headers: init.headers, credentials: init.credentials, body: init.body === undefined ? undefined : JSON.parse(init.body), signal: init.signal });
  return chatHandler(requests[requests.length - 1]);
};
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => ((resolve = a), (reject = b)));
  return { promise, resolve, reject };
};

// Module realms: built once, after the ESM-only Markdown packages are imported.
const motionTags = new Map();
const MOTION_ONLY = new Set(["initial", "animate", "exit", "transition", "variants"]);
const motion = new Proxy({}, {
  get(_, tag) {
    if (!motionTags.has(tag)) {
      motionTags.set(tag, React.forwardRef((props, ref) => React.createElement(tag, { ...Object.fromEntries(Object.entries(props).filter(([k]) => !MOTION_ONLY.has(k))), ref })));
    }
    return motionTags.get(tag);
  },
});

let ui;
let pure;
test.before(async () => {
  const [{ default: Markdown }, { default: remarkGfm }] = await Promise.all([import("react-markdown"), import("remark-gfm")]);
  const modules = {
    react: React,
    "react/jsx-runtime": require("react/jsx-runtime"),
    "motion/react": { motion, AnimatePresence: ({ children }) => children },
    "radix-ui": require("radix-ui"),
    "lucide-react": require("lucide-react"),
    clsx: require("clsx"),
    "tailwind-merge": require("tailwind-merge"),
    "next/navigation": { usePathname: () => "/drive-vision/overview" },
    "next/link": { __esModule: true, default: ({ href, children, ...rest }) => React.createElement("a", { href, "data-internal": "true", ...rest }, children) },
    "react-markdown": { __esModule: true, default: Markdown },
    "remark-gfm": { __esModule: true, default: remarkGfm },
    "@/features/drive-vision/hooks/use-media-query": { useMediaQuery: () => wide },
  };
  // Signed in: the client sends this token to the same-origin route (never further). The UI realm reads jsdom's storage.
  const session = JSON.stringify({ accessToken: SESSION_TOKEN, tokenType: "Bearer", accessExpiresAt: Date.now() + 3_600_000, refreshToken: "r", refreshExpiresAt: null });
  const storage = new MemoryStorage();
  storage.setItem("safefare:session:v1", session);
  window.sessionStorage.setItem("safefare:session:v1", session);
  const globals = { fetch: (...a) => stubFetch(...a), AbortController, AbortSignal, Response, Request, URL, URLSearchParams, DOMException, sessionStorage: storage, atob, process: { env: { NEXT_PUBLIC_PYTHON_API_BASE_URL: "https://py.test/safe-fare-python" } } };
  ui = createRealm({ ...globals, window, document: window.document, HTMLElement: window.HTMLElement }, modules);
  pure = createRealm(globals, modules);
});

const service = () => pure.require("features/drive-vision/api/iris-chat-service");
const model = () => pure.require("components/drive-vision/assistant/iris-chat-model");

// ── Mounting the real component ─────────────────────────────────────────────

const roots = [];
test.afterEach(async () => {
  while (roots.length) {
    const root = roots.pop();
    await act(async () => root.unmount());
  }
  window.document.body.innerHTML = "";
  requests = [];
  scrolls = [];
  wide = false;
  chatHandler = () => ok(SAFETY_RESPONSE);
});

/** Renders Iris inside the shell context, as app-shell.tsx does. `session` is the key app-shell gives it. */
async function mount(session = "all|1") {
  const { DriveVisionAIAssistant } = ui.require("components/drive-vision/assistant/ai-assistant");
  const { ShellContext } = ui.require("components/drive-vision/app-shell/shell-context");
  function Harness({ session }) {
    const [open, setOpen] = React.useState(false);
    const shell = React.useMemo(() => ({ assistantOpen: open, setAssistantOpen: setOpen, askAssistant() {}, pendingQuestion: null, clearPendingQuestion() {} }), [open]);
    return React.createElement(ShellContext.Provider, { value: shell }, React.createElement(DriveVisionAIAssistant, { key: session }));
  }
  const host = window.document.body.appendChild(window.document.createElement("div"));
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(React.createElement(Harness, { session })));
  return { rerender: (next) => act(async () => root.render(React.createElement(Harness, { session: next }))) };
}

const $ = (selector) => window.document.querySelector(selector);
const $$ = (selector) => [...window.document.querySelectorAll(selector)];
const launcher = () => $('button[aria-label^="Open Iris"]');
const composer = () => $('textarea[aria-label="Message Iris"]');
const sendButton = () => $('button[aria-label="Send"]');
const buttonNamed = (text) => $$("button").find((b) => b.textContent.trim() === text);
const bubbles = (role) => $$(`[data-role="${role}"]`);
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));
const click = async (el) => {
  await act(async () => el.click());
  await settle();
};
const openIris = async () => click(launcher());
async function type(text) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
  await act(async () => {
    setter.call(composer(), text);
    composer().dispatchEvent(new window.Event("input", { bubbles: true }));
  });
}
const key = (init) => act(async () => void composer().dispatchEvent(new window.KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init })));
async function say(text) {
  await type(text);
  await key({ key: "Enter" });
  await settle();
}

// ── 1. Opening and closing ──────────────────────────────────────────────────

test("opens from the existing launcher and closes from its close button; one panel, conversation kept", async () => {
  await mount();
  assert.equal($('[role="dialog"]'), null);
  await openIris();
  assert.equal($$('[role="dialog"]').length, 1);
  assert.ok($('[role="dialog"]').textContent.includes("Iris AI"));

  await say(SAFETY_QUESTION);
  await click($('button[aria-label="Close assistant"]'));
  assert.equal($('[role="dialog"]'), null);

  await openIris();
  assert.equal(bubbles("user").length, 1, "the current conversation survives close and reopen");
  assert.equal(bubbles("assistant").length, 1);
});

test("header shows the connection status from the health route", async () => {
  await mount();
  await openIris();
  assert.ok($('[role="dialog"]').textContent.includes("Connected"));
});

test("empty state shows the welcome message and the six suggested questions, with no answers", async () => {
  await mount();
  await openIris();
  const text = $('[role="dialog"]').textContent;
  assert.ok(text.includes("Hello! I'm Iris"));
  assert.ok(text.includes("Your Safe-Fare AI assistant. Ask me anything about using the application."));
  for (const q of ["What is a safety score?", "How do I add a vehicle?", "How do I assign a driver?", "How can I view live video?", "How do I manage driver permissions?", "How do I view alerts and events?"]) {
    assert.ok(buttonNamed(q), q);
  }
  assert.equal(bubbles("assistant").length, 0);
});

// ── 2–7. Sending and parsing ────────────────────────────────────────────────

test("sends the exact request and shows the server's reply, using the supplied example", async () => {
  await mount();
  await openIris();
  await say(SAFETY_QUESTION);

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, CHAT_URL, "the Python API, directly");
  assert.equal(requests[0].method, "POST");
  same(requests[0].body, { message: SAFETY_QUESTION });

  assert.equal(bubbles("user")[0].querySelector("p").textContent, SAFETY_QUESTION);
  assert.equal(bubbles("assistant")[0].querySelector("strong").textContent, "safety score");
  assert.ok(bubbles("assistant")[0].textContent.includes("is a server-computed value..."));
  assert.equal(composer().value, "", "the composer clears after sending");
});

test("posts directly to the Python chat URL with only the documented fields; no Authorization, cookies or tenant", async () => {
  requests = [];
  const reply = await service().irisChatService.send({ message: SAFETY_QUESTION, conversationUuid: SAFETY_RESPONSE.conversation_uuid });
  assert.equal(reply.assistantMessage, SAFETY_RESPONSE.assistant_message);
  assert.equal(requests[0].url, CHAT_URL);
  same(requests[0].body, { message: SAFETY_QUESTION, conversation_uuid: SAFETY_RESPONSE.conversation_uuid });
  same(Object.keys(requests[0].headers).sort(), ["Accept", "Content-Type"], "no Authorization or tenant header");
  same(requests[0].credentials, "omit", "no cookies");
});

test("parses a complete response; created_at without a zone is UTC", () => {
  const reply = service().parseIrisChatResponse(SAFETY_RESPONSE);
  assert.equal(reply.conversationUuid, SAFETY_RESPONSE.conversation_uuid);
  assert.equal(reply.userMessage, SAFETY_QUESTION);
  assert.equal(reply.assistantMessage, SAFETY_RESPONSE.assistant_message);
  assert.equal(reply.createdAt, Date.parse(SAFETY_ISO));
  assert.equal(service().parseIrisTimestamp("2026-11-06T10:27:23+05:30"), Date.parse(SAFETY_ISO.replace(".174", "")));
  assert.equal(service().parseIrisTimestamp("not a date"), null);
});

test("message timestamps come from created_at, on both bubbles", async () => {
  await mount();
  await openIris();
  await say(SAFETY_QUESTION);
  same(bubbles("assistant")[0].querySelector("time").getAttribute("datetime"), SAFETY_ISO);
  same(bubbles("user")[0].querySelector("time").getAttribute("datetime"), SAFETY_ISO);
  assert.ok(bubbles("assistant")[0].querySelector("time").textContent.trim().length > 0);
});

test("the returned conversation_uuid is sent, under its documented name, with the next message", async () => {
  await mount();
  await openIris();
  await say("first");
  await say("second");
  same(requests[0].body, { message: "first" });
  same(requests[1].body, { message: "second", conversation_uuid: SAFETY_RESPONSE.conversation_uuid });
  same(bubbles("user").map((b) => b.querySelector("p").textContent), ["first", "second"]);
  assert.equal(bubbles("assistant").length, 2, "messages stay in order");
});

test("sends no credentials or tenant to the chat service: the Safe-Fare token never leaves for Python", async () => {
  await mount();
  await openIris();
  await say(SAFETY_QUESTION);
  assert.equal(requests[0].url, CHAT_URL);
  same(Object.keys(requests[0].headers).sort(), ["Accept", "Content-Type"]);
  assert.ok(!JSON.stringify(requests[0]).includes(SESSION_TOKEN), "the session token is not sent anywhere in the request");
  same(requests[0].credentials, "omit");
  assert.doesNotMatch(read("features/drive-vision/api/iris-chat-service.ts"), /Authorization:|usableSession|accessToken/);
});

test("health: GET <Python API>/health directly; down, blocked or not configured reads as Unavailable, never an error page", async () => {
  assert.equal(await service().irisChatService.health(), true);
  for (const h of [() => new Response("<html>502</html>", { status: 502 }), () => Promise.reject(new TypeError("Failed to fetch"))]) {
    healthHandler = h;
    assert.equal(await service().irisChatService.health(), false);
  }
  healthHandler = () => Response.json({ status: "ok" });
  const env = pure.context.process.env;
  env.NEXT_PUBLIC_PYTHON_API_BASE_URL = "";
  try {
    assert.equal(await service().irisChatService.health(), false, "not configured");
    await assert.rejects(service().irisChatService.send({ message: "x", conversationUuid: null }), (e) => e.errorCode === "not_configured");
    assert.equal(service().describeIrisError(new (pure.require("features/drive-vision/api/errors").ApiError)({ kind: "http", status: 503, errorCode: "not_configured", message: "", method: "POST", path: "/api/chat/message" })), "Iris isn't configured for this site.");
  } finally {
    env.NEXT_PUBLIC_PYTHON_API_BASE_URL = PY;
  }
});

test("the Python URL comes only from NEXT_PUBLIC_PYTHON_API_BASE_URL (python-client.ts); no host is hardcoded", () => {
  const files = [];
  const walk = (dir) => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name);
      if (f.isDirectory()) walk(p);
      else files.push(p);
    }
  };
  walk(SRC);
  same(files.filter((f) => /8088|185\.193|safefareai-api\.sconexsoft\.com\/safe-fare-python/.test(fs.readFileSync(f, "utf8"))), []);
  assert.match(read("features/drive-vision/api/iris-chat-service.ts"), /from "\.\/python-client"/);
  assert.match(fs.readFileSync(path.join(__dirname, "..", ".env.example"), "utf8"), /^NEXT_PUBLIC_PYTHON_API_BASE_URL=/m);
});

// ── 8–9. Markdown ───────────────────────────────────────────────────────────

const renderMarkdown = (text) => {
  const { IrisMarkdown } = ui.require("components/drive-vision/assistant/iris-markdown");
  return renderToStaticMarkup(React.createElement(IrisMarkdown, { text }));
};

test("renders headings, emphasis, lists, inline code and links", () => {
  const html = renderMarkdown("# Title\n\n**bold** *italic* `code`\n\n1. one\n2. two\n\n- a\n- b\n\n[docs](https://example.com/help)");
  for (const part of ["<h3", "<strong>bold</strong>", "<em>italic</em>", "<code", ">code</code>", "<ol", "<ul", "<li>one</li>"]) assert.ok(html.includes(part), part);
});

test("tables and code blocks render inside horizontal scrollers", () => {
  const html = renderMarkdown("| A | B |\n| - | - |\n| 1 | 2 |\n\n```ts\nconst a = 1;\n```");
  assert.match(html, /<div[^>]*overflow-x-auto[^>]*><table/);
  assert.ok(html.includes("<td"));
  assert.match(html, /<pre[^>]*overflow-x-auto/);
  assert.ok(html.includes("const a = 1;"));
});

test("external links open safely; app paths stay in the app", () => {
  const external = renderMarkdown("[docs](https://example.com/help)");
  assert.match(external, /href="https:\/\/example\.com\/help"/);
  assert.match(external, /target="_blank"/);
  assert.match(external, /rel="noopener noreferrer nofollow"/);
  const internal = renderMarkdown("[alerts](/drive-vision/alerts)");
  assert.match(internal, /href="\/drive-vision\/alerts"/);
  assert.match(internal, /data-internal="true"/);
  assert.doesNotMatch(internal, /_blank/);
});

test("unsafe link targets are dropped; the link text stays as plain text", () => {
  const { safeIrisHref } = model();
  for (const bad of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "java\tscript:alert(1)", "data:text/html,<script>alert(1)</script>", "vbscript:x", "file:///etc/passwd", "//evil.example", "/\\evil.example", "/\t/evil.example", "https://user:pw@evil.example", ""]) {
    assert.equal(safeIrisHref(bad), "", JSON.stringify(bad));
  }
  const html = renderMarkdown("[click](javascript:alert(1)) [data](data:text/html;base64,AAAA)");
  assert.doesNotMatch(html, /<a\b|javascript:|data:text/);
  assert.ok(html.includes("click"));
});

test("raw HTML and images in an answer never reach the DOM", () => {
  const html = renderMarkdown('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\nHello <b onclick="x()">bold</b>\n\n![tracker](https://evil.example/p.gif)');
  assert.doesNotMatch(html, /<script|<img|onerror|onclick|<b\b|evil\.example/);
  assert.ok(html.includes("Hello"));
  assert.ok(html.includes("tracker"), "an image's description is kept as text");
});

// ── 10–12. Composer ─────────────────────────────────────────────────────────

test("an empty or blank message can't be sent", async () => {
  await mount();
  await openIris();
  assert.equal(sendButton().disabled, true);
  await say("   \n  ");
  assert.equal(requests.length, 0);
  await type("hello");
  assert.equal(sendButton().disabled, false);
});

test("Enter sends, Shift+Enter doesn't, and Enter that confirms IME text doesn't", async () => {
  await mount();
  await openIris();
  await type("line one");
  await key({ key: "Enter", shiftKey: true });
  await key({ key: "Enter", isComposing: true });
  await settle();
  assert.equal(requests.length, 0);
  await key({ key: "Enter" });
  await settle();
  assert.equal(requests.length, 1);
});

test("multi-line text is sent intact and the composer is a textarea", async () => {
  await mount();
  await openIris();
  assert.equal(composer().tagName, "TEXTAREA");
  await say("line one\nline two");
  same(requests[0].body, { message: "line one\nline two" });
});

test("duplicate submissions are ignored, even before React re-renders", async () => {
  const pending = deferred();
  chatHandler = () => pending.promise;
  await mount();
  await openIris();
  await type("once");
  await act(async () => {
    for (let i = 0; i < 3; i++) composer().dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  });
  assert.equal(requests.length, 1);
  await type("again");
  assert.equal(sendButton().disabled, true, "Send stays disabled while a request is processing");
  await key({ key: "Enter" });
  assert.equal(requests.length, 1);
  assert.equal(composer().value, "again", "a draft blocked by the pending request isn't lost");
  await act(async () => pending.resolve(ok(SAFETY_RESPONSE)));
  await settle();
});

test("the user's message and a loading indicator appear at once, then the reply replaces the indicator", async () => {
  const pending = deferred();
  chatHandler = () => pending.promise;
  await mount();
  await openIris();
  await say(SAFETY_QUESTION);
  assert.equal(bubbles("user").length, 1);
  assert.ok($('[aria-label="Iris is thinking"]'));
  assert.equal(bubbles("assistant").length, 0);
  const before = scrolls.length;
  await act(async () => pending.resolve(ok(SAFETY_RESPONSE)));
  await settle();
  assert.equal($('[aria-label="Iris is thinking"]'), null);
  assert.equal(bubbles("assistant").length, 1);
  assert.ok(scrolls.length > before, "scrolls to the newest message");
});

// ── 13–15. Failures ─────────────────────────────────────────────────────────

test("a network error keeps the question, shows an error and Retry, and adds no assistant message", async () => {
  chatHandler = () => {
    throw new TypeError("Failed to fetch");
  };
  await mount();
  await openIris();
  await say(SAFETY_QUESTION);
  assert.equal(bubbles("user").length, 1);
  assert.equal(bubbles("assistant").length, 0);
  assert.ok($('[role="alert"]').textContent.includes("Can't reach Iris"));
  assert.ok(buttonNamed("Retry"));
  assert.ok($('[role="dialog"]').textContent.includes("Unavailable"));
});

test("Retry resends the same question once, without duplicating it, and keeps the conversation", async () => {
  await mount();
  await openIris();
  await say("first");
  chatHandler = () => new Response("{}", { status: 500 });
  await say("second");
  assert.ok($('[role="alert"]'));

  chatHandler = () => ok({ ...SAFETY_RESPONSE, assistant_message: "Recovered" });
  await click(buttonNamed("Retry"));
  assert.equal($('[role="alert"]'), null);
  assert.equal(requests.length, 3);
  same(requests[2].body, { message: "second", conversation_uuid: SAFETY_RESPONSE.conversation_uuid });
  assert.equal(bubbles("user").length, 2, "the question isn't added twice");
  assert.equal(bubbles("assistant").length, 2);
  assert.ok($('[role="dialog"]').textContent.includes("Connected"));
});

test("each status gets its own message, and server text and stack traces are never shown", async () => {
  const leak = JSON.stringify({ detail: "Traceback (most recent call last): sqlalchemy.exc token=abc" });
  const cases = [
    [400, "couldn't accept that message"],
    [401, "don't have access"],
    [403, "don't have access"],
    [404, "wasn't found"],
    [422, "couldn't accept that message"],
    [500, "unavailable right now"],
    [503, "unavailable right now"],
  ];
  for (const [status, expected] of cases) {
    chatHandler = () => new Response(leak, { status });
    const m = await mount(`all|${status}`);
    await openIris();
    await say("x");
    const alert = $('[role="alert"]').textContent;
    assert.ok(alert.includes(expected), `${status}: ${alert}`);
    assert.ok(alert.includes(`HTTP ${status}`));
    assert.doesNotMatch(alert, /Traceback|sqlalchemy|token=/);
    assert.equal(bubbles("assistant").length, 0);
    void m;
    await act(async () => roots.pop().unmount());
    window.document.body.innerHTML = "";
  }
});

test("malformed or incomplete responses are errors, and nothing is stored from them", async () => {
  const malformed = [
    () => new Response("<html>gateway</html>", { status: 200 }),
    () => ok({}),
    () => ok(null),
    () => ok({ ...SAFETY_RESPONSE, assistant_message: "" }),
    () => ok({ ...SAFETY_RESPONSE, assistant_message: "   " }),
    () => ok({ ...SAFETY_RESPONSE, assistant_message: 5 }),
    () => ok({ ...SAFETY_RESPONSE, conversation_uuid: "nope" }),
    () => ok({ ...SAFETY_RESPONSE, created_at: "yesterday" }),
    () => ok({ ...SAFETY_RESPONSE, user_message: undefined }),
  ];
  for (const [i, handler] of malformed.entries()) {
    chatHandler = handler;
    await mount(`all|m${i}`);
    await openIris();
    await say("x");
    assert.ok($('[role="alert"]').textContent.includes("couldn't be read"), `case ${i}`);
    assert.equal(bubbles("assistant").length, 0, `case ${i}`);
    chatHandler = () => ok(SAFETY_RESPONSE);
    requests = [];
    await click(buttonNamed("Retry"));
    same(requests[0].body, { message: "x" }, `case ${i}: no uuid was kept from the bad response`);
    await act(async () => roots.pop().unmount());
    window.document.body.innerHTML = "";
  }
});

test("errors keep their status and kind; server bodies are never shown", async () => {
  const send = () => service().irisChatService.send({ message: "x", conversationUuid: null });
  chatHandler = () => new Response('{"detail":"Unable to generate an Iris AI response."}', { status: 500 });
  await assert.rejects(send(), (e) => e.kind === "http" && e.status === 500 && !/Unable to generate/.test(e.message));
  chatHandler = () => new Response('{"detail":"Not Found"}', { status: 404 });
  await assert.rejects(send(), (e) => e.status === 404);
  chatHandler = () => new Response("<!DOCTYPE html><html><title>502</title></html>", { status: 502 });
  await assert.rejects(send(), (e) => e.status === 502 && /HTTP 502/.test(service().describeIrisError(e)));
  chatHandler = () => {
    throw new TypeError("Failed to fetch");
  };
  await assert.rejects(send(), (e) => e.kind === "network" && /CORS/.test(service().describeIrisError(e)));
  const ctl = new AbortController();
  chatHandler = () => (ctl.abort(), Promise.reject(new DOMException("aborted", "AbortError")));
  await assert.rejects(service().irisChatService.send({ message: "x", conversationUuid: null }, ctl.signal), (e) => e.kind === "aborted");
  chatHandler = () => ok(SAFETY_RESPONSE);
});

test("requests the contract doesn't allow are refused before anything is sent", async () => {
  const svc = service();
  for (const raw of [null, [], {}, { message: "" }, { message: "   " }, { message: 5 }, { message: "x", conversation_uuid: "nope" }, { message: "x".repeat(10_001) }]) assert.equal(svc.readChatRequest(raw), null, JSON.stringify(raw)?.slice(0, 30));
  same(svc.readChatRequest({ message: "x", conversation_uuid: null, tenant_id: 99 }), { message: "x" }, "null uuid is valid; unknown fields dropped");
  same(svc.readChatRequest({ message: "x".repeat(10_000) })?.message.length, 10_000, "the documented maximum is accepted");
  requests = [];
  await assert.rejects(svc.irisChatService.send({ message: "x".repeat(10_001), conversationUuid: null }), (e) => e.status === 400);
  await assert.rejects(svc.irisChatService.send({ message: "x", conversationUuid: "not-a-uuid" }), (e) => e.status === 400);
  same(requests, [], "nothing sent");
});

// ── 16–17. Conversation and session separation ──────────────────────────────

test("New chat starts a conversation without the old uuid and clears the thread", async () => {
  await mount();
  await openIris();
  await say("first");
  await click($('button[aria-label="New chat"]'));
  assert.equal(bubbles("user").length, 0);
  assert.equal(bubbles("assistant").length, 0);

  chatHandler = () => ok({ ...SAFETY_RESPONSE, conversation_uuid: SECOND_UUID });
  await say("fresh");
  same(requests[1].body, { message: "fresh" });
  await say("next");
  same(requests[2].body, { message: "next", conversation_uuid: SECOND_UUID });
});

test("a reply arriving after New chat is dropped, not added to the new conversation", async () => {
  const late = deferred();
  chatHandler = () => late.promise;
  await mount();
  await openIris();
  await say("old conversation");
  await click($('button[aria-label="New chat"]'));
  assert.equal(requests[0].signal.aborted, true, "the old request is aborted");
  await act(async () => late.resolve(ok({ ...SAFETY_RESPONSE, assistant_message: "OLD ANSWER" })));
  await settle();
  assert.equal(bubbles("assistant").length, 0);

  chatHandler = () => ok({ ...SAFETY_RESPONSE, conversation_uuid: SECOND_UUID, assistant_message: "New answer" });
  await say("new conversation");
  same(requests[1].body, { message: "new conversation" }, "the old conversation's uuid never leaks in");
  assert.equal(bubbles("assistant").length, 1);
  assert.ok(!$('[role="dialog"]').textContent.includes("OLD ANSWER"));
});

test("a reply from a different conversation is rejected rather than mixed in", async () => {
  await mount();
  await openIris();
  await say("first");
  chatHandler = () => ok({ ...SAFETY_RESPONSE, conversation_uuid: SECOND_UUID, assistant_message: "FOREIGN" });
  await say("second");
  assert.equal(bubbles("assistant").length, 1);
  assert.ok(!$('[role="dialog"]').textContent.includes("FOREIGN"));
  assert.ok($('[role="alert"]'));
});

test("a tenant switch or another user discards the conversation and aborts its request", async () => {
  const late = deferred();
  const { rerender } = await mount("t:1|1");
  await openIris();
  await say("tenant one question");
  chatHandler = () => late.promise;
  await say("still running");

  await rerender("t:2|1");
  assert.equal(requests[1].signal.aborted, true);
  await act(async () => late.resolve(ok({ ...SAFETY_RESPONSE, assistant_message: "TENANT ONE ANSWER" })));
  await settle();

  // The shell keeps the panel open across the remount, so it now shows an empty conversation.
  assert.equal(bubbles("user").length, 0);
  assert.equal(bubbles("assistant").length, 0);

  chatHandler = () => ok({ ...SAFETY_RESPONSE, conversation_uuid: SECOND_UUID });
  await say("tenant two question");
  same(requests[2].body, { message: "tenant two question" }, "no conversation_uuid crosses the switch");
});

test("the app shell keys Iris by tenant scope and user, and nothing is persisted to storage", () => {
  assert.match(read("components/drive-vision/app-shell/app-shell.tsx"), /<DriveVisionAIAssistant key=\{`\$\{tenantScope\}\|\$\{access\.identity\?\.userId \?\? "none"\}`\}/);
  for (const file of ["components/drive-vision/assistant/ai-assistant.tsx", "components/drive-vision/assistant/iris-chat-model.ts", "features/drive-vision/api/iris-chat-service.ts"]) {
    assert.doesNotMatch(read(file), /localStorage|sessionStorage|indexedDB/, file);
  }
});

test("every role, including Driver, gets Iris; signed-out users don't", () => {
  const p = pure.require("features/drive-vision/access/access-policy");
  const idm = pure.require("features/drive-vision/access/identity");
  const roles = { ...IDENTITIES, operator: { ...IDENTITIES.viewer, roleCode: "TEST_OPERATOR", permissions: ["device.read", "alarm.read"] } };
  for (const [name, raw] of Object.entries(roles)) {
    assert.equal(p.canUseFeature(p.computeAccess(idm.readIdentity(raw)), "assistant"), true, name);
  }
  assert.equal(p.canUseFeature(p.computeAccess(null), "assistant"), false);
});

// ── 18. Responsive layout ───────────────────────────────────────────────────

test("narrow screens get a near-full-screen modal sheet, wide screens a docked panel", async () => {
  await mount();
  await openIris();
  const sheet = $('[role="dialog"]');
  assert.match(sheet.className, /inset-x-2/);
  assert.match(sheet.className, /sm:w-\[400px\]/);
  assert.ok(sheet.className.includes("z-50"));
  await act(async () => roots.pop().unmount());
  window.document.body.innerHTML = "";

  wide = true;
  await mount("all|2");
  await openIris();
  const docked = $('[role="dialog"]');
  assert.match(docked.className, /w-\[384px\]/);
  assert.doesNotMatch(docked.className, /inset-x-2/);
});

test("the composer sits outside the scrolling thread, and a long message wraps", async () => {
  await mount();
  await openIris();
  const thread = $('[aria-live="polite"]');
  assert.match(thread.className, /min-h-0 flex-1 overflow-y-auto/);
  assert.equal(thread.contains(composer()), false);
  assert.match($('[role="dialog"]').className, /flex flex-col overflow-hidden/);
  await say("x".repeat(400));
  assert.match(bubbles("user")[0].querySelector("p").className, /break-words/);
  assert.match(bubbles("user")[0].firstElementChild.className, /min-w-0/);
});

// ── 20. No fabricated answers ───────────────────────────────────────────────

test("a suggested question sends a real request, and only the server's text is shown", async () => {
  chatHandler = () => ok({ ...SAFETY_RESPONSE, assistant_message: "Exactly the server's words" });
  await mount();
  await openIris();
  await click(buttonNamed("How do I add a vehicle?"));
  same(requests[0].body, { message: "How do I add a vehicle?" });
  assert.equal(bubbles("assistant").length, 1);
  assert.ok(bubbles("assistant")[0].textContent.startsWith("Exactly the server's words"));
});

test("no local answers: Iris no longer calls the old BFF assistant, and has no canned reply path", () => {
  const source = read("components/drive-vision/assistant/ai-assistant.tsx");
  assert.doesNotMatch(source, /assistantService|assistant\/ask|assistant\/prompts/);
  assert.match(source, /dispatch\(\{ type: "reply", reply \}\)/);
  assert.equal((source.match(/role: "assistant"/g) ?? []).length, 0, "the component never builds an assistant message itself");
});

// ── Model details not reached through the UI ────────────────────────────────

test("the reducer ignores a send while pending and a retry with nothing to retry", () => {
  const { irisChatReducer: r, initialIrisChat: init } = model();
  assert.equal(r(init, { type: "retry" }), init);
  const sending = r(init, { type: "send", text: "a", at: 1 });
  assert.equal(r(sending, { type: "send", text: "b", at: 2 }), sending);
});

test("timestamps show the date only when it isn't today", () => {
  const { formatIrisTime } = model();
  const at = Date.parse(SAFETY_ISO);
  assert.doesNotMatch(formatIrisTime(at, at), /,/);
  assert.match(formatIrisTime(at, at + 3 * 86_400_000), /,/);
});
