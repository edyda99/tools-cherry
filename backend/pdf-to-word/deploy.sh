#!/usr/bin/env bash
# Build + deploy the PDF->Word Lambda (arm64 container image) to AWS.
# Idempotent: safe to re-run to ship a new image. No secrets live in this file;
# credentials come from the `tools-berry` AWS CLI profile (~/.aws/credentials).
set -euo pipefail

PROFILE="${AWS_PROFILE:-tools-berry}"
REGION="${AWS_REGION:-us-east-1}"
REPO="pdf-to-word"
FUNCTION="pdf-to-word"
ROLE="pdf-to-word-lambda-role"
ARCH="arm64"
MEMORY=2048
TIMEOUT=60
EPHEMERAL=1024
RESERVED_CONCURRENCY=2
INVOKER_USER="pdf-to-word-invoker"   # scoped IAM user the Cloudflare gate signs as

# --- R2 path config (dual-protocol handler) ---------------------------------
# The R2 path pulls the PDF from / writes the .docx back to a Cloudflare R2 bucket.
# Endpoint + bucket have sane defaults; the two credentials MUST come from the
# deploying shell's environment. Fail fast here — before any build/push/AWS call —
# with a clear message if either credential is unset or empty. (R2 keys are hex, so
# they're safe inside the AWS-CLI `Variables={..}` shorthand used below.)
R2_ENDPOINT="${R2_ENDPOINT:-https://42e1924f6e9903245ece8f5adb11d737.r2.cloudflarestorage.com}"
R2_BUCKET="${R2_BUCKET:-pdf-to-word-files}"
: "${R2_ACCESS_KEY_ID:?Set R2_ACCESS_KEY_ID in your shell before deploying (R2 path credential).}"
: "${R2_SECRET_ACCESS_KEY:?Set R2_SECRET_ACCESS_KEY in your shell before deploying (R2 path credential).}"
LAMBDA_ENV="Variables={XDG_CACHE_HOME=/tmp,HOME=/tmp,R2_ENDPOINT=${R2_ENDPOINT},R2_BUCKET=${R2_BUCKET},R2_ACCESS_KEY_ID=${R2_ACCESS_KEY_ID},R2_SECRET_ACCESS_KEY=${R2_SECRET_ACCESS_KEY}}"

ACCOUNT="$(aws sts get-caller-identity --profile "$PROFILE" --query Account --output text)"
ECR="${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com"
IMAGE="${ECR}/${REPO}:latest"
cd "$(dirname "$0")"

echo "==> Ensuring ECR repo"
aws ecr describe-repositories --repository-names "$REPO" --profile "$PROFILE" --region "$REGION" >/dev/null 2>&1 \
  || aws ecr create-repository --repository-name "$REPO" --profile "$PROFILE" --region "$REGION" >/dev/null

echo "==> Logging podman into ECR"
aws ecr get-login-password --profile "$PROFILE" --region "$REGION" \
  | podman login --username AWS --password-stdin "$ECR"

echo "==> Building + pushing image ($ARCH)"
podman build --platform "linux/${ARCH}" -t "$IMAGE" .
podman push "$IMAGE"

echo "==> Ensuring IAM execution role"
if ! aws iam get-role --role-name "$ROLE" --profile "$PROFILE" >/dev/null 2>&1; then
  aws iam create-role --role-name "$ROLE" --profile "$PROFILE" \
    --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}' >/dev/null
  aws iam attach-role-policy --role-name "$ROLE" --profile "$PROFILE" \
    --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole >/dev/null
  echo "   waiting for role propagation..."; sleep 10
fi
ROLE_ARN="$(aws iam get-role --role-name "$ROLE" --profile "$PROFILE" --query Role.Arn --output text)"

echo "==> Creating/updating function"
if aws lambda get-function --function-name "$FUNCTION" --profile "$PROFILE" --region "$REGION" >/dev/null 2>&1; then
  aws lambda update-function-code --function-name "$FUNCTION" --image-uri "$IMAGE" \
    --profile "$PROFILE" --region "$REGION" >/dev/null
else
  aws lambda create-function --function-name "$FUNCTION" \
    --package-type Image --code ImageUri="$IMAGE" --role "$ROLE_ARN" \
    --architectures "$ARCH" --memory-size "$MEMORY" --timeout "$TIMEOUT" \
    --ephemeral-storage Size="$EPHEMERAL" \
    --environment "$LAMBDA_ENV" \
    --profile "$PROFILE" --region "$REGION" >/dev/null
fi

aws lambda wait function-updated --function-name "$FUNCTION" --profile "$PROFILE" --region "$REGION"

echo "==> Updating function configuration (env)"
aws lambda update-function-configuration --function-name "$FUNCTION" \
  --environment "$LAMBDA_ENV" \
  --profile "$PROFILE" --region "$REGION" >/dev/null
aws lambda wait function-updated --function-name "$FUNCTION" --profile "$PROFILE" --region "$REGION"

