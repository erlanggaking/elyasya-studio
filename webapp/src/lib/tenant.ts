import type { User } from "@prisma/client";
import { db } from "./db";

export type TenantUser = Pick<User, "id" | "role">;

export function isSuperuser(user: TenantUser): boolean {
  return user.role === "superuser";
}

export function studioTenantWhere(user: TenantUser) {
  return isSuperuser(user) ? {} : { ownerId: user.id };
}

export function hostTenantWhere(user: TenantUser) {
  return isSuperuser(user) ? {} : { ownerId: user.id };
}

export function sessionTenantWhere(user: TenantUser) {
  return isSuperuser(user) ? {} : { host: { ownerId: user.id } };
}

export async function canAccessStudio(user: TenantUser, studioId: string): Promise<boolean> {
  if (isSuperuser(user)) return !!(await db.studio.findUnique({ where: { id: studioId }, select: { id: true } }));
  return !!(await db.studio.findFirst({
    where: { id: studioId, ownerId: user.id },
    select: { id: true },
  }));
}

export async function canAccessHost(user: TenantUser, hostId: string): Promise<boolean> {
  if (isSuperuser(user)) return !!(await db.host.findUnique({ where: { id: hostId }, select: { id: true } }));
  return !!(await db.host.findFirst({
    where: { id: hostId, ownerId: user.id },
    select: { id: true },
  }));
}

export async function canAccessSession(user: TenantUser, sessionId: string): Promise<boolean> {
  if (isSuperuser(user)) {
    return !!(await db.liveSession.findUnique({ where: { id: sessionId }, select: { id: true } }));
  }
  return !!(await db.liveSession.findFirst({
    where: { id: sessionId, host: { ownerId: user.id } },
    select: { id: true },
  }));
}
