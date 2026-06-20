#!/usr/bin/env bash
#
# restore-service.sh — re-enable the PDF→Word converter after the kill-switch tripped.
#
# The kill-switch (pdf-to-word-budget-killswitch) zeroes the converter's reserved
# concurrency. This re-enables it: reserved 2 if the account allows reservations,
# otherwise it removes the cap (this account forbids positive reservations, so the
# function runs at the account concurrency limit). There is no API Gateway anymore
# — the front door is an IAM-authed Lambda Function URL the kill-switch never touches.
#
# Run this AFTER you've dealt with the real cost cause, or the next alarm/budget
# evaluation can simply trip the kill-switch again.
set -euo pipefail

PROFILE="tools-berry"
REGION="us-east-1"
CONVERTER_FN="pdf-to-word"

AWS="aws --profile $PROFILE --region $REGION"

echo "==> Re-enabling concurrency on $CONVERTER_FN"
if $AWS lambda put-function-concurrency --function-name "$CONVERTER_FN" \
     --reserved-concurrent-executions 2 >/dev/null 2>&1; then
  echo "    reserved concurrency = 2"
else
  $AWS lambda delete-function-concurrency --function-name "$CONVERTER_FN" >/dev/null
  echo "    account forbids a positive reservation; removed the cap instead — re-enabled"
fi

echo "==> Confirming the Function URL still exists"
URL="$($AWS lambda get-function-url-config --function-name "$CONVERTER_FN" \
  --query FunctionUrl --output text 2>/dev/null || echo none)"
echo "    $URL"
echo
echo "Converter re-enabled. An unsigned curl to that URL returns 403 — that's correct:"
echo "only the Cloudflare gate's SigV4-signed requests are accepted."
