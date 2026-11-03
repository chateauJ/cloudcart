// Fixed values so tests can assert exact table names, regardless of the developer's shell
process.env.PRODUCTS_TABLE_NAME = "products-table";
process.env.CARTS_TABLE_NAME = "carts-table";
process.env.ORDERS_TABLE_NAME = "orders-table";
process.env.ORDERS_USER_INDEX_NAME = "userId-createdAt-index";
process.env.AWS_REGION = "us-east-1";

// No X-Ray outside Lambda, and the logger's defaults apply unless a test opts in
delete process.env.AWS_XRAY_DAEMON_ADDRESS;
delete process.env._X_AMZN_TRACE_ID;
delete process.env.LOG_LEVEL;
