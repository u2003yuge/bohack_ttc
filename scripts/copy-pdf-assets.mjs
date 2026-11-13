import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pdfPackage = path.join(root, "node_modules", "pdfjs-dist");
const publicAssets = path.join(root, "public", "pdfjs");

await mkdir(publicAssets, { recursive: true });
await Promise.all([
  cp(path.join(pdfPackage, "cmaps"), path.join(publicAssets, "cmaps"), { recursive: true }),
  cp(path.join(pdfPackage, "standard_fonts"), path.join(publicAssets, "standard_fonts"), { recursive: true }),
]);

console.log("Prepared PDF.js CMaps and standard fonts.");
