import "dotenv/config";

import { loadRuntimeConfig } from "../config/runtime-config.js";

const config = loadRuntimeConfig();

console.log(
  JSON.stringify({
    status: "ready",
    version: "0.1.0",
    llmProvider: config.llmProvider,
    allowedDomains: config.allowedDomains
  })
);
