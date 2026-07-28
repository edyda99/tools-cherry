#!/usr/bin/env bash
#
# budget-guardrails.sh — idempotent (re)creation of the PDF→Word cost guardrails.
#
# Builds: SNS topic + email sub + kill-switch Lambda (zip, python3.12) + IAM role
#         + SNS→Lambda wiring + SNS topic policy for Budgets + a $1 COST budget
#         with two ACTUAL notifications (>1% and >100%) both targeting the SNS topic
#         + a USAGE budget on Lambda GB-seconds that trips the kill-switch at 95%
#         of the monthly free tier (stops the converter BEFORE any charge — $0 bill)
#         + an auto-restore Lambda + its role + an hourly EventBridge schedule
#         + a second, notify-only SNS topic the auto-restore reports on.
#
# When usage spikes (CloudWatch alarm, minutes) or charges appear (budget, slow),
# an alert publishes to SNS, which (a) emails the owner and (b) invokes the
# kill-switch Lambda, which zeroes the converter's reserved concurrency. Anything
# published to that topic therefore KILLS the converter; it is a control channel,
# not a mailing list. Notifications that must not kill go to the notices topic.
#
# The converter then reopens itself on the next hourly check, unless the day has already
# spent its 10,000 GB-s budget (in which case it waits for the UTC rollover) or
# month-to-date is at 90% of the free tier (in which case it stays off and the notices
# topic asks a human to decide). restore-service.sh is now only for reopening immediately.
#
# Safe to re-run: every step checks for existing resources first.
set -euo pipefail

PROFILE="tools-berry"
REGION="us-east-1"
ACCOUNT_ID="560904638428"
CONVERTER_FN="pdf-to-word"
TOPIC_NAME="pdf-to-word-budget-alerts"
NOTICE_TOPIC_NAME="pdf-to-word-restore-notices"
KS_FN="pdf-to-word-budget-killswitch"
KS_ROLE="pdf-to-word-killswitch-role"
RESTORE_FN="pdf-to-word-daily-restore"
RESTORE_ROLE="pdf-to-word-daily-restore-role"
RESTORE_RULE="pdf-to-word-daily-restore"
BUDGET_NAME="pdf-to-word-freetier-guard"
USAGE_BUDGET_NAME="pdf-to-word-freetier-gbsec-guard"
EMAIL="edydaherz@gmail.com"

AWS="aws --profile $PROFILE --region $REGION"
TOPIC_ARN="arn:aws:sns:${REGION}:${ACCOUNT_ID}:${TOPIC_NAME}"
NOTICE_TOPIC_ARN="arn:aws:sns:${REGION}:${ACCOUNT_ID}:${NOTICE_TOPIC_NAME}"
KS_ARN="arn:aws:lambda:${REGION}:${ACCOUNT_ID}:function:${KS_FN}"
ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/${KS_ROLE}"
RESTORE_ARN="arn:aws:lambda:${REGION}:${ACCOUNT_ID}:function:${RESTORE_FN}"
RESTORE_ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/${RESTORE_ROLE}"
RULE_ARN="arn:aws:events:${REGION}:${ACCOUNT_ID}:rule/${RESTORE_RULE}"

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
# Both alarms measure the same thing - GB-seconds, = Sum(Duration ms)/1000 * 2 (2 GB fn)
# - over two horizons, because OCR made a conversion ~260 GB-s (130s x 2 GB) instead of
# the ~20 GB-s it was. The old pair no longer worked: the invocation-count alarm needed
# 150 invocations/5min, which the concurrency ceiling of 10 makes physically impossible
# at 130-180s per run (~16 completions/5min), and 4000 GB-s/15min had become just 15
# conversions, so an ordinary busy quarter-hour would have killed the service.
#
# [a] BURST - the fast one. 8000 GB-s in 5 minutes is more than the gate can physically
# pass in that window (concurrency 10 at ~130s = ~23 conversions = ~6000 GB-s), so it
# fires only on traffic that did NOT come through the gate: a leaked invoke credential.
# 5 minutes is the metric's native granularity; detection lands ~6 min in, capping the
# burn at ~9600 GB-s (about $0.13 once the free tier is gone).
$AWS cloudwatch put-metric-alarm --alarm-name "pdf-to-word-gbsec-burst" \
  --metrics '[{"Id":"d","MetricStat":{"Metric":{"Namespace":"AWS/Lambda","MetricName":"Duration","Dimensions":[{"Name":"FunctionName","Value":"'"$CONVERTER_FN"'"}]},"Period":300,"Stat":"Sum"},"ReturnData":false},{"Id":"gbsec","Expression":"d/1000*2","Label":"GBsecPer5min","ReturnData":true}]' \
  --evaluation-periods 1 --threshold 8000 \
  --comparison-operator GreaterThanThreshold --treat-missing-data notBreaching \
  --alarm-actions "$TOPIC_ARN" >/dev/null
