config {
  call_module_type = "local" # follow calls into ../../modules, so bad arguments are caught at the call site
}

plugin "terraform" {
  enabled = true
  preset  = "recommended" # unused declarations, untyped variables, missing version constraints, naming
}

plugin "aws" {
  enabled = true
  version = "0.49.0"
  source  = "github.com/terraform-linters/tflint-ruleset-aws" # invalid instance types, runtimes, regions, deprecated arguments
}
