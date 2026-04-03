#!/usr/bin/env node

/**
 * Post-build script: adds .js extensions to relative imports in ESM output.
 * Fixes "Cannot find module" errors when using "type": "module" in package.json.
 */

const fs = require("fs");
const path = require("path");

const DIST_DIR = path.join(__dirname, "dist");

function fixFile(filePath) {
  let content = fs.readFileSync(filePath, "utf8");
  const original = content;

  // Match: from "./foo" or from '../bar' (but not from "@scope/pkg" or from "pkg")
  // Replace with: from "./foo.js" or from '../bar.js'
  content = content.replace(
    /from\s+["'](\.[^"']+)["']/g,
    (match, importPath) => {
      // Skip if already has .js extension
      if (importPath.endsWith(".js")) return match;
      // Skip if it's a directory import (ends with /)
      if (importPath.endsWith("/")) return match;
      // Add .js extension
      return `from "${importPath}.js"`;
    }
  );

  if (content !== original) {
    fs.writeFileSync(filePath, content, "utf8");
    console.log(`  Fixed: ${path.relative(DIST_DIR, filePath)}`);
  }
}

function walkDir(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      walkDir(filePath);
    } else if (file.endsWith(".js")) {
      fixFile(filePath);
    }
  }
}

console.log("Fixing ESM imports in dist/...");
walkDir(DIST_DIR);
console.log("Done!");
