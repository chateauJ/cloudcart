// Fixed values so tests can assert exact table names, regardless of the developer's shell
process.env.PRODUCTS_TABLE_NAME = "products-table";
process.env.CARTS_TABLE_NAME = "carts-table";
process.env.ORDERS_TABLE_NAME = "orders-table";
process.env.ORDERS_USER_INDEX_NAME = "tenantUser-createdAt-index";
process.env.TENANTS_TABLE_NAME = "tenants-table";
process.env.LOCATIONS_TABLE_NAME = "locations-table";
process.env.STOCK_TABLE_NAME = "stock-table";
process.env.HOLD_MINUTES = "10";
process.env.HOLD_SCHEDULE_GROUP = "holds-group";
process.env.HOLD_EXPIRY_TARGET_ARN = "arn:aws:lambda:us-east-1:123456789012:function:expiry";
process.env.HOLD_SCHEDULER_ROLE_ARN = "arn:aws:iam::123456789012:role/hold-scheduler";
process.env.AWS_REGION = "us-east-1";

// No X-Ray outside Lambda, and the logger's defaults apply unless a test opts in
delete process.env.AWS_XRAY_DAEMON_ADDRESS;
delete process.env._X_AMZN_TRACE_ID;
delete process.env.LOG_LEVEL;
