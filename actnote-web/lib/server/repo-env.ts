import fs from "node:fs";
import path from "node:path";

let merged = false;

function envValueMissing(key: string): boolean {
  const v = process.env[key];
  return v === undefined || String(v).trim() === "";
}

/**
 * ACTNOTE 레포 루트의 env 파일을 process.env 에 합친다.
 *
 * Next.js Route Handler 에서 process.cwd() 가 예상과 다르거나, 첫 탐색이 실패해도
 * 이후 요청에서 다시 시도하지 않는 버그를 피하기 위해 `merged` 는
 * **후보 루트 전부 스캔을 마친 뒤에만** true 로 둔다.
 *
 * 비어 있는 값(`KEY=` 또는 공백만 있는 값)도 “미설정”으로 보고 레포 루트 env 로 채운다.
 * Next 가 먼저 읽은 actnote-web/.env.local 에 빈 줄이 있으면 기존에는 레포 값으로 덮어쓰지 못했다.
 *
 * 이미 **내용이 있는** 키는 덮어쓰지 않음 (actnote-web/.env.local 이 우선).
 */
export function ensureRepoRootEnvMerged(): void {
  if (merged) return;

  // cwd 가 actnote-web 일 때 가장 흔한 경우: 바로 부모 폴더가 레포 루트
  mergeEnvFilesFromRoot(path.resolve(process.cwd(), ".."));

  const candidates = collectRepoRootCandidates();

  for (const root of candidates) {
    mergeEnvFilesFromRoot(root);
  }

  merged = true;

  if (
    process.env.NODE_ENV === "development" &&
    envValueMissing("INNGEST_EVENT_KEY")
  ) {
    console.warn(
      "[repo-env] INNGEST_EVENT_KEY still unset after merge. cwd=%s candidates=%s",
      process.cwd(),
      JSON.stringify(candidates)
    );
  }
}

function collectRepoRootCandidates(): string[] {
  const seen = new Set<string>();
  const add = (p: string) => {
    try {
      seen.add(path.resolve(p));
    } catch {
      /* ignore */
    }
  };

  let dir = path.resolve(process.cwd());
  for (let i = 0; i < 14; i++) {
    const webDir = path.join(dir, "actnote-web");
    if (fs.existsSync(webDir) && fs.statSync(webDir).isDirectory()) {
      const py = path.join(dir, "pyproject.toml");
      const webPkg = path.join(webDir, "package.json");
      const strict =
        fs.existsSync(py) && fs.existsSync(webPkg);

      const hasRootEnvFile =
        fs.existsSync(path.join(dir, "env")) ||
        fs.existsSync(path.join(dir, ".env")) ||
        fs.existsSync(path.join(dir, ".env.local"));

      if (strict || hasRootEnvFile) {
        add(dir);
      }
    }

    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // 자주 쓰는 레이아웃: dev 서버 cwd 가 actnote-web 인 경우 한 단계 위가 레포 루트
  add(path.join(process.cwd(), ".."));

  return [...seen];
}

function mergeEnvFilesFromRoot(root: string): void {
  const files = [
    path.join(root, ".env.local"),
    path.join(root, ".env"),
    path.join(root, "env"),
  ];

  for (const filePath of files) {
    if (!fs.existsSync(filePath)) continue;
    let raw: string;
    try {
      raw = fs.readFileSync(filePath, "utf8");
    } catch {
      continue;
    }
    if (raw.charCodeAt(0) === 0xfeff) {
      raw = raw.slice(1);
    }
    for (const line of raw.split(/\r?\n/)) {
      const parsed = parseDotenvLine(line);
      if (!parsed) continue;
      if (envValueMissing(parsed.key)) {
        process.env[parsed.key] = parsed.val;
      }
    }
  }
}

function parseDotenvLine(line: string): { key: string; val: string } | null {
  let trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;

  if (trimmed.startsWith("export ")) {
    trimmed = trimmed.slice(7).trim();
  }

  const eq = trimmed.indexOf("=");
  if (eq <= 0) return null;

  const key = trimmed.slice(0, eq).trim();
  if (!key || key.includes(" ")) return null;

  let val = trimmed.slice(eq + 1).trim();

  if (
    (val.startsWith('"') && val.endsWith('"')) ||
    (val.startsWith("'") && val.endsWith("'"))
  ) {
    val = val.slice(1, -1);
  } else {
    val = val.replace(/\s+#.*$/, "").trim();
  }

  return { key, val };
}