# Reserved concurrency caps parallel cost. New accounts cap total concurrency at
# 10 and require >=10 unreserved, so reserving fails there — tolerate it; the
# account-wide cap is itself the ceiling.
if aws lambda put-function-concurrency --function-name "$FUNCTION" \
    --reserved-concurrent-executions "$RESERVED_CONCURRENCY" --profile "$PROFILE" --region "$REGION" >/dev/null 2>&1; then
  echo "   reserved concurrency = $RESERVED_CONCURRENCY"
else
  # The account refuses a positive reservation. Remove any existing cap so the
  # function is never left stuck at a stale 0 (= disabled) from an earlier kill.
  aws lambda delete-function-concurrency --function-name "$FUNCTION" --profile "$PROFILE" --region "$REGION" >/dev/null 2>&1 || true
  echo "   !! WARNING: could NOT reserve concurrency ($RESERVED_CONCURRENCY) on this account."
  echo "   !! New accounts cap total concurrency (~10) and forbid reservations. Removed any"
  echo "   !! cap instead so the function stays ENABLED (runs at the account limit). The"
  echo "   !! Cloudflare global cap bounds the NORMAL path; the leaked-key path relies on"
  echo "   !! the CloudWatch GB-s alarm + budget. To tighten, request a concurrency-limit"
  echo "   !! increase from AWS Support, then re-run to actually reserve $RESERVED_CONCURRENCY."
fi

# Front door: an IAM-authed Lambda Function URL. (Anonymous Function URLs are
# blocked on this account, but AWS_IAM ones are allowed — verified.) Only SigV4-
# signed requests from the scoped invoker IAM user can reach Lambda; unsigned or
# forged hits to the URL are rejected by AWS before invocation, at $0.
echo "==> Ensuring IAM-authed Function URL"
FN_URL="$(aws lambda get-function-url-config --function-name "$FUNCTION" \
  --profile "$PROFILE" --region "$REGION" --query FunctionUrl --output text 2>/dev/null || true)"
if [ -z "$FN_URL" ] || [ "$FN_URL" = "None" ]; then
  FN_URL="$(aws lambda create-function-url-config --function-name "$FUNCTION" \
    --auth-type AWS_IAM --profile "$PROFILE" --region "$REGION" --query FunctionUrl --output text)"
fi

echo "==> Ensuring scoped invoker IAM user ($INVOKER_USER)"
aws iam get-user --user-name "$INVOKER_USER" --profile "$PROFILE" >/dev/null 2>&1 \
  || aws iam create-user --user-name "$INVOKER_USER" --profile "$PROFILE" >/dev/null
# Invoking an AWS_IAM Function URL on this account needs BOTH actions on the
# function — InvokeFunctionUrl alone returns 403 Forbidden for a scoped user here.
# (No lambda:FunctionUrlAuthType condition: it isn't populated for the invoke and
# breaks the Allow.) Allow takes a minute to propagate after a fresh key/user.
aws iam put-user-policy --user-name "$INVOKER_USER" --policy-name invoke-funcurl \
  --policy-document "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":[\"lambda:InvokeFunctionUrl\",\"lambda:InvokeFunction\"],\"Resource\":\"arn:aws:lambda:${REGION}:${ACCOUNT}:function:${FUNCTION}\"}]}" \
  --profile "$PROFILE" >/dev/null
# Resource-based grant for the Function URL (same-account IAM invoke).
aws lambda add-permission --function-name "$FUNCTION" --statement-id FunctionURLAllowIAM \
  --action lambda:InvokeFunctionUrl --principal "$ACCOUNT" --function-url-auth-type AWS_IAM \
  --profile "$PROFILE" --region "$REGION" >/dev/null 2>&1 || true

echo "==> Access key for $INVOKER_USER (for the Cloudflare gate)"
if [ "$(aws iam list-access-keys --user-name "$INVOKER_USER" --profile "$PROFILE" \
      --query 'length(AccessKeyMetadata)' --output text)" = "0" ]; then
  KEYFILE="$(pwd)/.invoker-key.json"
  ( umask 077; aws iam create-access-key --user-name "$INVOKER_USER" --profile "$PROFILE" \
      --query 'AccessKey.{AccessKeyId:AccessKeyId,SecretAccessKey:SecretAccessKey}' --output json > "$KEYFILE" )
  echo "   Access key written to (chmod 600, shown ONCE by AWS): $KEYFILE"
  echo "   Put AccessKeyId -> Cloudflare secret LAMBDA_AWS_ACCESS_KEY_ID and"
  echo "       SecretAccessKey -> Cloudflare secret LAMBDA_AWS_SECRET_ACCESS_KEY,"
  echo "   then delete it:  rm \"$KEYFILE\""
else
  echo "   An access key already exists (its secret can't be re-shown). Rotate if needed:"
  echo "       aws iam create-access-key --user-name $INVOKER_USER --profile $PROFILE"
fi

echo
echo "==> Done. Private Function URL — set it as the Cloudflare Pages secret LAMBDA_URL:"
echo "    $FN_URL"
echo "    Do NOT put it in any frontend file. The browser talks only to /api/pdf-to-word."