echo "    burst alarm set (>8000 GB-s / 5 min)"
# [b] DAILY - the free-tier budget. 10000 GB-s/day x 31 = 310,000, inside the 400,000
# always-free monthly pool with room to spare. Catches what [a] cannot: a slow drip that
# stays under the burst threshold but still accumulates. A 1-day period is the longest
# CloudWatch allows and evaluates about once per period, so treat this as the backstop,
# not the fast guard. It is NOT an abuse-only signal: GLOBAL_DAILY_CAP is 100 (wrangler.toml)
# and OCR made a conversion ~260 GB-s, so a fully booked legitimate day reaches ~26000 GB-s and
# trips this. That is tolerable only because the auto-restore in [9] reopens the converter at
# 00:05 instead of leaving it off until someone notices; lower the gate cap to ~35/day if this
# alarm should mean abuse rather than a busy day.
$AWS cloudwatch put-metric-alarm --alarm-name "pdf-to-word-gbsec-daily" \
  --metrics '[{"Id":"d","MetricStat":{"Metric":{"Namespace":"AWS/Lambda","MetricName":"Duration","Dimensions":[{"Name":"FunctionName","Value":"'"$CONVERTER_FN"'"}]},"Period":86400,"Stat":"Sum"},"ReturnData":false},{"Id":"gbsec","Expression":"d/1000*2","Label":"GBsecPerDay","ReturnData":true}]' \
  --evaluation-periods 1 --threshold 10000 \
  --comparison-operator GreaterThanThreshold --treat-missing-data notBreaching \
  --alarm-actions "$TOPIC_ARN" >/dev/null
echo "    daily alarm set (>10000 GB-s / day)"
# Retired 2026-07-28: pdf-to-word-invocation-spike (unreachable) and pdf-to-word-gbsec-15min
# (superseded by the pair above). Delete them if an older run of this script created them.
$AWS cloudwatch delete-alarms --alarm-names "pdf-to-word-invocation-spike" "pdf-to-word-gbsec-15min" 2>/dev/null || true

