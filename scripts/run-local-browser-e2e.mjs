import { existsSync } from "node:fs";
import { randomBytes, scrypt as nodeScrypt } from "node:crypto";
import postgres from "postgres";
import { chromium } from "playwright-core";

if (process.env.NODE_ENV === "production") throw new Error("Local browser E2E is disabled in production.");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");

const baseUrl = process.env.E2E_BASE_URL || "http://localhost:3712";
const e2eEmail = "e2e-ui@kpi.local";
const password = `E2E-${randomBytes(24).toString("base64url")}-Aa1!`;
const teamName = `E2E Persistence ${Date.now()}`;

function derive(passwordValue, salt) {
  return new Promise((resolve, reject) => {
    nodeScrypt(passwordValue, salt, 64, { N: 131_072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error); else resolve(Buffer.from(key));
    });
  });
}

async function hashPassword(value) {
  const salt = randomBytes(16);
  const key = await derive(value, salt);
  return ["scrypt", 131_072, 8, 1, salt.toString("base64url"), key.toString("base64url")].join("$");
}

function chromeExecutable() {
  const candidates = process.platform === "win32"
    ? [
        `${process.env.PROGRAMFILES || "C:\\Program Files"}\\Google\\Chrome\\Application\\chrome.exe`,
        `${process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)"}\\Google\\Chrome\\Application\\chrome.exe`,
      ]
    : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
  const executable = candidates.find((candidate) => candidate && existsSync(candidate));
  if (!executable) throw new Error("A local Chrome/Chromium executable is required for browser E2E.");
  return executable;
}

const forbiddenUiCopy = ["Â·", "â†’", "â€¦", "Ã", "�", "ðŸ", "â€", "Integration · T08", "Until T08", "T08-B snapshots", "migration 0012"];

async function assertCleanUiCopy(page, contextLabel) {
  const text = await page.locator("body").innerText();
  const matches = forbiddenUiCopy.filter((marker) => text.includes(marker));
  if (matches.length) throw new Error(`UI copy regression on ${contextLabel}: ${matches.join(", ")}`);
}

async function waitForHealthyPage(page, expectedText) {
  await page.getByText(expectedText, { exact: false }).first().waitFor({ state: "visible", timeout: 15_000 });
  const failure = page.getByText("Unable to load data", { exact: false });
  if (await failure.count()) throw new Error(`UI reported a data-load failure while opening ${expectedText}.`);
  await assertCleanUiCopy(page, expectedText);
}

