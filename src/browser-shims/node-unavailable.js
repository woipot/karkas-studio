// Browser stand-in for Node built-ins that house-engine.js imports only for its
// on-disk project store and PDF export (createHouseEngine). The web UI never calls
// those paths; an accidental call fails loudly instead of breaking the bundle.
const unavailable = (name) => () => {
  throw Error(`${name} недоступен в браузере: хранение ревизий и PDF выполняет MCP-сервер.`);
};
export const execFile = unavailable("child_process.execFile");
export const promisify = (fn) => fn;
export const mkdir = unavailable("fs.mkdir");
export const readFile = unavailable("fs.readFile");
export const writeFile = unavailable("fs.writeFile");
export const link = unavailable("fs.link");
export const readdir = unavailable("fs.readdir");
export const open = unavailable("fs.open");
export const unlink = unavailable("fs.unlink");
export const access = unavailable("fs.access");
export const fileURLToPath = (u) => String(u);
export const pathToFileURL = (p) => new URL(p, "file:///");
const join = (...parts) => parts.join("/").replace(/\/+/g, "/");
const path = { join, resolve: join, dirname: (p) => String(p).replace(/\/[^/]*$/, "") };
export { join, path };
export const resolve = join;
export const dirname = path.dirname;
export default path;