echo "==> [8] USAGE budget — free-tier GB-second guard (kill at 95% of 400k, before any charge)"
# Cumulative monthly guard the rate alarms can't provide: tracks gross Lambda compute
# against the 400,000 GB-sec/mo free tier and fires the SAME SNS topic (-> email +
# kill-switch) at 95% = 380,000 GB-sec, i.e. BEFORE the first cent of paid usage.
# Auto-resets monthly. Limit unit is "seconds" (the GB-second usage type's reported unit).
#
# The usage types are BOTH architectures and carry NO region prefix. This filter said
# "USE1-Lambda-GB-Second" until 2026-07-28 and therefore matched nothing: the budget sat at
# 0.0 while Cost Explorer reported 1,438.7 GB-s of real Lambda-GB-Second-ARM for the month,
# so the guard had been silently dead since it was created. Verify with
# `aws ce get-cost-and-usage --group-by Type=DIMENSION,Key=USAGE_TYPE` before trusting any
# edit here, and re-check after a region is added - the strings are what the account
# actually emits, not what the pricing docs suggest.
#
# NOTE: a 95% trip is a HARD monthly stop — usage stays >=95% until month rollover, so both
# restore-service.sh and the nightly auto-restore will be re-killed at the next budget eval
# (the auto-restore holds at 90% by design and says so); bring the server path back only
# after accepting paid use or by temporarily raising/removing this budget.
UBUD=$(mktemp); UNOTIFS=$(mktemp)
cat > "$UBUD" <<JSON
{"BudgetName":"${USAGE_BUDGET_NAME}","BudgetLimit":{"Amount":"400000","Unit":"seconds"},"TimeUnit":"MONTHLY","BudgetType":"USAGE","CostFilters":{"UsageType":["Lambda-GB-Second","Lambda-GB-Second-ARM"]}}
JSON
cat > "$UNOTIFS" <<JSON
[
 {"Notification":{"NotificationType":"ACTUAL","ComparisonOperator":"GREATER_THAN","Threshold":95.0,"ThresholdType":"PERCENTAGE"},
  "Subscribers":[{"SubscriptionType":"SNS","Address":"${TOPIC_ARN}"}]}
]
JSON
if $AWS budgets describe-budget --account-id "$ACCOUNT_ID" --budget-name "$USAGE_BUDGET_NAME" >/dev/null 2>&1; then
  echo "    usage budget already exists (leaving as-is; delete it first to recreate)"
else
  $AWS budgets create-budget --account-id "$ACCOUNT_ID" \
    --budget "file://$UBUD" --notifications-with-subscribers "file://$UNOTIFS" >/dev/null
  echo "    usage budget created (kill at 95% of 400k GB-sec)"
fi
rm -f "$UBUD" "$UNOTIFS"

echo "==> [9] Notices topic + IAM role + daily auto-restore Lambda"
# The daily alarm measures one UTC day, so a trip on it costs a whole day of service:
# the window is clean again at midnight but nothing reopens the converter, and until
# 2026-07-28 the only way back was a human running restore-service.sh. This function is
# that human on a timer. It is deliberately NOT wired to the alarm's OK action: an OK
# transition says the last window was quiet, which is true seconds after a burst trip and
# would reopen straight into whatever caused it.
#
# Everything this function says goes to its own topic and never to $TOPIC_ARN, because the
# kill-switch subscribes to that one with no filter: a "reopened" mail published there would
# be delivered straight back as put_function_concurrency(0), re-throttling the converter
# within a second of it being freed. Same reason the restore's own error alarm points here.
$AWS sns create-topic --name "$NOTICE_TOPIC_NAME" >/dev/null
if ! $AWS sns list-subscriptions-by-topic --topic-arn "$NOTICE_TOPIC_ARN" \
      --query "Subscriptions[?Endpoint=='$EMAIL'&&Protocol=='email']" --output text | grep -q .; then
  $AWS sns subscribe --topic-arn "$NOTICE_TOPIC_ARN" --protocol email \
    --notification-endpoint "$EMAIL" >/dev/null
  echo "    notices topic created, email subscribed (pending confirmation)"
else
  echo "    notices topic email subscription already present"
fi

if ! $AWS iam get-role --role-name "$RESTORE_ROLE" >/dev/null 2>&1; then
  RTRUST=$(mktemp)
  cat > "$RTRUST" <<'JSON'
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}
JSON
  $AWS iam create-role --role-name "$RESTORE_ROLE" --assume-role-policy-document "file://$RTRUST" >/dev/null
  rm -f "$RTRUST"
  echo "    role created"
else
  echo "    role exists"
fi

$AWS iam attach-role-policy --role-name "$RESTORE_ROLE" \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole >/dev/null 2>&1 || true

