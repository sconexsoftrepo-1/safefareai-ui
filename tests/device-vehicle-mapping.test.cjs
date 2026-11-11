// Device ↔ vehicle mapping (Add / Edit device, reassignment, unlink) and the Sensors vehicle source.
// MOCKED / SYNTHETIC ONLY: devices, vehicles, identities and responses are synthetic; every request goes to a stub
// fetch. Nothing here talks to the Safe-Fare backend, so none of it proves how the live backend behaves (see
// docs/device-vehicle-mapping-integration-report.md, "Requires live verification").
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const { createRealm } = require("./helpers/load-ts.cjs");
const { MemoryStorage, createLockManager } = require("./helpers/browser-fakes.cjs");
const { IDENTITIES } = require("./helpers/identities.cjs");

const SRC = path.join(__dirname, "..", "src");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");
const same = (got, want) => assert.equal(JSON.stringify(got), JSON.stringify(want));

// ── jsdom + React ───────────────────────────────────────────────────────────

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost:3000/drive-vision/vehicles", pretendToBeVisual: true });
const { window } = dom;
for (const key of ["window", "document", "HTMLElement", "Element", "Node", "MutationObserver", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "CustomEvent", "Event", "DocumentFragment", "NodeFilter"]) {
  Object.defineProperty(globalThis, key, { value: key === "window" ? window : window[key], configurable: true, writable: true });
}
Object.defineProperty(globalThis, "navigator", { value: window.navigator, configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
window.HTMLElement.prototype.scrollTo = () => {};
window.HTMLElement.prototype.scrollIntoView = () => {};
window.HTMLElement.prototype.hasPointerCapture = () => false;
window.HTMLElement.prototype.releasePointerCapture = () => {};

const React = require("react");
const { act } = React;
const { createRoot } = require("react-dom/client");
const { renderToStaticMarkup } = require("react-dom/server");

// ── Stub backend ────────────────────────────────────────────────────────────

let requests = [];
let handlers = {};
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const envelope = (data, total = null) => json(200, { code: 200, msg: "Success", data, total, extend: null });
const failure = (status, errorCode, msg) => json(status, { code: status, msg, data: null, extend: { errorCode, requestId: "req-synthetic" } });
const headerOf = (init, name) => {
  const h = init.headers ?? {};
  if (typeof h.get === "function") return h.get(name) ?? undefined;
  return Object.entries(h).find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1];
};
async function stubFetch(url, init = {}) {
  const u = new URL(String(url), "http://localhost:3000");
  const req = { method: init.method ?? "GET", path: u.pathname, route: u.pathname.replace(/^\/api\/v1/, ""), query: Object.fromEntries(u.searchParams), tenant: headerOf(init, "x-tenant-id"), body: init.body ? JSON.parse(init.body) : undefined };
  requests.push(req);
  for (const [pattern, fn] of Object.entries(handlers)) if (new RegExp(`^${pattern}$`).test(`${req.method} ${req.route}`)) return fn(req);
  return envelope({});
}
const writes = () => requests.filter((r) => r.method !== "GET");
const vehicleListCalls = () => requests.filter((r) => r.method === "GET" && r.route === "/vehicles");

// ── Module stubs (same approach as tests/sensor-alerts.test.cjs) ────────────

const motionTags = new Map();
const MOTION_ONLY = new Set(["initial", "animate", "exit", "transition", "variants", "whileHover", "whileTap", "layout", "layoutId"]);
const motion = new Proxy({}, { get: (_, tag) => (motionTags.has(tag) || motionTags.set(tag, React.forwardRef((props, ref) => React.createElement(tag, { ...Object.fromEntries(Object.entries(props).filter(([k]) => !MOTION_ONLY.has(k))), ref }))), motionTags.get(tag)) });

/** Native <select> stand-in for the Radix Select. Options carry the item's full text and markup (badges, holder line). */
const SelectCtx = React.createContext(null);
const selectStub = {
  Select: ({ value, onValueChange, disabled, children }) => React.createElement(SelectCtx.Provider, { value: { value, onValueChange, disabled } }, React.createElement("div", { "data-select-root": "" }, children)),
  SelectTrigger: ({ id, children }) => React.createElement("span", { "data-select-trigger": id ?? "" }, children),
  SelectValue: ({ children, placeholder }) => React.createElement("span", { "data-select-value": "" }, children ?? placeholder ?? null),
  SelectContent: ({ children }) => {
    const ctx = React.useContext(SelectCtx);
    return React.createElement("select", { "data-select": "", value: ctx.value ?? "", disabled: ctx.disabled, onChange: (e) => ctx.onValueChange(e.target.value) }, React.createElement("option", { value: "" }, "—"), children);
  },
  SelectItem: ({ value, children }) => {
    const html = renderToStaticMarkup(React.createElement(React.Fragment, null, children));
    return React.createElement("option", { value, "data-html": html }, html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
  },
  SelectGroup: ({ children }) => children,
  SelectLabel: () => null,
  SelectSeparator: () => null,
  SelectScrollUpButton: () => null,
  SelectScrollDownButton: () => null,
};

let toasts = [];
let currentAccess = null;
let ui;
let pure;
function buildRealms() {
  const storage = new MemoryStorage();
  const session = JSON.stringify({ accessToken: "a.b.c", tokenType: "Bearer", accessExpiresAt: Date.now() + 3_600_000, refreshToken: "r", refreshExpiresAt: null });
  storage.setItem("safefare:session:v1", session);
  window.sessionStorage.setItem("safefare:session:v1", session);
  const sink = Object.fromEntries(["log", "info", "warn", "error", "debug"].map((k) => [k, () => {}]));
  const record = (kind) => (title, opts) => toasts.push({ kind, title, description: opts?.description });
  const modules = {
    react: React,
    "react/jsx-runtime": require("react/jsx-runtime"),
    "motion/react": { motion, AnimatePresence: ({ children }) => children, useReducedMotion: () => true },
    "radix-ui": require("radix-ui"),
    "lucide-react": require("lucide-react"),
    clsx: require("clsx"),
    "tailwind-merge": require("tailwind-merge"),
    "class-variance-authority": require("class-variance-authority"),
    "next/navigation": { useSearchParams: () => new URLSearchParams(), usePathname: () => "/drive-vision/vehicles", useRouter: () => ({ push() {}, replace() {}, back() {} }) },
    "next/link": { __esModule: true, default: ({ href, children, ...rest }) => React.createElement("a", { href, ...rest }, children) },
    sonner: { toast: Object.assign(record("message"), { success: record("success"), error: record("error"), info: record("info"), warning: record("warning") }), Toaster: () => null },
    "next-themes": { useTheme: () => ({ theme: "light" }) },
    "@/components/ui/select": selectStub,
    "@/features/drive-vision/access/use-access": {
      useAccess: () => currentAccess,
      useActionGate: (action) => {
        const block = ui.require("features/drive-vision/access/access-policy").actionBlock(currentAccess, action);
        return { allowed: block === null, tenantBlocked: block === "tenant" };
      },
      useCan: () => false,
    },
  };
  const globals = {
    console: sink,
    fetch: (...a) => stubFetch(...a),
    AbortController,
    AbortSignal,
    Response,
    Request,
    Headers,
    URL,
    URLSearchParams,
    sessionStorage: storage,
    localStorage: new MemoryStorage(),
    navigator: { locks: createLockManager() },
    performance,
    crypto: globalThis.crypto,
    atob,
    btoa,
    structuredClone,
    queueMicrotask,
    process: { env: { NODE_ENV: "test", NEXT_PUBLIC_API_BASE_URL: "http://api.test" } },
  };
  ui = createRealm({ ...globals, window, document: window.document, HTMLElement: window.HTMLElement }, modules);
  pure = createRealm(globals, modules);
}
buildRealms();

const vm = () => pure.require("components/drive-vision/vehicles/device-vehicle-model");
const cm = () => pure.require("components/drive-vision/vehicles/device-create-model");
const em = () => pure.require("components/drive-vision/vehicles/device-edit-model");
const sm = () => pure.require("components/drive-vision/sensors/sensors-model");
const ApiError = () => pure.require("features/drive-vision/api/errors").ApiError;
const accessFor = (raw, selectedTenantId = null) => {
  const p = ui.require("features/drive-vision/access/access-policy");
  const idm = ui.require("features/drive-vision/access/identity");
  return p.computeAccess(idm.readIdentity(raw), undefined, { selectedTenantId });
};

const roots = [];
test.afterEach(async () => {
  while (roots.length) {
    const root = roots.pop();
    await act(async () => root.unmount());
  }
  window.document.body.innerHTML = "";
  requests = [];
  handlers = {};
  toasts = [];
  ui.require("features/drive-vision/api/tenant-context").setTenantSelection(null);
  pure.require("features/drive-vision/api/tenant-context").setTenantSelection(null);
});

const settle = async (rounds = 12) => {
  for (let i = 0; i < rounds; i += 1) await act(async () => new Promise((r) => setTimeout(r, 0)));
};
const $ = (s) => window.document.querySelector(s);
const $$ = (s) => [...window.document.querySelectorAll(s)];
const click = async (el) => {
  assert.ok(el, "element to click");
  await act(async () => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true })));
  await settle();
};
const choose = async (selectEl, value) => {
  assert.ok(selectEl, "select to choose from");
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
  await act(async () => {
    setter.call(selectEl, value);
    selectEl.dispatchEvent(new window.Event("change", { bubbles: true }));
  });
  await settle();
};
const type = async (input, value) => {
  const proto = input instanceof window.HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
  await settle(2);
};
/** The native select of the Radix Select whose trigger has this id. */
const selectFor = (id) => $$("[data-select-root]").find((r) => r.querySelector(`[data-select-trigger="${id}"]`))?.querySelector("select[data-select]");
const optionFor = (id, value) => [...(selectFor(id)?.options ?? [])].find((o) => o.value === value);
const alertDialog = () => $('[role="alertdialog"]');
const dialogButton = (label) => $$('[role="alertdialog"] button').find((b) => b.textContent.trim() === label);
const submitForm = async (id) => {
  await act(async () => $(`#${id}`).dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })));
  await settle();
};

