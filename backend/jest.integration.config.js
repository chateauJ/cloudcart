/** @type {import('jest').Config} */
// Runs against the deployed dev API - real requests, real data. Never part of `npm test`.
module.exports = {
  testEnvironment: "node",
  roots: ["<rootDir>/integration"],
  transform: { "^.+\\.ts$": "ts-jest" },
  testTimeout: 60000, // the order completes asynchronously via Streams -> Pipe -> SQS -> Lambda
  maxWorkers: 1, // the suites share one test user's cart, so they run one file at a time
};