# Delete only, no PutFunctionConcurrency: a role that runs unattended every night should not
# also carry the ability to throttle the converter. The day the account ceiling rises past ~20
# and the restore becomes reserved=10 (see the trigger in AWS-ARCHITECTURE.md), re-running this
# script grants it, which is one command on a day that already needs a code edit here.
# GetMetricStatistics takes no resource-level condition, so "*" is the only form AWS accepts.
RINLINE=$(mktemp)
cat > "$RINLINE" <<JSON
{"Version":"2012-10-17","Statement":[
 {"Sid":"ClearConcurrency","Effect":"Allow","Action":["lambda:DeleteFunctionConcurrency","lambda:GetFunctionConcurrency"],"Resource":"arn:aws:lambda:${REGION}:${ACCOUNT_ID}:function:${CONVERTER_FN}"},
 {"Sid":"ReadCompute","Effect":"Allow","Action":"cloudwatch:GetMetricStatistics","Resource":"*"},
 {"Sid":"PublishNotice","Effect":"Allow","Action":"sns:Publish","Resource":"${NOTICE_TOPIC_ARN}"}
]}
JSON
$AWS iam put-role-policy --role-name "$RESTORE_ROLE" --policy-name daily-restore-inline \
  --policy-document "file://$RINLINE" >/dev/null
rm -f "$RINLINE"

RBUILD=$(mktemp -d)
cat > "$RBUILD/index.py" <<PYEOF
import datetime, boto3
REGION="${REGION}"; FUNCTION="${CONVERTER_FN}"; TOPIC="${NOTICE_TOPIC_ARN}"
# 90% of the 400,000 GB-s always-free pool, deliberately below the usage budget's 95%
# trip rather than level with it. Two reasons for the gap: this reads the converter's own
# compute while the budget bills gross account-wide Lambda GB-s, which is always the larger
# number, and reopening at a figure the budget has already passed just hands the day back
# and forth.
MONTH_STOP_GBSEC=360000
# Today's own budget, the same number the daily alarm fires on. It is what makes running
# this HOURLY safe: a burst trip is a leaked credential, which stops the moment the kill
# switch bites and costs about 9,600 GB-s, so reopening an hour later is right. A daily-
# budget trip means the day is genuinely spent, and reopening would just spend it again -
# so the two cases are told apart by how much the day has already cost, not by the clock.
# One burst cycle puts the day within a whisker of this line, so a second one holds the
# converter shut until midnight without needing the daily alarm to have evaluated yet.
DAY_STOP_GBSEC=10000

def gbsec_since(start, now):
    # Duration Sum is milliseconds of execution; the alarms turn that into GB-seconds with
    # sum/1000*2 for the 2 GB function, and both windows here use the same arithmetic so
    # this guard and the alarms cannot disagree. It counts this function only, so it reads
    # slightly under the account-wide usage the budget measures - see MONTH_STOP_GBSEC.
    stats=boto3.client("cloudwatch", region_name=REGION).get_metric_statistics(
        Namespace="AWS/Lambda", MetricName="Duration",
        Dimensions=[{"Name":"FunctionName","Value":FUNCTION}],
        StartTime=start, EndTime=now, Period=3600, Statistics=["Sum"])
    return sum(point["Sum"] for point in stats["Datapoints"]) / 1000 * 2

