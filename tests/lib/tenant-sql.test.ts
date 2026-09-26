import { readFileSync } from 'fs';
import { buildTenantSql, GENERATED_PATH, renderModule } from '../../scripts/tenant-sql';

describe('generated tenant SQL', () => {
  it('is up to date with prisma/schema.prisma (run `npm run tenant:sql`)', () => {
    expect(readFileSync(GENERATED_PATH, 'utf8')).toBe(renderModule(buildTenantSql()));
  }, 30000);
});
