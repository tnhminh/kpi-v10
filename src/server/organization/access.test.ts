import { describe, expect, it } from "vitest";
import { ApiError } from "@/server/http";
import { assertOrganizationRolePermission } from "./access";

describe("organization scoped permissions", () => {
  it("uses the organization-scoped role rather than a client/global role claim", () => {
    expect(() => assertOrganizationRolePermission("ADMINISTRATOR", "organization:manage")).not.toThrow();
    expect(() => assertOrganizationRolePermission("MEMBER", "organization:manage")).toThrow(ApiError);
  });

  it("keeps department heads read-capable without configuration-admin rights", () => {
    expect(() => assertOrganizationRolePermission("DEPARTMENT_HEAD", "organization:read")).not.toThrow();
    expect(() => assertOrganizationRolePermission("DEPARTMENT_HEAD", "kpi:manage")).toThrow(ApiError);
  });
});
