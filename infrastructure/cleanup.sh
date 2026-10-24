#!/usr/bin/env bash
# ==============================================================================
# Phone Reader - AWS Resource Cleanup / Teardown Script (Bash)
# ==============================================================================
set -e

REGION="${1:-ap-south-1}"
STACK_NAME="${2:-phone-reader}"

echo "Deleting CloudFormation stack $STACK_NAME in $REGION..."
aws cloudformation delete-stack --stack-name "$STACK_NAME" --region "$REGION"
echo "Waiting for stack deletion..."
aws cloudformation wait stack-delete-complete --stack-name "$STACK_NAME" --region "$REGION"
echo "Cleanup completed."
