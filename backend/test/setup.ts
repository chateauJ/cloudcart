import "aws-sdk-client-mock-jest";
import { clearTenantCache } from "../shared/tenant";

// The logger writes straight to stdout. Capturing it keeps test output readable and lets
// tests assert on log lines via logLines(); restoreMocks undoes the spy after each test.
beforeEach(() => {
  jest.spyOn(process.stdout, "write").mockImplementation(() => true);
  clearTenantCache(); // module state survives between tests in a file; every test resolves its tenant fresh
});
