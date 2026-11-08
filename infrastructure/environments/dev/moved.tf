moved { # module.products_table
  from = module.products_table
  to   = module.app.module.products_table
}

moved { # module.products_lambda
  from = module.products_lambda
  to   = module.app.module.products_lambda
}

moved { # module.carts_table
  from = module.carts_table
  to   = module.app.module.carts_table
}

moved { # module.cart_lambda
  from = module.cart_lambda
  to   = module.app.module.cart_lambda
}

moved { # module.orders_table
  from = module.orders_table
  to   = module.app.module.orders_table
}

moved { # module.orders_lambda
  from = module.orders_lambda
  to   = module.app.module.orders_lambda
}

moved { # module.order_queue
  from = module.order_queue
  to   = module.app.module.order_queue
}

moved { # module.notifications_lambda
  from = module.notifications_lambda
  to   = module.app.module.notifications_lambda
}

moved { # module.order_notifications_topic
  from = module.order_notifications_topic
  to   = module.app.module.order_notifications_topic
}

moved { # module.order_events
  from = module.order_events
  to   = module.app.module.order_events
}

moved { # module.inventory_lambda
  from = module.inventory_lambda
  to   = module.app.module.inventory_lambda
}

moved { # module.auth
  from = module.auth
  to   = module.app.module.auth
}

moved { # module.api
  from = module.api
  to   = module.app.module.api
}

moved { # module.monitoring
  from = module.monitoring
  to   = module.app.module.monitoring
}