const sql = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 5, prepare: false });
let browser;
let createdTeamId = null;
let e2eUserId = null;
try {
  const health = await fetch(`${baseUrl}/api/health`);
  if (!health.ok) throw new Error(`Application is not healthy at ${baseUrl}; HTTP ${health.status}.`);

  const workspaceRows = await sql`
    SELECT o.id AS organization_id, d.id AS department_id
    FROM organizations o
    JOIN departments d ON d.organization_id = o.id AND d.active = true
    ORDER BY CASE WHEN o.slug = 'kpi-local' THEN 0 ELSE 1 END, o.created_at, d.created_at
    LIMIT 1
  `;
  if (!workspaceRows.length) throw new Error("No local organization/department is available for E2E.");
  const { organization_id: organizationId } = workspaceRows[0];
  const passwordHash = await hashPassword(password);

  const users = await sql`
    INSERT INTO users (email, display_name, password_hash, role, active, password_change_required, password_changed_at)
    VALUES (${e2eEmail}, 'Local Browser E2E Administrator', ${passwordHash}, 'ADMINISTRATOR', true, false, now())
    ON CONFLICT (email) DO UPDATE SET
      display_name = EXCLUDED.display_name,
      password_hash = EXCLUDED.password_hash,
      role = 'ADMINISTRATOR',
      active = true,
      password_change_required = false,
      password_changed_at = now(),
      updated_at = now()
    RETURNING id
  `;
  const userId = users[0].id;
  e2eUserId = userId;
  await sql`
    INSERT INTO user_organization_access (user_id, organization_id, role, active)
    VALUES (${userId}, ${organizationId}, 'ADMINISTRATOR', true)
    ON CONFLICT (user_id, organization_id)
    DO UPDATE SET role = 'ADMINISTRATOR', active = true, updated_at = now()
  `;
  await sql`DELETE FROM sessions WHERE user_id = ${userId}`;

  browser = await chromium.launch({ executablePath: chromeExecutable(), headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 30_000 });
  await page.locator('input[type="email"]').fill(e2eEmail);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await waitForHealthyPage(page, "Executive Dashboard");

  await page.getByTitle("Teams").click();
  await waitForHealthyPage(page, "Teams");
  await page.getByRole("button", { name: /Create team/i }).first().click();
  await page.getByPlaceholder("e.g. Video Platform").fill(teamName);
  const departmentSelect = page.locator("select").filter({ has: page.locator('option[value=""]', { hasText: "Select department" }) }).first();
  await departmentSelect.selectOption({ index: 1 });
  await page.locator('input[type="date"]').last().fill(new Date().toISOString().slice(0, 10));
  await page.getByRole("button", { name: /^Create team$/i }).last().click();
  await page.getByText(teamName, { exact: true }).waitFor({ state: "visible", timeout: 15_000 });

  const teamRows = await sql`
    SELECT t.id
    FROM teams t
    JOIN departments d ON d.id = t.department_id
    WHERE d.organization_id = ${organizationId} AND t.name = ${teamName}
  `;
  if (teamRows.length !== 1) throw new Error("Browser-created team was not persisted exactly once.");
  createdTeamId = teamRows[0].id;

  await page.reload({ waitUntil: "networkidle", timeout: 30_000 });
  await waitForHealthyPage(page, "Executive Dashboard");
  await page.getByTitle("Teams").click();
  await page.getByText(teamName, { exact: true }).waitFor({ state: "visible", timeout: 15_000 });

  const navigationChecks = [
    ["Members", "Members"],
    ["KPI Templates", "KPI templates"],
    ["KPI Builder", "KPI Builder"],
    ["Metric Library", "Metric Library"],
    ["Scoring Rules", "Scoring Rules"],
    ["Evaluation Periods", "Evaluation periods"],
    ["System Evaluation", "System evaluation pipeline"],
    ["Leader Review", "Leader Review"],
    ["Calibration", "Department Head Calibration"],
    ["Data Quality", "Data Quality"],
    ["Jira Integration", "Jira Control Center"],
    ["Historical Analytics", "Historical analytics"],
    ["Rank Schemes", "Rank Schemes"],
    ["Audit Log", "Audit log"],
    ["Settings", "Organization administration"],
  ];
  const checked = [];
  for (const [navTitle, expectedText] of navigationChecks) {
    await page.getByTitle(navTitle).click();
    await waitForHealthyPage(page, expectedText);
    checked.push(navTitle);
  }

  if (pageErrors.length) throw new Error(`Browser page errors: ${pageErrors.join(" | ")}`);

  console.log(JSON.stringify({
    status: "ok",
    baseUrl,
    browser: "system-chrome",
    login: true,
    createdTeamPersistedAcrossReload: true,
    navigationChecks: checked,
    pageErrors: 0,
  }, null, 2));
} finally {
  if (browser) await browser.close();
  if (createdTeamId) {
    try { await sql`DELETE FROM teams WHERE id = ${createdTeamId}`; } catch (error) { console.error(`E2E cleanup warning: ${error instanceof Error ? error.message : String(error)}`); }
  }
  if (e2eUserId) {
    try {
      await sql`UPDATE sessions SET revoked_at = COALESCE(revoked_at, now()) WHERE user_id = ${e2eUserId}`;
      await sql`UPDATE user_organization_access SET active = false, updated_at = now() WHERE user_id = ${e2eUserId}`;
      await sql`UPDATE users SET active = false, updated_at = now() WHERE id = ${e2eUserId}`;
    } catch (error) {
      console.error(`E2E identity cleanup warning: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  await sql.end({ timeout: 2 });
}