def handler(event, context):
    sns=boto3.client("sns", region_name=REGION)
    lam=boto3.client("lambda", region_name=REGION)
    try:
        # Nothing to reopen is the normal hourly outcome, and it must stay SILENT: a notice
        # every hour would train the reader to ignore the channel that carries the one
        # message that matters.
        if "ReservedConcurrentExecutions" not in lam.get_function_concurrency(FunctionName=FUNCTION):
            print("Converter is not throttled, nothing to do.")
            return {"status":"open"}
        now=datetime.datetime.now(datetime.timezone.utc)
        used=gbsec_since(now.replace(day=1, hour=0, minute=0, second=0, microsecond=0), now)
        today=gbsec_since(now.replace(hour=0, minute=0, second=0, microsecond=0), now)
        if used >= MONTH_STOP_GBSEC:
            # A fresh window is no evidence the MONTH is affordable. Past this line the next
            # conversion is billed, so the decision to spend stops being automatable. Said
            # once a day rather than hourly, at the first run after midnight.
            if now.hour == 0:
                sns.publish(TopicArn=TOPIC,
                    Subject="pdf-to-word not reopened: monthly free tier nearly spent",
                    Message="Month-to-date compute for the converter is %d GB-s of the 400000 always-free pool, so the auto-restore is leaving it throttled. Reopening means paid usage. Decide, then run backend/pdf-to-word/restore-service.sh to reopen by hand." % used)
            print("Held: %d GB-s month-to-date." % used)
            return {"status":"held-month","gbsec":used}
        if today >= DAY_STOP_GBSEC:
            # Expected behaviour on a day that spent its budget, not an incident: it clears
            # itself at midnight UTC, so it is logged and not mailed.
            print("Held: %d GB-s today, budget is %d." % (today, DAY_STOP_GBSEC))
            return {"status":"held-today","gbsec":today}
        # Removing the reservation rather than setting a positive one is not a shortcut: this
        # account's min-unreserved floor equals its ceiling, so any positive value is rejected
        # (restore-service.sh hit the same wall).
        lam.delete_function_concurrency(FunctionName=FUNCTION)
        sns.publish(TopicArn=TOPIC,
            Subject="pdf-to-word reopened",
            Message="Reserved concurrency cleared, the converter accepts requests again. It has used %d GB-s today and %d GB-s month-to-date, against a 10000 daily budget and the 400000 always-free monthly pool." % (today, used))
        print("Reopened: %d GB-s today, %d GB-s month-to-date." % (today, used))
        return {"status":"restored","today":today,"gbsec":used}
    except Exception as failure:
        # Dying quietly is the one outcome worse than having no auto-restore at all: the
        # converter stays throttled for the whole day and the human who used to do this by
        # hand has been told not to. Re-raise so the Errors alarm still speaks if the publish
        # below is itself what failed, and so EventBridge records the failed invocation.
        sns.publish(TopicArn=TOPIC,
            Subject="pdf-to-word auto-restore FAILED",
            Message="The daily auto-restore did not finish, so the converter may still be throttled: %r. Run backend/pdf-to-word/restore-service.sh to reopen it by hand." % failure)
        raise
PYEOF
( cd "$RBUILD" && zip -q restore.zip index.py )

if $AWS lambda get-function --function-name "$RESTORE_FN" >/dev/null 2>&1; then
  $AWS lambda update-function-code --function-name "$RESTORE_FN" \
    --zip-file "fileb://$RBUILD/restore.zip" >/dev/null
  echo "    daily-restore code updated"
else
  RESTORE_CREATED=""
  for i in 1 2 3 4 5; do
    if $AWS lambda create-function --function-name "$RESTORE_FN" --runtime python3.12 \
        --role "$RESTORE_ROLE_ARN" --handler index.handler --timeout 30 \
        --zip-file "fileb://$RBUILD/restore.zip" >/dev/null 2>&1; then
      echo "    daily-restore created"; RESTORE_CREATED=1; break
    fi
    echo "    create attempt $i failed (role propagation?), retrying..."; sleep 8
  done
  # Stop here rather than fall into the wait below, which would abort on "function not
  # found" and hide the five create failures that are the thing actually worth reading.
  if [ -z "$RESTORE_CREATED" ]; then
    echo "    ERROR: could not create $RESTORE_FN after 5 attempts" >&2
    rm -rf "$RBUILD"
    exit 1
  fi
fi
rm -rf "$RBUILD"
$AWS lambda wait function-active --function-name "$RESTORE_FN"