// ── Synthetic data ──────────────────────────────────────────────────────────

const MODELS = [{ id: 11, name: "Synthetic-M1", protocols: [{ code: 1, name: "JT808" }] }];
/** The device being edited: fitted in vehicle 101. */
const DEVICE = { id: 7, groupId: 2, name: "Camera-07", terminalNo: "ABC12345678", modelId: 11, protocolCode: 1, objectTypeId: 3, cameraCount: 2, remark: "Synthetic", maintenanceDueAt: "2026-06-15T10:20:30Z", driver: { name: "Synthetic Driver", gender: 1 }, vehicleId: 101 };
/** Its full DeviceRequest as stored: every PUT must carry all of this. */
const DEVICE_REQUEST = { groupId: 2, name: "Camera-07", terminalNo: "ABC12345678", modelName: "Synthetic-M1", protocol: 1, objectTypeId: 3, cameraCount: 2, remark: "Synthetic", maintenanceDueAt: "2026-06-15T10:20:30Z", driverName: "Synthetic Driver", driverGender: 1 };
const REQUIRED = ["groupId", "name", "terminalNo", "modelName", "protocol", "objectTypeId", "cameraCount"];
/** GET /vehicles rows: 101 on the edited device, 102 on another device, 103 free. Ids ≠ device ids on purpose. */
const VEHICLES = [
  { id: 103, vehicleNumber: "KA01FREE01", vehicleType: "Van", make: "Force", model: "Traveller", status: "ACTIVE", deviceAssigned: false, device: null },
  { id: 101, vehicleNumber: "AP31Z0044", vehicleType: "Truck", make: "Tata", model: "Prima", status: "ACTIVE", deviceAssigned: true, device: { id: 7, name: "Camera-07", terminalNo: "ABC12345678" } },
  { id: 102, vehicleNumber: "AP39AB1234", vehicleType: "Bus", make: "Ashok Leyland", model: null, status: "ACTIVE", deviceAssigned: true, device: { id: 501, name: "Camera-01", terminalNo: "AZIdgjG2W6eyucB" } },
];
const LOCKED_LABELS = { modelName: "Synthetic-M1", protocol: "JT808", cameraCount: "2", terminalNo: "ABC12345678", groupId: "Group 2", objectTypeId: "Bus", driverGender: "1" };

