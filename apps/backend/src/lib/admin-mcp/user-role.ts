import { eq } from "drizzle-orm";

import { db } from "../../db/index";
import { usersTable } from "../../db/schema";

export async function getUserRole(userId: string): Promise<string | undefined> {
  const [user] = await db
    .select({ role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  return user?.role;
}
