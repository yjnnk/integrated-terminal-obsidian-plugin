import fs from "fs";

const manifestPath = new URL("./manifest.json", import.meta.url);
const pkgPath = new URL("./package.json", import.meta.url);

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));

if (manifest.version !== pkg.version) {
  throw new Error("manifest.json and package.json versions do not match");
}

const [major, minor, patch] = manifest.version.split(".").map(Number);
const nextVersion = [major, minor, patch + 1].join(".");

manifest.version = nextVersion;
pkg.version = nextVersion;

fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