function backend({ vehicles = VEHICLES, put = () => envelope({ ...DEVICE }), post = (r) => envelope({ id: 900, name: r.body.name, terminalNo: r.body.terminalNo }) } = {}) {
  handlers = {
    "GET /vehicles": () => envelope(vehicles, vehicles.length),
    "GET /reference/protocols": () => envelope([{ code: 1, name: "JT808" }]),
    "GET /reference/object-types": () => envelope([{ id: 3, name: "Bus" }]),
    "PUT /devices/\\d+": put,
    "POST /devices": post,
  };
}

async function mountEdit({ device = DEVICE, identity = IDENTITIES.tenantAdmin, tenant = null } = {}) {
  currentAccess = accessFor(identity, tenant);
  const { DeviceEditPanel } = ui.require("components/drive-vision/vehicles/device-edit-panel");
  const calls = { saved: 0, reload: 0, closed: 0 };
  const host = window.document.body.appendChild(window.document.createElement("div"));
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(React.createElement(DeviceEditPanel, { device, models: MODELS, lockedLabels: LOCKED_LABELS, open: true, onClose: () => calls.closed++, onSaved: () => calls.saved++, onNeedsReload: () => calls.reload++ })));
  await settle();
  return calls;
}

async function mountCreate({ identity = IDENTITIES.tenantAdmin } = {}) {
  currentAccess = accessFor(identity);
  const { DeviceCreatePanel } = ui.require("components/drive-vision/vehicles/device-create-panel");
  const calls = { created: [], uncertain: 0 };
  const host = window.document.body.appendChild(window.document.createElement("div"));
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(React.createElement(DeviceCreatePanel, { groups: [{ id: 2, name: "Group 2" }], models: MODELS, onClose() {}, onCreated: (d) => calls.created.push(d), onUncertain: () => calls.uncertain++ })));
  await settle();
  return calls;
}

async function fillCreateRequired() {
  await type($("#dc-name"), "Camera-New");
  await type($("#dc-terminalNo"), "71080050829");
  await choose(selectFor("dc-groupId"), "2");
  await choose(selectFor("dc-modelId"), "11");
  await choose(selectFor("dc-protocol"), "1");
  await choose(selectFor("dc-objectTypeId"), "3");
}

// ═══ 1. Pure model ══════════════════════════════════════════════════════════

test("VM options: id is the vehicle id; number, type · make model, Available / Assigned, holder device; sorted by number", () => {
  const o = vm().toVehicleOptions([...VEHICLES, { id: 0, vehicleNumber: "X" }, { id: 104, vehicleNumber: " " }, { vehicleNumber: "NOID" }]);
  same(o.map((v) => v.vehicleId), [101, 102, 103], "invalid rows dropped; sorted by vehicle number");
  same(o[1], { vehicleId: 102, vehicleNumber: "AP39AB1234", vehicleType: "Bus", makeModel: "Ashok Leyland", status: "ACTIVE", assigned: true, deviceId: 501, deviceName: "Camera-01", terminalNo: "AZIdgjG2W6eyucB" });
  assert.equal(vm().vehicleDetailLine(o[0]), "Truck · Tata Prima");
  assert.equal(vm().vehicleDetailLine(o[1]), "Bus · Ashok Leyland");
  same(o.map((v) => vm().assignmentState(v)), ["assigned-elsewhere", "assigned-elsewhere", "available"], "Add device: every assigned vehicle is elsewhere");
  same(o.map((v) => vm().assignmentState(v, 7)), ["current", "assigned-elsewhere", "available"], "Edit device 7");
  same(o.map((v) => vm().needsReassignConfirm(v, 7)), [false, true, false]);
  assert.equal(vm().holderLabel(o[1]), "Camera-01");
  assert.equal(vm().holderLabel({ ...o[1], deviceName: null }), "AZIdgjG2W6eyucB", "terminal number when there's no name");
  same(vm().toVehicleOptions(undefined), []);
  same(vm().toVehicleOptions({}), [], "a non-array payload is treated as empty");
});

test("VM current vehicle: DeviceDto.vehicleId, else the vehicle whose device.id is this device; null = none", () => {
  const o = vm().toVehicleOptions(VEHICLES);
  assert.equal(vm().currentVehicleId(DEVICE, o), 101);
  assert.equal(vm().currentVehicleId({ id: 7, vehicleId: null }, o), null, "server says: not fitted");
  assert.equal(vm().currentVehicleId({ id: 7 }, o), 101, "field missing: looked up by device.id");
  assert.equal(vm().currentVehicleId({ id: 8 }, o), null);
  assert.equal(vm().currentVehicleId({ id: 7 }, undefined), null);
});

