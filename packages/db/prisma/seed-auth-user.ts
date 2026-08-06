// Upserts CRM staff logins for local testing. Deliberately separate from
// seed.ts (which wipes and repopulates every table) — this script only
// ever touches the rows it owns, safe to re-run against a live database.
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const USERS = [
  { username: "Testing", password: "Testing@123", firstName: "Testing", lastName: "User", email: "testing@voltmark.internal" },
  { username: "Admin", password: "Admin123", firstName: "Admin", lastName: "User", email: "admin@voltmark.internal" },
];

async function main() {
  for (const u of USERS) {
    const passwordHash = await bcrypt.hash(u.password, 10);
    const user = await prisma.user.upsert({
      where: { username: u.username },
      update: { passwordHash },
      create: {
        firstName: u.firstName,
        lastName: u.lastName,
        email: u.email,
        username: u.username,
        passwordHash,
        role: "SYSTEM_ADMIN",
      },
    });
    console.log(`CRM user ready: username="${user.username}" role=${user.role}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
