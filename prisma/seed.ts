import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();

const PLATFORM_TYPES = [
  { code: "RESTAURANT", name: "Restaurant", description: "Restaurant management and table booking platform" },
  { code: "CAFE", name: "Cafe", description: "Cafe management and table booking platform" },
];

async function seedPlatformTypes() {
  for (const type of PLATFORM_TYPES) {
    await prisma.platform_types.upsert({
      where: { code: type.code },
      update: {},
      create: { ...type, is_active: true },
    });
  }
  console.log("Seeded platform_types: RESTAURANT, CAFE");
}

async function seedAdminUser() {
  const email = "admin@example.com";
  const password = "password123";

  const existing = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
  });
  if (existing) {
    console.log(`User already exists: ${email}`);
    return;
  }

  const password_hash = await bcrypt.hash(password, 10);
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

async function main() {
  await seedPlatformTypes();
  await seedAdminUser();
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
