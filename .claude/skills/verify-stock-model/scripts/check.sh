#!/bin/sh
# Model-checks CloudCart's stock and pickup-hold design with TLC.
#   sh .claude/skills/verify-stock-model/scripts/check.sh            anchors, then the real model (must pass)
#   sh .claude/skills/verify-stock-model/scripts/check.sh --mutants  also each broken variant (each must fail)
# Needs Java 11+ and tla2tools.jar v1.8.0 (see SKILL.md, "Toolchain"). TLC output goes to
# .verify/tlc/<run>/ (gitignored); read a counterexample with /pstack:statechart.
set -u

ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
SKILL="$ROOT/.claude/skills/verify-stock-model"
JAR="${TLA_JAR:-$HOME/.local/share/tla/tla2tools.jar}"

# Java 11+: $JAVA, then Homebrew's openjdk@21, then whatever is on PATH
for candidate in "${JAVA:-}" /opt/homebrew/opt/openjdk@21/bin/java /usr/local/opt/openjdk@21/bin/java java; do
  [ -n "$candidate" ] || continue
  major=$("$candidate" -version 2>&1 | awk -F'"' '/version/ { split($2, v, "."); print (v[1] == "1" ? v[2] : v[1]) }')
  if [ -n "$major" ] && [ "$major" -ge 11 ]; then JAVA_BIN="$candidate"; break; fi
done
[ -n "${JAVA_BIN:-}" ] || { echo "Need Java 11+ (brew install openjdk@21), or set JAVA=/path/to/java" >&2; exit 2; }
[ -f "$JAR" ] || { echo "Need tla2tools.jar at $JAR (or set TLA_JAR) - see SKILL.md, Toolchain" >&2; exit 2; }

sh "$SKILL/scripts/anchors.sh" || exit 1

RUN="$ROOT/.verify/tlc/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$RUN"
cp "$SKILL/model/CloudCartStock.tla" "$SKILL/model/MC.tla" "$RUN/"

# tlc <name> <Bug value>: runs TLC on MC with Bug set, output to $RUN/<name>.out
tlc() {
  sed "s/Bug = \"none\"/Bug = \"$2\"/" "$SKILL/model/MC.cfg" >"$RUN/$1.cfg"
  (cd "$RUN" && "$JAVA_BIN" -XX:+UseParallelGC -cp "$JAR" tlc2.TLC -deadlock -workers auto \
     -metadir "$RUN/states-$1" -config "$1.cfg" MC.tla >"$1.out" 2>&1)
}
violated() { sed -n 's/^Error: Invariant \([A-Za-z]*\) is violated\.$/\1/p' "$RUN/$1.out" | head -1; }

tlc real none
if grep -q "No error has been found" "$RUN/real.out"; then
  # The final summary line (Progress lines earlier in the output are mid-run snapshots)
  echo "PASS  real model: $(grep -E '^[0-9]+ states generated' "$RUN/real.out" | tail -1)"
else
  inv=$(violated real)
  echo "FAIL  real model: ${inv:-TLC error} - counterexample in $RUN/real.out (read it with /pstack:statechart)"
  exit 1
fi

if [ "${1:-}" = "--mutants" ]; then
  bad=0
  # mutant -> the invariants that may catch it (TLC reports the first one a state breaks)
  for pair in "NoStockCondition:NoOversell" "NoStatusCondition:NoOversell|Conservation" \
              "NoExpiryCondition:Conservation" "ScheduleAfterReserve:HeldPickupWillExpire"; do
    bug=${pair%%:*}; expect=${pair#*:}
    tlc "$bug" "$bug"
    inv=$(violated "$bug")
    if [ -n "$inv" ] && echo "|$expect|" | grep -q "|$inv|"; then
      echo "PASS  mutant $bug caught by $inv"
    else
      echo "FAIL  mutant $bug: expected a $expect violation, got ${inv:-none} - see $RUN/$bug.out"; bad=1
    fi
  done
  [ "$bad" -eq 0 ] || exit 1
fi
echo "TLC output: $RUN"
