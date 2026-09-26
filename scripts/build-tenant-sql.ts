import { writeFileSync } from "fs";
import { buildTenantSql, GENERATED_PATH, renderModule } from "./tenant-sql";

writeFileSync(GENERATED_PATH, renderModule(buildTenantSql()));
console.log(`Wrote ${GENERATED_PATH}`);