test("VM mapping: assign → {vehicleId, unlinkVehicle:false}; unlink → {vehicleId:0, unlinkVehicle:true}; keep → neither; required fields untouched", () => {
  const assign = vm().applyMapping(DEVICE_REQUEST, { kind: "assign", vehicleId: 102, vehicleNumber: "AP39AB1234", reassign: true });
  same(assign, { ...DEVICE_REQUEST, vehicleId: 102, unlinkVehicle: false });
  const unlink = vm().applyMapping(DEVICE_REQUEST, { kind: "unlink" });
  same(unlink, { ...DEVICE_REQUEST, vehicleId: 0, unlinkVehicle: true });
  const keep = vm().applyMapping({ ...DEVICE_REQUEST, vehicleId: 5, unlinkVehicle: true }, vm().KEEP);
  same(keep, DEVICE_REQUEST, "keep strips stray mapping fields");
  for (const body of [assign, unlink, keep]) for (const k of REQUIRED) assert.ok(k in body, k);
  same(vm().withCreateVehicle(DEVICE_REQUEST, "103"), { ...DEVICE_REQUEST, vehicleId: 103, unlinkVehicle: false });
  same(vm().withCreateVehicle(DEVICE_REQUEST, ""), DEVICE_REQUEST, "no vehicle chosen → no invented id");
  same(vm().withCreateVehicle(DEVICE_REQUEST, "0"), DEVICE_REQUEST);
});

test("VM list notices: empty list, all assigned, none free, truncated", () => {
  const o = vm().toVehicleOptions(VEHICLES);
  assert.match(vm().vehicleListNotice([]), /No vehicles are registered/);
  assert.match(vm().vehicleListNotice(o.filter((v) => v.assigned)), /Every vehicle already has a device/);
  assert.match(vm().vehicleListNotice(o.filter((v) => v.assigned), { editingDeviceId: 7 }), /No other vehicle is available/);
  assert.equal(vm().vehicleListNotice(o), null);
  assert.match(vm().vehicleListNotice(o, { truncated: true, total: 2500 }), /first 3 of 2500 vehicles/);
});

