import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Repo root often holds shared secrets in `env` or `.env` (Python worker uses these).
 * Next.js only auto-loads files under actnote-web/, so merge parent env when a key is unset.
 * actnote-web/.env.local always wins if Next has already set the variable.
 */
function mergeRepoRootEnv() {
  const repoRoot = path.resolve(__dirname, "..");
  const files = [
    path.join(repoRoot, ".env.local"),
    path.join(repoRoot, ".env"),
    path.join(repoRoot, "env"),
  ];
  for (const filePath of files) {
    if (!fs.existsSync(filePath)) continue;
    let raw;
    try {
      raw = fs.readFileSync(filePath, "utf8");
    } catch {
      continue;
    }
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) {
        process.env[key] = val;
      }
    }
  }
}

mergeRepoRootEnv();

/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
      },
    ],
  },
};

export default nextConfig;
