import { existsSync, mkdirSync, rmSync } from "node:fs";
import { randomBytes, scrypt as nodeScrypt } from "node:crypto";
import postgres from "postgres";
import { chromium } from "playwright-core";

if (process.env.NODE_ENV === "production") throw new Error("UI/UX audit is disabled in production.");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");

const baseUrl = process.env.E2E_BASE_URL || "http://localhost:3712";
const auditEmail = "ui-ux-audit@kpi.local";
const password = `Audit-${randomBytes(24).toString("base64url")}-Aa1!`;
const evidenceDir = ".ui-ux-audit";

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
  if (!executable) throw new Error("A local Chrome/Chromium executable is required.");
  return executable;
}

async function pageAudit(page, label) {
  const data = await page.evaluate(() => {
    const visible = (el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };
    const controls = [...document.querySelectorAll("input,select,textarea")].filter(visible);
    const unlabeledControls = controls.filter((el) => {
      if (el.getAttribute("aria-label") || el.getAttribute("aria-labelledby")) return false;
      if (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) return false;
      if (el.closest("label")) return false;
      return true;
    }).map((el) => ({ tag: el.tagName, type: el.getAttribute("type"), placeholder: el.getAttribute("placeholder") }));
    const unnamedButtons = [...document.querySelectorAll("button")].filter(visible).filter((el) => {
      const name = [el.getAttribute("aria-label"), el.getAttribute("title"), el.textContent].filter(Boolean).join(" ").trim();
      return !name;
    }).length;
    const hasScrollableAncestor = (el) => {
      let current = el.parentElement;
      while (current && current !== document.body) {
        const style = getComputedStyle(current);
        if (["auto", "scroll"].includes(style.overflowX) && current.scrollWidth > current.clientWidth) return true;
        current = current.parentElement;
      }
      return false;
    };
    const offscreenInteractive = [...document.querySelectorAll("button,a,input,select,textarea")].filter(visible).filter((el) => {
      const rect = el.getBoundingClientRect();
      return (rect.left < 0 || rect.right > innerWidth) && !hasScrollableAncestor(el);
    }).map((el) => ({ tag: el.tagName, name: (el.getAttribute("aria-label") || el.getAttribute("title") || el.textContent || "").trim().slice(0, 80) }));
    const overflow = Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth);
    return { overflow, unlabeledControls, unnamedButtons, offscreenInteractive, viewport: [innerWidth, innerHeight], scrollWidth: document.documentElement.scrollWidth };
  });
  return { label, ...data };
}

async function login(page) {
  await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 30_000 });
  await page.locator('input[type="email"]').fill(auditEmail);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByText("Executive Dashboard", { exact: false }).first().waitFor({ state: "visible", timeout: 15_000 });
}

