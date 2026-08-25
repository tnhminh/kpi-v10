import { describe, expect, it } from "vitest";
import { ApiError } from "@/server/http";
import { databaseConstraintName, isUniqueViolation, mapUniqueViolation } from "./errors";

describe("database error mapping", () => {
  it("recognizes PostgreSQL unique violations without relying on message text", () => {
    const error = { code: "23505", constraint_name: "members_org_email_lower_uq" };
    expect(isUniqueViolation(error)).toBe(true);
    expect(databaseConstraintName(error)).toBe("members_org_email_lower_uq");
  });

  it("maps expected uniqueness conflicts to HTTP 409", () => {
    try {
      mapUniqueViolation({ code: "23505", constraint: "teams_department_name_lower_uq" }, "A team with this name already exists.");
      throw new Error("Expected mapUniqueViolation to throw.");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(409);
      expect((error as ApiError).code).toBe("CONFLICT");
    }
  });

  it("unwraps Drizzle-style cause chains for PostgreSQL conflicts", () => {
    const wrapped = new Error("Failed query", {
      cause: { code: "23505", constraint_name: "department_head_assignments_department_user_from_uq" },
    });
    expect(isUniqueViolation(wrapped)).toBe(true);
    expect(databaseConstraintName(wrapped)).toBe("department_head_assignments_department_user_from_uq");
    expect(() => mapUniqueViolation(wrapped, "Assignment already exists.")).toThrowError(
      expect.objectContaining({ status: 409, code: "CONFLICT" }),
    );
  });

  it("does not hide unexpected database failures", () => {
    const error = { code: "23503" };
    expect(() => mapUniqueViolation(error, "conflict")).toThrow(error);
  });
});
