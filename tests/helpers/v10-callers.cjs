// Which UI files call each BFF service method (static, by reference `fooService.method`), and which
// screen those files belong to. Wrapper methods inside the API layer (e.g. listAllDevices → listDevices)
// are followed so a method counts as used only when something outside the API layer reaches it.
const fs = require("fs");
const path = require("path");
const { ROOT } = require("./v10-contract.cjs");

const SRC = path.join(ROOT, "src");
const API_DIR = "src/features/drive-vision/api/";

function walk(dir, out = []) {
  for (const f of fs.readdirSync(dir)) {
    const fp = path.join(dir, f);
    if (fs.statSync(fp).isDirectory()) walk(fp, out);
    else if (/\.(ts|tsx)$/.test(f)) out.push(fp);
  }
  return out;
}

/** Screen label for a caller file. */
function screenOf(rel) {
  const R = [
    [/components\/drive-vision\/auth\/login-screen/, "Login"],
    [/components\/drive-vision\/auth\//, "Shell (session)"],
    [/features\/drive-vision\/store\/auth-store/, "Shell (session)"],
    [/components\/drive-vision\/app-shell\/global-search/, "Shell — global search"],
    [/components\/drive-vision\/app-shell\/notification-center/, "Shell — notifications"],
    [/components\/drive-vision\/app-shell\/user-profile-menu/, "Shell — profile menu"],
    [/components\/drive-vision\/app-shell\//, "Shell"],
    [/components\/drive-vision\/assistant\//, "AI Assistant"],
    [/components\/drive-vision\/dashboard\//, "Overview"],
    [/components\/drive-vision\/monitoring\//, "Live Monitoring"],
    [/components\/drive-vision\/video\//, "Historical Video"],
    [/components\/drive-vision\/trips\//, "Trips & Tracking"],
    [/components\/drive-vision\/reports\//, "Reports"],
    [/components\/drive-vision\/vehicles\//, "Vehicles & Assets"],
    [/components\/drive-vision\/drivers\//, "Drivers"],
    [/components\/drive-vision\/operations\/dispatch/, "Dispatch"],
    [/components\/drive-vision\/operations\/workforce/, "Workforce"],
    [/components\/drive-vision\/operations\/my-work/, "My Work (driver)"],
    [/components\/drive-vision\/operations\/use-pickers/, "Dispatch / Workforce pickers"],
    [/components\/drive-vision\/alerts\//, "Alerts & Events"],
    [/components\/drive-vision\/safety\//, "Safety Analytics"],
    [/components\/drive-vision\/geofences\//, "Geofences"],
    [/components\/drive-vision\/devices\//, "Device Commands"],
    [/components\/drive-vision\/users\//, "Users & Sub-Accounts"],
    [/components\/drive-vision\/settings\//, "Settings"],
    [/features\/drive-vision\/hooks\/use-preferences/, "Settings / shell preferences"],
  ];
  for (const [re, label] of R) if (re.test(rel)) return label;
  return rel;
}

/** { "fleetService.listDevices": [{ file, screen }] } for the given service methods. */
function findCallers(methods) {
  const files = walk(SRC).map((f) => ({ rel: path.relative(ROOT, f).replace(/\\/g, "/"), text: fs.readFileSync(f, "utf8") }));
  const direct = {};
  // method → API-layer wrapper methods that reference it
  const wrappers = {};
  for (const m of methods) {
    const [svc, fn] = m.split(".");
    const re = new RegExp(`\\b${svc}\\.${fn}\\b`);
    direct[m] = [];
    wrappers[m] = [];
    for (const f of files) {
      if (!re.test(f.text)) continue;
      if (f.rel.startsWith(API_DIR)) {
        // find the enclosing member name of each reference inside the API layer
        const lines = f.text.split("\n");
        lines.forEach((line, i) => {
          if (!re.test(line)) return;
          for (let j = i; j >= 0; j--) {
            const mm = lines[j].match(/^\s{2}(?:async\s+)?([a-zA-Z]+)\s*(?:\(|:\s*\()/);
            if (mm) {
              if (mm[1] !== fn) wrappers[m].push(`${svc}.${mm[1]}`);
              break;
            }
          }
        });
      } else direct[m].push(f.rel);
    }
  }
  const resolve = (m, seen = new Set()) => {
    if (seen.has(m)) return [];
    seen.add(m);
    let out = [...(direct[m] || [])];
    for (const w of wrappers[m] || []) {
      if (!direct[w]) {
        const [svc, fn] = w.split(".");
        const re = new RegExp(`\\b${svc}\\.${fn}\\b`);
        direct[w] = files.filter((f) => !f.rel.startsWith(API_DIR) && re.test(f.text)).map((f) => f.rel);
      }
      out = out.concat(resolve(w, seen));
    }
    return [...new Set(out)];
  };
  const result = {};
  for (const m of methods) result[m] = resolve(m).map((file) => ({ file, screen: screenOf(file) }));
  return result;
}

module.exports = { findCallers, screenOf };