echo "==> [10] Wire EventBridge -> restore check (hourly, :05)"
# Hourly at :05, not nightly. A burst trip is a leaked credential that stops the second the
# kill switch bites, and holding the converter shut until the next midnight for it costs up
# to fifteen hours of service for a threat that lasted minutes. The function decides which
# case it is from how much the day has already spent, so the schedule can be frequent
# without weakening the daily budget. :05 rather than :00 leaves CloudWatch a few minutes to
# publish the closing datapoint of the hour, and the run at 00:05 is still the one that acts
# on a day whose budget has just reset.
# An operator who disables the rule during an incident is holding the converter shut on
# purpose; a re-run of this script must not quietly hand the night back to the timer.
RULE_STATE="ENABLED"
if EXISTING_STATE=$($AWS events describe-rule --name "$RESTORE_RULE" --query State --output text 2>/dev/null); then
  RULE_STATE="$EXISTING_STATE"
  if [ "$RULE_STATE" = "DISABLED" ]; then
    echo "    rule exists and is DISABLED, leaving it off"
  fi
fi
$AWS events put-rule --name "$RESTORE_RULE" --schedule-expression "cron(5 * * * ? *)" \
  --description "Reopen the pdf-to-word converter once its budget allows" \
  --state "$RULE_STATE" >/dev/null
$AWS lambda add-permission --function-name "$RESTORE_FN" --statement-id events-invoke \
  --action lambda:InvokeFunction --principal events.amazonaws.com \
  --source-arn "$RULE_ARN" >/dev/null 2>&1 || true
# add-permission fails identically for "already there" and for a call that genuinely did not
# land (IAM propagation on a fresh account), and a rule that cannot invoke its target is a
# schedule that silently never runs, so read the policy back instead of trusting the exit code.
if ! $AWS lambda get-policy --function-name "$RESTORE_FN" --query Policy --output text 2>/dev/null \
     | grep -q "events-invoke"; then
  echo "    ERROR: events-invoke permission is not on $RESTORE_FN; the schedule could never fire" >&2
  exit 1
fi
# put-targets answers 200 even when it attached nothing; the failure count is in the body.
FAILED_TARGETS=$($AWS events put-targets --rule "$RESTORE_RULE" \
  --targets "Id=daily-restore,Arn=$RESTORE_ARN" --query FailedEntryCount --output text)
if [ "$FAILED_TARGETS" != "0" ]; then
  echo "    ERROR: put-targets reported $FAILED_TARGETS failed entries" >&2
  exit 1
fi
echo "    schedule set (cron(5 * * * ? *) UTC, state $RULE_STATE)"

# The restore is now the only thing that reopens the converter, so its own failures have to
# be loud: without this, a broken handler leaves the service throttled and says nothing.
# Points at the notices topic, never the alerts one - routing it there would answer a
# restore bug by killing the converter it was trying to revive.
$AWS cloudwatch put-metric-alarm --alarm-name "pdf-to-word-daily-restore-errors" \
  --namespace AWS/Lambda --metric-name Errors --statistic Sum \
  --dimensions Name=FunctionName,Value="$RESTORE_FN" \
  --period 3600 --evaluation-periods 1 --threshold 0 \
  --comparison-operator GreaterThanThreshold --treat-missing-data notBreaching \
  --alarm-actions "$NOTICE_TOPIC_ARN" >/dev/null
echo "    restore-error alarm set (any Errors datapoint -> notices topic)"

echo
echo "Done. Confirm BOTH SNS email subscriptions via the links sent to $EMAIL."
echo "Topic:        $TOPIC_ARN (publishing here kills the converter)"
echo "Notices:      $NOTICE_TOPIC_ARN (email only)"
echo "Kill-switch:  $KS_ARN"
echo "Auto-restore: $RESTORE_ARN (hourly at :05, held on the day's 10000 GB-s budget or 90% of the monthly pool)"
echo "Cost budget:  $BUDGET_NAME       (\$1/mo — auto-kills a penny into paid)"
echo "Usage budget: $USAGE_BUDGET_NAME (95% of 400k GB-sec — kills before any charge)"
