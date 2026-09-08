import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();

async function main() {
  const email = "admin@example.com";
  const password = "password123";
  const password_hash = await bcrypt.hash(password, 10);

  const existing = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
  });

  if (existing) {
    console.log(`User already exists: ${email}`);
    return;
  }

  await prisma.user.create({
    data: {
      email,
      password_hash,
      full_name: "Admin User",
      is_active: true,
    },
  });

  console.log(`Seeded user: ${email} / ${password}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
