import { randomBytes, scrypt as nodeScrypt } from "node:crypto";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
const password = process.env.DEV_ADMIN_PASSWORD;
const email = (process.env.DEV_ADMIN_EMAIL || "admin@kpi.local").trim().toLowerCase();

if (process.env.NODE_ENV === "production") {
  throw new Error("Local admin bootstrap is disabled in production.");
}
if (!databaseUrl) throw new Error("DATABASE_URL is required.");
if (!password || password.length < 12) throw new Error("DEV_ADMIN_PASSWORD must be at least 12 characters.");

function derive(passwordValue, salt) {
  return new Promise((resolve, reject) => {
    nodeScrypt(passwordValue, salt, 64, { N: 131_072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error);
      else resolve(Buffer.from(key));
    });
  });
}

async function hashPassword(passwordValue) {
  const salt = randomBytes(16);
  const key = await derive(passwordValue, salt);
  return ["scrypt", 131_072, 8, 1, salt.toString("base64url"), key.toString("base64url")].join("$");
}

const sql = postgres(databaseUrl, { max: 1, connect_timeout: 5, prepare: false });
try {
  const passwordHash = await hashPassword(password);
  await sql.begin(async (tx) => {
    const organizations = await tx`
      INSERT INTO organizations (name, slug)
      VALUES ('KPI Local Workspace', 'kpi-local')
      ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, updated_at = now()
      RETURNING id
    `;
    const organizationId = organizations[0].id;

    await tx`
      INSERT INTO departments (organization_id, name, code)
      VALUES (${organizationId}, 'Engineering', 'ENG')
      ON CONFLICT (organization_id, code)
      DO UPDATE SET name = EXCLUDED.name, active = true, updated_at = now()
    `;

    const users = await tx`
      INSERT INTO users (email, display_name, password_hash, role, active)
      VALUES (${email}, 'Local Administrator', ${passwordHash}, 'ADMINISTRATOR', true)
      ON CONFLICT (email) DO UPDATE SET
        display_name = EXCLUDED.display_name,
        password_hash = EXCLUDED.password_hash,
        role = 'ADMINISTRATOR',
        active = true,
        updated_at = now()
      RETURNING id
    `;
    const userId = users[0].id;

    await tx`
      INSERT INTO user_organization_access (user_id, organization_id, role, active)
      VALUES (${userId}, ${organizationId}, 'ADMINISTRATOR', true)
      ON CONFLICT (user_id, organization_id)
      DO UPDATE SET role = 'ADMINISTRATOR', active = true, updated_at = now()
    `;
  });
  console.log(`Local administrator provisioned: ${email}`);
} finally {
  await sql.end({ timeout: 2 });
}