const sql = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 5, prepare: false });
let browser;
let auditUserId = null;
const findings = [];
try {
  rmSync(evidenceDir, { recursive: true, force: true });
  mkdirSync(evidenceDir, { recursive: true });

  const workspaceRows = await sql`
    SELECT o.id AS organization_id
    FROM organizations o
    JOIN departments d ON d.organization_id = o.id AND d.active = true
    ORDER BY CASE WHEN o.slug = 'kpi-local' THEN 0 ELSE 1 END, o.created_at
    LIMIT 1
  `;
  if (!workspaceRows.length) throw new Error("No local organization available.");
  const organizationId = workspaceRows[0].organization_id;
  const passwordHash = await hashPassword(password);
  const users = await sql`
    INSERT INTO users (email, display_name, password_hash, role, active, password_change_required, password_changed_at)
    VALUES (${auditEmail}, 'UI UX Audit Administrator', ${passwordHash}, 'ADMINISTRATOR', true, false, now())
    ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = 'ADMINISTRATOR', active = true, password_change_required = false, password_changed_at = now(), updated_at = now()
    RETURNING id
  `;
  auditUserId = users[0].id;
  await sql`
    INSERT INTO user_organization_access (user_id, organization_id, role, active)
    VALUES (${auditUserId}, ${organizationId}, 'ADMINISTRATOR', true)
    ON CONFLICT (user_id, organization_id) DO UPDATE SET role='ADMINISTRATOR', active=true, updated_at=now()
  `;
  await sql`DELETE FROM sessions WHERE user_id = ${auditUserId}`;

  browser = await chromium.launch({ executablePath: chromeExecutable(), headless: true });

  const desktop = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await desktop.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await login(page);
  await page.screenshot({ path: `${evidenceDir}/dashboard-desktop.png`, fullPage: true });

  const surfaces = [
    ["Teams", "Teams"], ["Members", "Members"], ["KPI Templates", "KPI templates"], ["KPI Builder", "KPI Builder"],
    ["Metric Library", "Metric Library"], ["Scoring Rules", "Scoring Rules"], ["Evaluation Periods", "Evaluation periods"],
    ["System Evaluation", "System evaluation pipeline"], ["Leader Review", "Leader Review"], ["Calibration", "Department Head Calibration"],
    ["Data Quality", "Data Quality"], ["Jira Integration", "Jira Control Center"], ["Historical Analytics", "Historical analytics"],
    ["Rank Schemes", "Rank Schemes"], ["Audit Log", "Audit log"], ["Settings", "Organization administration"],
  ];
  const desktopAudits = [];
  for (const [nav, expected] of surfaces) {
    await page.getByTitle(nav).click();
    await page.getByText(expected, { exact: false }).first().waitFor({ state: "visible", timeout: 15_000 });
    desktopAudits.push(await pageAudit(page, nav));
  }

  await page.getByTitle("Teams").click();
  await page.getByText("Teams", { exact: true }).first().waitFor({ state: "visible" });
  const teamBefore = await page.locator("main").innerText();
  const teamOpen = page.getByRole("button", { name: /^Open$/ }).first();
  if (await teamOpen.count()) {
    await teamOpen.click();
    await page.waitForTimeout(250);
    const teamAfter = await page.locator("main").innerText();
    if (teamBefore === teamAfter) findings.push({ id: "UX-FUNC-001", severity: "P1", title: "Teams Open button has no observable effect" });
  }

  await page.getByTitle("Members").click();
  const memberBefore = await page.locator("main").innerText();
  const memberOpen = page.getByRole("button", { name: /^Open$/ }).first();
  if (await memberOpen.count()) {
    await memberOpen.click();
    await page.waitForTimeout(250);
    const memberAfter = await page.locator("main").innerText();
    if (memberBefore === memberAfter) findings.push({ id: "UX-FUNC-002", severity: "P1", title: "Members Open button has no observable effect" });
  }

  const periodChipText = await page.locator("header").getByText(/^2026-09$/).count();
  if (periodChipText) findings.push({ id: "UX-DATA-001", severity: "P1", title: "Header evaluation-period chip is hard-coded to 2026-09" });

  const search = page.locator('header input[placeholder="Search member, KPI, issue..."]');
  if (await search.count()) {
    await search.fill("zzzz-audit-no-match");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(250);
    const stillDashboard = await page.getByText("Executive Dashboard", { exact: false }).count();
    if (stillDashboard) findings.push({ id: "UX-FUNC-003", severity: "P2", title: "Global search accepts input but has no observable behavior" });
  }

  const teamsAudit = desktopAudits.find((item) => item.label === "Teams");
  if (desktopAudits.some((item) => item.unlabeledControls.length > 0)) findings.push({ id: "UX-A11Y-001", severity: "P2", title: "Visible form controls are not programmatically associated with labels" });
  if (desktopAudits.some((item) => item.unnamedButtons > 0)) findings.push({ id: "UX-A11Y-002", severity: "P2", title: "Visible icon-only buttons lack accessible names" });
  if (teamsAudit?.overflow > 0) findings.push({ id: "UX-LAYOUT-001D", severity: "P2", title: "Desktop Teams surface has horizontal page overflow" });

  await desktop.close();

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mobilePage = await mobile.newPage();
  await login(mobilePage);
  const mobileDashboard = await pageAudit(mobilePage, "Mobile Dashboard");
  await mobilePage.screenshot({ path: `${evidenceDir}/dashboard-mobile.png`, fullPage: true });
  if (mobileDashboard.overflow > 0) findings.push({ id: "UX-RESP-001", severity: "P1", title: `Mobile shell overflows horizontally by ${mobileDashboard.overflow}px` });
  const aside = await mobilePage.locator("aside").evaluate((el) => { const rect = el.getBoundingClientRect(); return { width: Math.round(rect.width), left: Math.round(rect.left), right: Math.round(rect.right) }; });
  if (aside.right > 0 && aside.left < mobileDashboard.viewport[0]) findings.push({ id: "UX-RESP-002", severity: "P1", title: `Mobile sidebar remains on-screen at rest (${aside.width}px wide)` });
  const mobileAudits = [];
  for (const [nav, expected] of surfaces) {
    await mobilePage.getByRole("button", { name: "Open navigation" }).click();
    await mobilePage.getByTitle(nav).click();
    await mobilePage.getByText(expected, { exact: false }).first().waitFor({ state: "visible", timeout: 15_000 });
    const audit = await pageAudit(mobilePage, `Mobile ${nav}`);
    mobileAudits.push(audit);
    if (audit.overflow > 0) findings.push({ id: `UX-RESP-${nav.replaceAll(" ", "-").toUpperCase()}`, severity: "P1", title: `${nav} overflows the mobile page by ${audit.overflow}px` });
    if (audit.offscreenInteractive.length > 0) findings.push({ id: `UX-CLIP-${nav.replaceAll(" ", "-").toUpperCase()}`, severity: "P1", title: `${nav} has interactive controls clipped outside the mobile viewport`, details: audit.offscreenInteractive });
  }
  const mobileTeams = mobileAudits.find((item) => item.label === "Mobile Teams");
  await mobilePage.getByRole("button", { name: "Open navigation" }).click();
  await mobilePage.getByTitle("Teams").click();
  await mobilePage.screenshot({ path: `${evidenceDir}/teams-mobile.png`, fullPage: true });
  if (mobileAudits.some((item) => item.unlabeledControls.length > 0)) findings.push({ id: "UX-A11Y-003", severity: "P2", title: "Mobile-visible form controls are not programmatically associated with labels" });
  if (mobileAudits.some((item) => item.unnamedButtons > 0)) findings.push({ id: "UX-A11Y-004", severity: "P2", title: "Mobile-visible buttons lack accessible names" });
  await mobile.close();

  console.log(JSON.stringify({
    status: findings.length ? "findings-remain" : "pass",
    pageErrors,
    desktopAudits,
    mobileDashboard,
    mobileTeams,
    mobileAudits,
    findings,
    evidence: ["dashboard-desktop.png", "dashboard-mobile.png", "teams-mobile.png"],
  }, null, 2));
  if (findings.length) process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (auditUserId) {
    try {
      await sql`UPDATE sessions SET revoked_at = COALESCE(revoked_at, now()) WHERE user_id = ${auditUserId}`;
      await sql`UPDATE user_organization_access SET active=false, updated_at=now() WHERE user_id = ${auditUserId}`;
      await sql`UPDATE users SET active=false, updated_at=now() WHERE id = ${auditUserId}`;
    } catch {}
  }
  await sql.end({ timeout: 2 });
}