test("VM errors: the backend's message is shown for 400 / 403 / 404 / 409 / 502 / 503 / 504; 409 is a conflict that restores the mapping", () => {
  const E = (status, errorCode, message, kind = "http") => new (ApiError())({ kind, status, errorCode, message, method: "PUT", path: "/devices/7" });
  const reassign = { kind: "assign", vehicleId: 102, vehicleNumber: "AP39AB1234", reassign: true };
  const c409 = vm().describeMappingError(E(409, "RESOURCE_IN_USE", "Vehicle AP39AB1234 already has device Camera-01"), reassign);
  assert.equal(c409.conflict, true);
  assert.equal(c409.refetch, true);
  assert.match(c409.message, /^Vehicle AP39AB1234 wasn't assigned: Vehicle AP39AB1234 already has device Camera-01/);
  assert.match(c409.message, /nothing was unlinked by the app/);
  assert.match(vm().describeMappingError(E(409, "OPERATION_NOT_ALLOWED", "Vehicle is INACTIVE"), reassign).message, /Vehicle is INACTIVE/);
  assert.match(vm().describeMappingError(E(409, undefined, ""), reassign).message, /HTTP 409/);
  const bad = vm().describeMappingError(E(400, "INVALID_VALUE", "vehicleId and unlinkVehicle can't both be set"), { kind: "unlink" });
  assert.equal(bad.conflict, true);
  assert.match(bad.message, /^The vehicle wasn't unlinked: vehicleId and unlinkVehicle can't both be set/);
  assert.match(vm().describeMappingError(E(403, "FORBIDDEN", ""), reassign).message, /device\.update/);
  assert.match(vm().describeMappingError(E(404, "NOT_FOUND", "Device not found"), reassign).message, /Device not found/);
  for (const s of [502, 503]) assert.equal(vm().describeMappingError(E(s, "VENDOR_UNAVAILABLE", "Vendor down"), reassign).refetch, true, String(s));
  const t504 = vm().describeMappingError(E(504, "GATEWAY_TIMEOUT", ""), reassign);
  assert.equal(t504.refetch, true);
  assert.match(t504.message, /No clear answer/);
  assert.match(vm().describeMappingError(E(0, undefined, "Network error", "network"), { kind: "unlink" }).message, /check its vehicle/);
  // An ordinary edit (no mapping change) keeps the existing messages.
  same(vm().describeMappingError(E(400, "VALIDATION_FAILED", "Bad name"), vm().KEEP).message, em().describeSaveError(E(400, "VALIDATION_FAILED", "Bad name")).message);
});

test("DC model + vehicle: chosen vehicle id → vehicleId with unlinkVehicle:false next to the 7 required fields; none → neither; conflicts map to the field", () => {
  const ok = { ...cm().EMPTY_CREATE_FORM, name: "Camera-New", terminalNo: "71080050829", groupId: "2", modelId: "11", protocol: "1", objectTypeId: "3", cameraCount: "2" };
  const required = { groupId: 2, name: "Camera-New", terminalNo: "71080050829", modelName: "Synthetic-M1", protocol: 1, objectTypeId: 3, cameraCount: 2 };
  assert.equal(cm().EMPTY_CREATE_FORM.vehicleId, "", "no vehicle by default");
  same(cm().buildCreate(ok, MODELS), required, "unassigned create unchanged");
  same(cm().buildCreate({ ...ok, vehicleId: "103" }, MODELS), { ...required, vehicleId: 103, unlinkVehicle: false });
  same(cm().validateCreate({ ...ok, vehicleId: "103" }, MODELS), {});
  assert.ok(cm().validateCreate({ ...ok, vehicleId: "AP31Z0044" }, MODELS).vehicleId, "a vehicle number is never a vehicleId");
  const E = (status, errorCode, message) => new (ApiError())({ kind: "http", status, errorCode, message, method: "POST", path: "/devices" });
  const out = cm().describeCreateError(E(409, "RESOURCE_IN_USE", "Vehicle already has another device"));
  assert.equal(out.kind, "error");
  assert.equal(out.fieldErrors.vehicleId, "Vehicle already has another device");
  assert.match(out.message, /wasn't registered: Vehicle already has another device/);
  assert.equal(cm().describeCreateError(E(409, "CONFIRMATION_REQUIRED", "1 coin")).kind, "confirm", "charge confirmation unchanged");
});

// ═══ 2. Services (stub fetch) ═══════════════════════════════════════════════

test("VR service: listAllVehicles pages by 100 (Swagger max) until total, sends no `assigned` filter for the device form, flags truncation", async () => {
  const all = Array.from({ length: 150 }, (_, i) => ({ id: i + 1, vehicleNumber: `V${String(i + 1).padStart(3, "0")}` }));
  handlers = { "GET /vehicles": (r) => envelope(all.slice((Number(r.query.pageNumber) - 1) * 100, Number(r.query.pageNumber) * 100), all.length) };
  const svc = pure.require("features/drive-vision/api/vehicle-registry-service").vehicleRegistryService;
  const res = await svc.listAllVehicles();
  assert.equal(res.items.length, 150);
  assert.equal(res.truncated, false);
  same(vehicleListCalls().map((r) => r.query), [{ pageNumber: "1", pageSize: "100" }, { pageNumber: "2", pageSize: "100" }], "both assigned and unassigned: no assigned param");
  requests = [];
  const capped = await svc.listAllVehicles({}, 1);
  assert.equal(capped.truncated, true, "more than fetched is reported, never hidden");
  assert.equal(capped.total, 150);
  requests = [];
  await svc.listAllVehicles({ assigned: true });
  same(vehicleListCalls()[0].query, { assigned: "true", pageNumber: "1", pageSize: "100" }, "Sensors source");
});

test("VR service tenant: Safe-Fare Admin's selected tenant in X-Tenant-Id (never ?tenantId); none in all-tenants mode", async () => {
  backend();
  const svc = pure.require("features/drive-vision/api/vehicle-registry-service").vehicleRegistryService;
  await svc.listAllVehicles();
  pure.require("features/drive-vision/api/tenant-context").setTenantSelection({ tenantId: 42, code: "T42", name: "Tenant 42", header: "X-Tenant-Id" });
  await svc.listAllVehicles({ assigned: true });
  const fleet = pure.require("features/drive-vision/api/fleet-service").fleetService;
  await fleet.updateDevice(7, vm().applyMapping(DEVICE_REQUEST, { kind: "unlink" }));
  same(requests.map((r) => r.tenant ?? null), [null, "42", "42"]);
  for (const r of requests) assert.ok(!("tenantId" in r.query));
});

test("VR service: reassignment / unlink use PUT /devices/{id} only — never POST /devices/transfer, never a second request", async () => {
  backend();
  const fleet = pure.require("features/drive-vision/api/fleet-service").fleetService;
  await fleet.updateDevice(7, vm().applyMapping(DEVICE_REQUEST, { kind: "assign", vehicleId: 102, vehicleNumber: "AP39AB1234", reassign: true }));
  same(writes().map((r) => `${r.method} ${r.route}`), ["PUT /devices/7"]);
  same(writes()[0].body, { ...DEVICE_REQUEST, vehicleId: 102, unlinkVehicle: false });
  for (const f of ["components/drive-vision/vehicles/device-edit-panel.tsx", "components/drive-vision/vehicles/device-vehicle-model.ts", "components/drive-vision/vehicles/vehicle-assign-field.tsx", "components/drive-vision/vehicles/device-create-panel.tsx"]) {
    // Code only (the doc comments state that the transfer endpoint is NOT used).
    assert.doesNotMatch(read(f), /["'`]\/devices\/transfer|transferDevice\(/, f);
  }
});

// ═══ 3. Add device (real component) ═════════════════════════════════════════

test("Add device: Assign Vehicle loads ALL vehicles (GET /vehicles, no assigned filter) with Available / Assigned labels and the holder device", async () => {
  backend();
  await mountCreate();
  same(vehicleListCalls().map((r) => r.query), [{ pageNumber: "1", pageSize: "100" }]);
  assert.equal($('label[for="dc-vehicleId"]').textContent.trim(), "Assign Vehicle");
  const values = [...selectFor("dc-vehicleId").options].map((o) => o.value);
  same(values, ["", "none", "101", "102", "103"], "values are vehicle ids, plus 'No vehicle'");
  const free = optionFor("dc-vehicleId", "103");
  assert.match(free.textContent, /^KA01FREE01 Available Van · Force Traveller$/);
  assert.match(free.dataset.html, /data-state="available"/);
  const taken = optionFor("dc-vehicleId", "102");
  assert.equal(taken.textContent, "AP39AB1234 Assigned Bus · Ashok Leyland Currently assigned to: Camera-01");
  assert.match(taken.dataset.html, /data-state="assigned-elsewhere"/);
  assert.match(taken.dataset.html, /text-warning/, "assigned = amber");
  assert.match(free.dataset.html, /text-success/, "available = green");
});

test("Add device: the chosen vehicle's id is POSTed as vehicleId with unlinkVehicle:false and every required field; success closes and reports", async () => {
  backend();
  const calls = await mountCreate();
  await fillCreateRequired();
  await choose(selectFor("dc-vehicleId"), "103");
  assert.equal(alertDialog(), null, "an available vehicle needs no confirmation");
  await submitForm("device-create-form");
  same(writes().map((r) => `${r.method} ${r.route}`), ["POST /devices"]);
  same(writes()[0].body, { groupId: 2, name: "Camera-New", terminalNo: "71080050829", modelName: "Synthetic-M1", protocol: 1, objectTypeId: 3, cameraCount: 0, vehicleId: 103, unlinkVehicle: false });
  assert.equal(calls.created.length, 1, "onCreated → the page closes the panel and refetches the list");
  same(toasts.map((t) => t.kind), ["success"]);
  assert.match(toasts[0].description, /assigned to KA01FREE01/);
});

test("Add device: without a vehicle the POST has no vehicleId / unlinkVehicle (existing behaviour); a picked assigned vehicle asks first", async () => {
  backend();
  await mountCreate();
  await fillCreateRequired();
  await choose(selectFor("dc-vehicleId"), "102");
  assert.ok(alertDialog(), "Vehicle Already Assigned");
  assert.match(alertDialog().textContent, /Vehicle AP39AB1234 is currently assigned to another device/);
  assert.match(alertDialog().textContent, /device you are adding/);
  await click(dialogButton("Cancel"));
  assert.equal(selectFor("dc-vehicleId").value, "none", "previous choice kept");
  await choose(selectFor("dc-vehicleId"), "none");
  await submitForm("device-create-form");
  const body = writes()[0].body;
  assert.equal("vehicleId" in body, false);
  assert.equal("unlinkVehicle" in body, false);
  for (const k of REQUIRED) assert.ok(k in body, k);
});

test("Add device: a 409 on the vehicle keeps the form, shows the server's message on the field, and never reports success", async () => {
  backend({ post: () => failure(409, "RESOURCE_IN_USE", "Vehicle AP39AB1234 already has another device") });
  const calls = await mountCreate();
  await fillCreateRequired();
  await choose(selectFor("dc-vehicleId"), "102");
  await click(dialogButton("Confirm Reassignment"));
  assert.equal(selectFor("dc-vehicleId").value, "102");
  await submitForm("device-create-form");
  assert.equal(calls.created.length, 0);
  assert.ok(!toasts.some((t) => t.kind === "success"));
  assert.match($("#dc-vehicleId-error").textContent, /already has another device/);
  assert.equal($("#dc-name").value, "Camera-New", "form not cleared");
});

test("Add device: vehicle list loading, failure with Retry, empty list, and no vehicle.read", async () => {
  let fail = true;
  backend();
  handlers["GET /vehicles"] = () => (fail ? failure(503, "SERVICE_UNAVAILABLE", "Vehicle service unavailable") : envelope([], 0));
  await mountCreate();
  assert.match($('[data-testid="vehicle-assign-error"]').textContent, /Vehicle service unavailable/);
  fail = false;
  await click($('[data-testid="vehicle-assign-error"] button'));
  assert.equal($('[data-testid="vehicle-assign-error"]'), null);
  assert.match($('[data-testid="vehicle-assign-notice"]').textContent, /No vehicles are registered/);
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  window.document.body.innerHTML = "";
  requests = [];
  backend();
  await mountCreate({ identity: { ...IDENTITIES.tenantAdmin, permissions: IDENTITIES.tenantAdmin.permissions.filter((c) => c !== "vehicle.read") } });
  assert.ok($('[data-testid="vehicle-assign-forbidden"]'));
  assert.equal(vehicleListCalls().length, 0, "no vehicle request without vehicle.read");
});

// ═══ 4. Edit device + reassignment (real component) ═════════════════════════

test("Edit device: the current vehicle is selected and labelled; an ordinary edit sends no mapping fields", async () => {
  backend();
  await mountEdit();
  assert.equal(selectFor("de-vehicleId").value, "101");
  assert.equal($('label[for="de-vehicleId"]').textContent.trim(), "Assigned Vehicle");
  assert.equal($('[data-testid="device-current-vehicle"]').textContent, "Currently assigned: AP31Z0044");
  assert.match(optionFor("de-vehicleId", "101").dataset.html, /data-state="current"/);
  await type($("#de-remark"), "Edited");
  await submitForm("device-edit-form");
  same(writes().map((r) => `${r.method} ${r.route}`), ["PUT /devices/7"]);
  same(writes()[0].body, { ...DEVICE_REQUEST, remark: "Edited" }, "vehicleId omitted = current vehicle kept (contract)");
});

test("Edit device: changing to an available vehicle is staged and saved in one full PUT", async () => {
  backend();
  const calls = await mountEdit();
  await choose(selectFor("de-vehicleId"), "103");
  assert.equal(alertDialog(), null);
  assert.equal(writes().length, 0, "nothing sent on pick");
  assert.match($('[data-testid="device-edit-changes"]').textContent, /1 change: Vehicle/);
  await submitForm("device-edit-form");
  same(writes().map((r) => `${r.method} ${r.route}`), ["PUT /devices/7"]);
  same(writes()[0].body, { ...DEVICE_REQUEST, vehicleId: 103, unlinkVehicle: false });
  assert.equal(calls.saved, 1, "onSaved → the detail page closes the panel and refetches the device");
  same(toasts.map((t) => [t.kind, t.title]), [["success", "Vehicle KA01FREE01 assigned"]]);
});

test("Reassign: an assigned vehicle opens 'Vehicle Already Assigned' with its device; Cancel sends nothing and keeps the selection", async () => {
  backend();
  await mountEdit();
  await choose(selectFor("de-vehicleId"), "102");
  const d = alertDialog();
  assert.ok(d);
  assert.match(d.textContent, /Vehicle Already Assigned/);
  assert.match(d.textContent, /Vehicle AP39AB1234 is currently assigned to another device\./);
  assert.equal($('[data-testid="reassign-device-name"]').textContent, "Camera-01");
  assert.equal($('[data-testid="reassign-terminal"]').textContent, "AZIdgjG2W6eyucB");
  assert.match(d.textContent, /Reassigning this vehicle will move it from its current device to the device you are editing\./);
  assert.ok(dialogButton("Cancel") && dialogButton("Confirm Reassignment"));
  await click(dialogButton("Cancel"));
  assert.equal(alertDialog(), null);
  assert.equal(writes().length, 0, "no API call");
  assert.equal(selectFor("de-vehicleId").value, "101", "previous selection kept");
});

test("Reassign: Confirm sends exactly ONE PUT to the edited device with the full DeviceRequest + {vehicleId, unlinkVehicle:false}; success refreshes", async () => {
  let release;
  backend({ put: () => new Promise((r) => (release = () => r(envelope({ ...DEVICE, vehicleId: 102 })))) });
  const calls = await mountEdit();
  await type($("#de-remark"), "Moved");
  await choose(selectFor("de-vehicleId"), "102");
  await click(dialogButton("Confirm Reassignment"));
  // A second confirm / submit while the PUT is in flight is ignored.
  await submitForm("device-edit-form");
  assert.equal(writes().length, 1);
  release();
  await settle();
  same(writes().map((r) => `${r.method} ${r.route}`), ["PUT /devices/7"], "no unlink of the other device, no transfer");
  const body = writes()[0].body;
  same(body, { ...DEVICE_REQUEST, remark: "Moved", vehicleId: 102, unlinkVehicle: false });
  for (const k of REQUIRED) assert.ok(k in body, k);
  assert.equal(calls.saved, 1);
  same(toasts.map((t) => [t.kind, t.title]), [["success", "Vehicle AP39AB1234 assigned"]]);
});

test("Reassign: a 409 shows the backend's error, restores the real mapping, keeps the other edits, reloads the device — no false success", async () => {
  backend({ put: () => failure(409, "RESOURCE_IN_USE", "Vehicle AP39AB1234 already has device Camera-01") });
  const calls = await mountEdit();
  await type($("#de-remark"), "Kept");
  await choose(selectFor("de-vehicleId"), "102");
  await click(dialogButton("Confirm Reassignment"));
  assert.equal(writes().length, 1);
  assert.equal(alertDialog(), null);
  assert.match($('[data-testid="device-edit-error"]').textContent, /Vehicle AP39AB1234 already has device Camera-01/);
  assert.equal(selectFor("de-vehicleId").value, "101", "current mapping intact");
  assert.equal($("#de-remark").value, "Kept", "form not cleared");
  assert.equal(calls.saved, 0);
  assert.equal(calls.reload, 1, "device re-read");
  assert.ok(!toasts.some((t) => t.kind === "success"));
  same(toasts.map((t) => [t.kind, t.title]), [["error", "The vehicle wasn't assigned"]]);
});

test("Edit device: a successful update refreshes vehicle data — the next open re-reads GET /vehicles", async () => {
  backend();
  await mountEdit();
  await choose(selectFor("de-vehicleId"), "103");
  await submitForm("device-edit-form");
  const before = vehicleListCalls().length;
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  window.document.body.innerHTML = "";
  await mountEdit({ device: { ...DEVICE, vehicleId: 103 } });
  assert.equal(vehicleListCalls().length, before + 1);
  const detail = read("components/drive-vision/vehicles/vehicle-detail.tsx");
  assert.match(detail, /onSaved=\{\(\) => \{\s*setEditing\(false\);\s*deviceQ\.refetch\(\);/, "device re-read on success");
  assert.match(read("components/drive-vision/vehicles/vehicles-page.tsx"), /onCreated=\{\(d\) => \{\s*setAdding\(false\);\s*active\.refetch\(\);/, "device list re-read after Add");
});

// ═══ 5. Unlink ══════════════════════════════════════════════════════════════

test("Unlink: confirmation first; Cancel sends nothing; Confirm sends the full DeviceRequest with {vehicleId:0, unlinkVehicle:true}", async () => {
  backend({ put: () => envelope({ ...DEVICE, vehicleId: null }) });
  const calls = await mountEdit();
  await click($('[data-testid="device-unlink-button"]'));
  assert.match(alertDialog().textContent, /Unlink vehicle\?/);
  assert.match(alertDialog().textContent, /AP31Z0044 will be removed from Camera-07/);
  await click(dialogButton("Cancel"));
  assert.equal(writes().length, 0, "no unlink on Cancel");
  await click($('[data-testid="device-unlink-button"]'));
  await click(dialogButton("Unlink vehicle"));
  same(writes().map((r) => `${r.method} ${r.route}`), ["PUT /devices/7"]);
  const body = writes()[0].body;
  same(body, { ...DEVICE_REQUEST, vehicleId: 0, unlinkVehicle: true });
  for (const k of REQUIRED) assert.ok(k in body, k);
  assert.equal(calls.saved, 1);
  same(toasts.map((t) => [t.kind, t.title]), [["success", "Vehicle unlinked"]]);
});

test("Unlink: after success the device shows unassigned, the field reads 'Assign Vehicle', and the freed vehicle is Available", async () => {
  const freed = VEHICLES.map((v) => (v.id === 101 ? { ...v, deviceAssigned: false, device: null } : v));
  backend({ vehicles: freed });
  await mountEdit({ device: { ...DEVICE, vehicleId: null } });
  assert.equal($('label[for="de-vehicleId"]').textContent.trim(), "Assign Vehicle");
  assert.equal($('[data-testid="device-current-vehicle"]').textContent, "No vehicle assigned.");
  assert.equal($('[data-testid="device-unlink-button"]'), null);
  assert.equal(selectFor("de-vehicleId").value, "");
  assert.match(optionFor("de-vehicleId", "101").dataset.html, /data-state="available"/);
});

test("Unlink: a refusal is shown as the server gave it and the vehicle stays linked in the UI", async () => {
  backend({ put: () => failure(400, "INVALID_VALUE", "vehicleId must be empty when unlinkVehicle is true") });
  const calls = await mountEdit();
  await click($('[data-testid="device-unlink-button"]'));
  await click(dialogButton("Unlink vehicle"));
  assert.match($('[data-testid="device-edit-error"]').textContent, /vehicleId must be empty when unlinkVehicle is true/);
  assert.equal(selectFor("de-vehicleId").value, "101");
  assert.equal(calls.saved, 0);
  assert.ok(!toasts.some((t) => t.kind === "success"));
});

// ═══ 6. Permissions ═════════════════════════════════════════════════════════

test("Permissions: the picker needs vehicle.read; create / update stay on device.create / device.update; SFA needs a tenant to write", () => {
  const p = ui.require("features/drive-vision/access/access-policy");
  same(p.WIDGETS["devices.vehicleChoices"].anyOf, ["vehicle.read"]);
  same(p.WIDGETS["sensors.deviceChoices"].anyOf, ["vehicle.read"]);
  same(p.ACTIONS["devices.create"].requires.anyOf, ["device.create"]);
  same(p.ACTIONS["devices.update"].requires.anyOf, ["device.update"]);
  assert.equal(p.canViewWidget(accessFor(IDENTITIES.tenantAdmin), "devices.vehicleChoices"), true);
  assert.equal(p.canViewWidget(accessFor({ ...IDENTITIES.tenantAdmin, permissions: ["device.read", "device.update"] }), "devices.vehicleChoices"), false);
  assert.equal(p.actionBlock(accessFor(IDENTITIES.platformAdmin), "devices.update"), "tenant");
  assert.equal(p.canPerform(accessFor(IDENTITIES.platformAdmin, 42), "devices.update"), true);
});

// ═══ 7. Sensors vehicle source ══════════════════════════════════════════════

test("Sensors model: GET /vehicles?assigned=true rows keep vehicleId, vehicleNumber and deviceId apart; rows without a device are dropped", () => {
  const rows = [
    { id: 502, vehicleNumber: "TS09AB1234", vehicleType: "Bus", deviceAssigned: true, device: { id: 102, name: "Bus 2", terminalNo: "T-0102" } },
    { id: 501, vehicleNumber: "AP31Z0044", vehicleType: "Bus", deviceAssigned: true, device: { id: 101, name: "Bus 1", terminalNo: "T-0101" } },
    { id: 503, vehicleNumber: "KA01AA0001", deviceAssigned: true, device: null },
    { id: 504, vehicleNumber: "KA01AA0002", deviceAssigned: false, device: { id: 104 } },
  ];
  const list = sm().sensorVehicles(rows);
  same(list, [
    { vehicleId: 501, vehicleNumber: "AP31Z0044", deviceId: 101, deviceName: "Bus 1", terminalNo: "T-0101", vehicleType: "Bus" },
    { vehicleId: 502, vehicleNumber: "TS09AB1234", deviceId: 102, deviceName: "Bus 2", terminalNo: "T-0102", vehicleType: "Bus" },
  ]);
  assert.equal(sm().pickSensorVehicle(list, null).vehicleId, 501, "first vehicle by default");
  assert.equal(sm().pickSensorVehicle(list, 502).deviceId, 102, "chosen by vehicle id → its device id");
  assert.equal(sm().pickSensorVehicle(list, 102), null, "a device id is never taken for a vehicle id");
  assert.equal(sm().pickSensorVehicle(list, null, { deviceId: 102 }).vehicleId, 502, "legacy ?device= deep link");
  assert.equal(sm().pickSensorVehicle(list, null, { vehicleId: 502 }).vehicleId, 502, "?vehicle= deep link");
  same(sm().pickSensorVehicle([], null), null);
});

test("Sensors page source: picker on GET /vehicles?assigned=true; device paths on deviceId (device.id); alerts on the vehicle number", () => {
  const page = read("components/drive-vision/sensors/sensors-page.tsx");
  assert.match(page, /vehicleRegistryService\.listAllVehicles\(\{ assigned: true \}\)/);
  assert.doesNotMatch(page, /fleetService\.listAllDevices/, "devices are no longer the picker's source");
  assert.match(page, /const deviceId = bus\?\.deviceId \?\? null;/);
  for (const call of ["sensorService.passengerSummary(deviceId!", "sensorService.comparison(deviceId!", "sensorService.stops(deviceId!", "sensorService.bms(deviceId!", "sensorService.readings(deviceId!", "sensorService.alcohol(deviceId!", "sensorService.recalculate(deviceId!"]) {
    assert.ok(page.includes(call), call);
  }
  assert.match(page, /const registration = cleanVehicleNumber\(bus\?\.vehicleNumber\);/);
  assert.match(page, /sensorAlertsService\.list\(\{ vehicleNumber: alertsVehicle, sensorSubId: alertFilters\.sensorSubId, fromTime: alertFilters\.fromTime, toTime: alertFilters\.toTime \}, alertsTenant\)/, "the vehicle number plus the server-side filters; the caller's tenant only gates the demo");
  assert.match(page, /const alertsTenant = access\.tenantId;/, "tenant from the access context, not the browser");
});
