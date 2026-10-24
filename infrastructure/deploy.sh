#!/usr/bin/env bash
# ==============================================================================
# Phone Reader - AWS Serverless Deployment Script (Bash)
# ==============================================================================
set -e

REGION="${1:-ap-south-1}"
STACK_NAME="${2:-phone-reader}"
API_TOKEN="${3:-}"
DEVICE_ID="${4:-}"
ALEXA_SKILL_ID="${5:-}"

echo "=========================================================="
echo "  Phone Reader: AWS Serverless Free-Tier Deployment"
echo "=========================================================="

if ! command -v sam &> /dev/null; then
    echo "[ERROR] AWS SAM CLI is not installed. Please install sam-cli."
    exit 1
fi

if [ -z "$API_TOKEN" ]; then
    API_TOKEN=$(openssl rand -hex 16 2>/dev/null || date +%s | sha256sum | head -c 32)
    echo "Generated API Token: $API_TOKEN"
fi

if [ -z "$DEVICE_ID" ]; then
    DEVICE_ID="my-personal-phone"
fi

echo "Building backend and Alexa dependencies..."
(cd ../backend && npm install --omit=dev --silent)
(cd ../alexa && npm install --omit=dev --silent)

echo "Building SAM template..."
sam build --template template.yaml

PARAMS="ApiToken=\"$API_TOKEN\" DeviceId=\"$DEVICE_ID\""
if [ -n "$ALEXA_SKILL_ID" ]; then
    PARAMS="$PARAMS AlexaSkillId=\"$ALEXA_SKILL_ID\""
fi

echo "Deploying CloudFormation stack..."
sam deploy \
    --stack-name "$STACK_NAME" \
    --region "$REGION" \
    --capabilities CAPABILITY_IAM \
    --resolve-s3 \
    --parameter-overrides $PARAMS \
    --no-confirm-changeset

echo "Deployment finished."
