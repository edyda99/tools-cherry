#!/usr/bin/env bash
#
# budget-guardrails.sh — idempotent (re)creation of the PDF→Word cost guardrails.
#
# Builds: SNS topic + email sub + kill-switch Lambda (zip, python3.12) + IAM role
#         + SNS→Lambda wiring + SNS topic policy for Budgets + a $1 COST budget
#         with two ACTUAL notifications (>1% and >100%) both targeting the SNS topic.
#
# When usage spikes (CloudWatch alarm, minutes) or charges appear (budget, slow),
# an alert publishes to SNS, which (a) emails the owner and (b) invokes the
# kill-switch Lambda, which zeroes the converter's reserved concurrency. Use
# restore-service.sh to bring the converter back after a trip.
#
# Safe to re-run: every step checks for existing resources first.
set -euo pipefail

PROFILE="tools-berry"
REGION="us-east-1"
ACCOUNT_ID="560904638428"
API_ID="rla8s1dk10"
STAGE='$default'
CONVERTER_FN="pdf-to-word"
TOPIC_NAME="pdf-to-word-budget-alerts"
KS_FN="pdf-to-word-budget-killswitch"
KS_ROLE="pdf-to-word-killswitch-role"
BUDGET_NAME="pdf-to-word-freetier-guard"
EMAIL="edydaherz@gmail.com"

AWS="aws --profile $PROFILE --region $REGION"
TOPIC_ARN="arn:aws:sns:${REGION}:${ACCOUNT_ID}:${TOPIC_NAME}"
KS_ARN="arn:aws:lambda:${REGION}:${ACCOUNT_ID}:function:${KS_FN}"
ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/${KS_ROLE}"

echo "==> [1] SNS topic"
$AWS sns create-topic --name "$TOPIC_NAME" >/dev/null
echo "    $TOPIC_ARN"

echo "==> [2] Email subscription ($EMAIL) — stays PendingConfirmation until link clicked"
if ! $AWS sns list-subscriptions-by-topic --topic-arn "$TOPIC_ARN" \
      --query "Subscriptions[?Endpoint=='$EMAIL'&&Protocol=='email']" --output text | grep -q .; then
  $AWS sns subscribe --topic-arn "$TOPIC_ARN" --protocol email \
    --notification-endpoint "$EMAIL" >/dev/null
  echo "    subscribed (pending confirmation)"
else
  echo "    email subscription already present"
fi

echo "==> [3] IAM role + kill-switch Lambda"
if ! $AWS iam get-role --role-name "$KS_ROLE" >/dev/null 2>&1; then
  TRUST=$(mktemp)
  cat > "$TRUST" <<'JSON'
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}
JSON
  $AWS iam create-role --role-name "$KS_ROLE" --assume-role-policy-document "file://$TRUST" >/dev/null
  rm -f "$TRUST"
  echo "    role created"
else
  echo "    role exists"
fi

$AWS iam attach-role-policy --role-name "$KS_ROLE" \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole >/dev/null 2>&1 || true

INLINE=$(mktemp)
cat > "$INLINE" <<JSON
{"Version":"2012-10-17","Statement":[
 {"Sid":"SetConcurrency","Effect":"Allow","Action":"lambda:PutFunctionConcurrency","Resource":"arn:aws:lambda:${REGION}:${ACCOUNT_ID}:function:${CONVERTER_FN}"}
]}
JSON
$AWS iam put-role-policy --role-name "$KS_ROLE" --policy-name killswitch-inline \
  --policy-document "file://$INLINE" >/dev/null
rm -f "$INLINE"

BUILD=$(mktemp -d)
cat > "$BUILD/index.py" <<PYEOF
import boto3
REGION="${REGION}"; FUNCTION="${CONVERTER_FN}"
def handler(event, context):
    # With the IAM-authed Function URL there's no API Gateway to throttle. Zeroing
    # reserved concurrency stops the converter cold (every invocation throttled).
    boto3.client("lambda", region_name=REGION).put_function_concurrency(
        FunctionName=FUNCTION, ReservedConcurrentExecutions=0)
    print("Kill-switch engaged: reserved concurrency set to 0.")
    return {"status":"killed"}
PYEOF
( cd "$BUILD" && zip -q ks.zip index.py )

if $AWS lambda get-function --function-name "$KS_FN" >/dev/null 2>&1; then
  $AWS lambda update-function-code --function-name "$KS_FN" \
    --zip-file "fileb://$BUILD/ks.zip" >/dev/null
  echo "    kill-switch code updated"
else
  for i in 1 2 3 4 5; do
    if $AWS lambda create-function --function-name "$KS_FN" --runtime python3.12 \
        --role "$ROLE_ARN" --handler index.handler --timeout 30 \
        --zip-file "fileb://$BUILD/ks.zip" >/dev/null 2>&1; then
      echo "    kill-switch created"; break
    fi
    echo "    create attempt $i failed (role propagation?), retrying..."; sleep 8
  done
fi
rm -rf "$BUILD"
$AWS lambda wait function-active --function-name "$KS_FN"

echo "==> [4] Wire SNS -> kill-switch (permission + lambda subscription)"
$AWS lambda add-permission --function-name "$KS_FN" --statement-id sns-invoke \
  --action lambda:InvokeFunction --principal sns.amazonaws.com \
  --source-arn "$TOPIC_ARN" >/dev/null 2>&1 || echo "    invoke permission already present"

