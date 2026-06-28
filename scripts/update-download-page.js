#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const buildId = process.argv[2];
if (!buildId) {
  console.error("사용법: node scripts/update-download-page.js <build-id>");
  console.error("예시: node scripts/update-download-page.js 8336a15a-53a0-49c7-982d-cd95f2935fe3");
  process.exit(1);
}

const filePath = path.join(__dirname, "..", "download.html");
let html = fs.readFileSync(filePath, "utf8");

const downloadUrl = `https://expo.dev/accounts/aurae5347/projects/aurae-app/builds/${buildId}`;
const buildLabel = buildId.slice(0, 8);

html = html.replace(
  /const DOWNLOAD_URL = ".*?";/,
  `const DOWNLOAD_URL = "${downloadUrl}";`
);
html = html.replace(
  /const BUILD_LABEL = ".*?";/,
  `const BUILD_LABEL = "${buildLabel}";`
);

fs.writeFileSync(filePath, html, "utf8");
console.log("✅ download.html 업데이트 완료");
console.log("   DOWNLOAD_URL:", downloadUrl);
console.log("   BUILD_LABEL:", buildLabel);
