import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendDir = path.resolve(__dirname, "..");
const distDir = path.join(frontendDir, "dist");
const apiBaseUrl = (process.env.FRONTEND_API_BASE_URL || "").trim().replace(/\/+$/, "");

fs.rmSync(distDir, { recursive: true, force: true });
fs.mkdirSync(distDir, { recursive: true });

for (const assetName of ["index.html", "styles.css"]) {
  fs.copyFileSync(path.join(frontendDir, assetName), path.join(distDir, assetName));
}

const appJs = fs.readFileSync(path.join(frontendDir, "app.js"), "utf8");
const builtAppJs = appJs.replace(/__API_BASE_URL__/g, apiBaseUrl);
fs.writeFileSync(path.join(distDir, "app.js"), builtAppJs);