if ! $AWS sns list-subscriptions-by-topic --topic-arn "$TOPIC_ARN" \
      --query "Subscriptions[?Endpoint=='$KS_ARN'&&Protocol=='lambda']" --output text | grep -q .; then
  $AWS sns subscribe --topic-arn "$TOPIC_ARN" --protocol lambda \
    --notification-endpoint "$KS_ARN" >/dev/null
  echo "    lambda subscribed"
else
  echo "    lambda subscription already present"
fi

echo "==> [5] SNS topic policy — allow budgets.amazonaws.com to Publish"
POLICY=$(mktemp)
cat > "$POLICY" <<JSON
{"Version":"2008-10-17","Id":"__default_policy_ID","Statement":[
 {"Sid":"__default_statement_ID","Effect":"Allow","Principal":{"AWS":"*"},
  "Action":["SNS:GetTopicAttributes","SNS:SetTopicAttributes","SNS:AddPermission","SNS:RemovePermission","SNS:DeleteTopic","SNS:Subscribe","SNS:ListSubscriptionsByTopic","SNS:Publish"],
  "Resource":"${TOPIC_ARN}","Condition":{"StringEquals":{"AWS:SourceOwner":"${ACCOUNT_ID}"}}},
 {"Sid":"AllowBudgetsPublish","Effect":"Allow","Principal":{"Service":"budgets.amazonaws.com"},
  "Action":"SNS:Publish","Resource":"${TOPIC_ARN}","Condition":{"StringEquals":{"aws:SourceAccount":"${ACCOUNT_ID}"}}}
]}
JSON
$AWS sns set-topic-attributes --topic-arn "$TOPIC_ARN" \
  --attribute-name Policy --attribute-value "file://$POLICY" >/dev/null
rm -f "$POLICY"
echo "    policy set"

echo "==> [6] COST budget \$1/mo with two ACTUAL notifications (>1%, >100%) -> SNS"
BUD=$(mktemp); NOTIFS=$(mktemp)
cat > "$BUD" <<JSON
{"BudgetName":"${BUDGET_NAME}","BudgetLimit":{"Amount":"1.0","Unit":"USD"},"TimeUnit":"MONTHLY","BudgetType":"COST"}
JSON
cat > "$NOTIFS" <<JSON
[
 {"Notification":{"NotificationType":"ACTUAL","ComparisonOperator":"GREATER_THAN","Threshold":1.0,"ThresholdType":"PERCENTAGE"},
  "Subscribers":[{"SubscriptionType":"SNS","Address":"${TOPIC_ARN}"}]},
 {"Notification":{"NotificationType":"ACTUAL","ComparisonOperator":"GREATER_THAN","Threshold":100.0,"ThresholdType":"PERCENTAGE"},
  "Subscribers":[{"SubscriptionType":"SNS","Address":"${TOPIC_ARN}"}]}
]
JSON
if $AWS budgets describe-budget --account-id "$ACCOUNT_ID" --budget-name "$BUDGET_NAME" >/dev/null 2>&1; then
  echo "    budget already exists (leaving as-is; delete it first to recreate)"
else
  $AWS budgets create-budget --account-id "$ACCOUNT_ID" \
    --budget "file://$BUD" --notifications-with-subscribers "file://$NOTIFS" >/dev/null
  echo "    budget created"
fi
rm -f "$BUD" "$NOTIFS"

echo "==> [7] CloudWatch usage alarms -> SNS (fast trip: minutes, not the budget's hours)"
# Spike guard: >150 invocations in any 5 min. The gate caps legit at 100/day, so any
# 5-min window above that is abuse (e.g. a leaked invoker key doing short jobs).
$AWS cloudwatch put-metric-alarm --alarm-name "pdf-to-word-invocation-spike" \
  --namespace AWS/Lambda --metric-name Invocations --statistic Sum \
  --dimensions Name=FunctionName,Value="$CONVERTER_FN" \
  --period 300 --evaluation-periods 1 --threshold 150 \
  --comparison-operator GreaterThanThreshold --treat-missing-data notBreaching \
  --alarm-actions "$TOPIC_ARN" >/dev/null
echo "    spike alarm set (>150 invocations / 5 min)"
# Free-tier guard: estimated GB-seconds per 15 min ~= Sum(Duration ms)/1000 * 2 (2 GB fn).
# Evaluated every 15 min so a leaked-key flood the gate can't see trips fast. 4000
# GB-s/15min sits well above realistic legit bursts and well below an abusive rate.
$AWS cloudwatch put-metric-alarm --alarm-name "pdf-to-word-gbsec-15min" \
  --metrics '[{"Id":"d","MetricStat":{"Metric":{"Namespace":"AWS/Lambda","MetricName":"Duration","Dimensions":[{"Name":"FunctionName","Value":"'"$CONVERTER_FN"'"}]},"Period":900,"Stat":"Sum"},"ReturnData":false},{"Id":"gbsec","Expression":"d/1000*2","Label":"GBsecPer15min","ReturnData":true}]' \
  --evaluation-periods 1 --threshold 4000 \
  --comparison-operator GreaterThanThreshold --treat-missing-data notBreaching \
  --alarm-actions "$TOPIC_ARN" >/dev/null
echo "    GB-seconds alarm set (>4000 / 15 min)"

echo
echo "Done. Confirm the SNS email subscription via the link sent to $EMAIL."
echo "Topic:       $TOPIC_ARN"
echo "Kill-switch: $KS_ARN"
echo "Budget:      $BUDGET_NAME"
