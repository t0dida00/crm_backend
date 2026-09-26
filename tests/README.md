# Backend Intensive Test Suite

This directory contains comprehensive, intensive test cases for the CRM backend API endpoints and services.

## Overview

The test suite is built using **Jest** and **Supertest** for integration testing. All tests follow a structured pattern focused on:

- **Input Validation**: Testing various invalid inputs and edge cases
- **Database Interactions**: Mocking Prisma queries and verifying correct usage
- **Error Handling**: Ensuring proper error responses and status codes
- **Security**: Testing for SQL injection, XSS, and other security issues
- **Performance**: Verifying response times and handling of concurrent requests
- **Edge Cases**: Unicode, special characters, very long strings, etc.

## Test Coverage

### Controllers Tested

1. **Auth Controller** (`auth.controller.intensive.test.ts`)
   - Login endpoint
   - Input validation (email, password)
   - User status checks
   - Platform user checks
   - JWT token generation
   - Account disabled scenarios
   - 100+ test cases

2. **Order Controller** (`order.controller.intensive.test.ts`)
   - List orders
   - Get specific order
   - Create order
   - Update order status
   - Platform validation
   - Status transitions (especially "Paid" status)
   - 50+ test cases

3. **Table Controller** (`table.controller.intensive.test.ts`)
   - List tables
   - List table QR tokens
   - Create table
   - Update table
   - Delete table
   - Validation of name, seats, zone
   - 80+ test cases

## Running Tests

### Run all tests
```bash
npm run test
```

### Run tests in watch mode
```bash
npm run test:watch
```

### Run only intensive tests
```bash
npm run test:intensive
```

### Generate coverage report
```bash
npm run test:coverage
```

## Test Structure

Each test file follows a consistent structure:

```typescript
describe('Controller Name - Intensive Tests', () => {
  // Setup
  beforeEach(() => {
    jest.clearAllMocks();
    // Initialize mock request/response
  });

  describe('Feature Category - Intensive Tests', () => {
    test('specific test case', async () => {
      // Arrange
      const mockData = { /* ... */ };
      (prisma.model.method as jest.Mock).mockResolvedValue(mockData);

      // Act
      await controllerFunction(mockRequest, mockResponse);

      // Assert
      expect(statusMock).toHaveBeenCalledWith(expectedStatus);
      expect(jsonMock).toHaveBeenCalledWith(expectedData);
    });
  });
});
```

## Test Categories

### 1. Input Validation Tests
- Missing required fields
- Wrong data types
- Empty/whitespace strings
- Null/undefined values
- Very long strings
- Special characters and Unicode

### 2. Authentication & Authorization Tests
- Valid/invalid credentials
- Inactive accounts
- Disabled platform users
- Role-based access
- JWT token generation and expiration

### 3. CRUD Operation Tests
- Creating resources with valid data
- Updating partial fields
- Deleting resources
- Verifying platform ownership
- Handling non-existent resources

### 4. Error Handling Tests
- Database errors
- Prisma errors
- Missing platform assignments
- Concurrent request handling
- Socket emission failures

### 5. Security Tests
- SQL injection attempts
- XSS prevention
- Case sensitivity for passwords
- No user enumeration (consistent error messages)

### 6. Edge Case Tests
- Empty collections
- Very large numbers
- Unicode characters (emojis)
- Whitespace handling
- Additional/extra fields in request

### 7. Performance Tests
- Response time verification
- Rapid successive requests
- Concurrent request handling
- Large batch operations

## Mocking Strategy

All external dependencies are mocked:

```typescript
jest.mock('../../src/config/prisma');
jest.mock('../../src/lib/platform-context');
jest.mock('../../src/lib/order-placement');
```

This allows tests to:
- Run without a real database
- Control all external dependencies
- Test error scenarios easily
- Verify correct parameters passed to dependencies

## Key Testing Patterns

### Pattern 1: Successful Operation
```typescript
test('should complete operation successfully', async () => {
  (prisma.model.findFirst as jest.Mock).mockResolvedValue(validData);
  await controller(mockRequest, mockResponse);
  expect(statusMock).toHaveBeenCalledWith(200);
});
```

### Pattern 2: Validation Error
```typescript
test('should reject invalid input', async () => {
  mockRequest.body = { invalidField: 'value' };
  await controller(mockRequest, mockResponse);
  expect(statusMock).toHaveBeenCalledWith(400);
  expect(jsonMock).toHaveBeenCalledWith({ error: 'Expected message' });
});
```

### Pattern 3: Authorization Check
```typescript
test('should verify platform ownership', async () => {
  await controller(mockRequest, mockResponse);
  expect(prisma.model.findFirst).toHaveBeenCalledWith({
    where: { id: 'resource-id', platform_id: 'platform-123' }
  });
});
```

## Test Data

Common test data is defined in `tests/helpers/test-helpers.ts`:

- `mockUsers`: Various user states (valid, inactive, admin)
- `mockTables`: Sample table configurations
- `mockOrders`: Sample orders (open, closed)
- Helper functions for creating mock request/response objects

## Coverage Goals

Current coverage targets:

- **Controllers**: 90%+ line coverage
- **Auth flows**: 100% coverage (security critical)
- **CRUD operations**: 85%+ coverage
- **Error paths**: 80%+ coverage

Run `npm run test:coverage` to generate detailed coverage reports.

## Best Practices Used

1. **Clear test names**: Each test describes exactly what it's testing
2. **Single assertion per test**: Most tests focus on one behavior
3. **Isolated tests**: No dependencies between test cases
4. **Comprehensive edge cases**: Unicode, SQL injection, XSS attempts
5. **Performance baselines**: Verifying reasonable response times
6. **Error message verification**: Checking both status codes and messages
7. **Mock verification**: Confirming mocks are called with correct parameters

## Integration with CI/CD

These tests are designed to run in CI/CD pipelines:

```yaml
# Example GitHub Actions
- name: Run tests
  run: npm run test

- name: Generate coverage
  run: npm run test:coverage

- name: Upload coverage
  uses: codecov/codecov-action@v3
```

## Extending Tests

To add new test cases:

1. Create a new test file following the naming convention: `feature.controller.intensive.test.ts`
2. Use the test structure and patterns from existing tests
3. Mock all external dependencies
4. Include at least 50+ test cases per controller
5. Cover all happy paths and error scenarios
6. Test edge cases and security concerns

## Troubleshooting

### Tests not finding mocks
```typescript
// Ensure jest.mock is called before imports
jest.mock('../../src/path/to/module');
import { functionToTest } from '../../src/path/to/module';
```

### Async/await not working
```typescript
// Always await the controller function
await controllerFunction(mockRequest, mockResponse);
```

### Mock state persisting between tests
```typescript
// Clear all mocks in beforeEach
beforeEach(() => {
  jest.clearAllMocks();
});
```

## Resources

- [Jest Documentation](https://jestjs.io/)
- [Supertest GitHub](https://github.com/visionmedia/supertest)
- [Testing Best Practices](https://github.com/goldbergyoni/javascript-testing-best-practices)
- [Test-Driven Development](https://en.wikipedia.org/wiki/Test-driven_development)
