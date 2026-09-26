// Loaded via jest `setupFiles`, before any test module (and therefore any
// controller) is imported. Tests mock Prisma, so no DB client is created here.
process.env.JWT_SECRET = 'test-secret-key';
process.env.NODE_ENV = 'test';
