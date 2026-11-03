/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "node",
  roots: ["<rootDir>/functions", "<rootDir>/shared"],
  transform: { "^.+\\.ts$": "ts-jest" },
  // env.ts runs before any test file imports a handler - handlers read table names at import time
  setupFiles: ["<rootDir>/test/env.ts"],
  setupFilesAfterEnv: ["<rootDir>/test/setup.ts"],
  restoreMocks: true,
  collectCoverageFrom: ["functions/**/*.ts", "shared/**/*.ts", "!**/*.test.ts"],
  // A floor, not a target: --coverage fails CI if a change drops below it
  coverageThreshold: { global: { statements: 90, branches: 85, functions: 100, lines: 90 } },
};
