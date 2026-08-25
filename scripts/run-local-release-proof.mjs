import { spawn } from "node:child_process";

if (process.env.NODE_ENV === "production") {
  throw new Error("Local release proof is disabled in production.");
}

const npmCli = process.env.npm_execpath;
if (!npmCli) {
  throw new Error("npm_execpath is required; invoke this proof through npm run proof:release-local.");
}

const steps = [
  { name: "verify", args: ["run", "verify"] },
  { name: "production dependency audit", args: ["audit", "--omit=dev", "--audit-level=high"] },
  { name: "migration parity", args: ["run", "db:verify:migrations:local"] },
  { name: "audit/history proof", args: ["run", "db:proof:audit-history"] },
  { name: "dashboard proof", args: ["run", "db:proof:dashboard"] },
  { name: "configuration surfaces proof", args: ["run", "db:proof:configuration-surfaces"] },
  { name: "KPI configuration audit proof", args: ["run", "db:proof:kpi-config-audit"] },
  { name: "administration/scope proof", args: ["run", "db:proof:administration"] },
  { name: "user onboarding proof", args: ["run", "db:proof:user-onboarding"] },
  { name: "observability proof", args: ["run", "proof:observability"] },
  { name: "browser E2E proof", args: ["run", "proof:browser-e2e"] },
  { name: "backup/restore proof", args: ["run", "proof:restore"] },
];

function runStep(step) {
  return new Promise((resolve, reject) => {
    process.stdout.write(`\n=== ${step.name} ===\n`);
    const child = spawn(process.execPath, [npmCli, ...step.args], {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
      windowsHide: true,
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${step.name} failed${signal ? ` with signal ${signal}` : ` with exit code ${code}`}.`));
    });
  });
}

const completed = [];
for (const step of steps) {
  await runStep(step);
  completed.push(step.name);
}

console.log(JSON.stringify({
  status: "ok",
  proof: "local-release",
  completedSteps: completed,
  excludedExternalGates: [
    "real Atlassian credentialed sync",
    "remote GitHub Actions",
    "container image/runtime",
    "target production infrastructure/deploy/telemetry",
  ],
}, null, 2));
