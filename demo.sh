#!/bin/bash

echo "🚀 Payment Service Demo - Testing the Broken Feature"
echo "=================================================="

# Check if server is running
if ! curl -s http://localhost:3000/health > /dev/null; then
    echo "❌ Server not running! Please start it first:"
    echo "   npm run dev"
    echo ""
    exit 1
fi

echo "✅ Server is running!"
echo ""

echo "🧪 Testing sendCustomerSummary: false (should work)"
echo "---------------------------------------------------"
curl -X POST http://localhost:3000/api/transactions \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 5000,
    "currency": "USD",
    "customerId": "demo_user_1",
    "paymentMethod": "card",
    "sendCustomerSummary": false
  }' | jq '.'

echo ""
echo ""

echo "🐛 Testing sendCustomerSummary: true (BROKEN!)"
echo "----------------------------------------------"
echo "❌ This should return customerSummary data but won't!"
curl -X POST http://localhost:3000/api/transactions \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 7500,
    "currency": "USD", 
    "customerId": "demo_user_2",
    "paymentMethod": "card",
    "sendCustomerSummary": true
  }' | jq '.'

echo ""
echo ""

echo "🔍 Analysis:"
echo "- Notice that both responses are identical"
echo "- The 'customerSummary' field is missing in the second response"
echo "- This is the bug you need to fix!"
echo ""
echo "📖 See SETUP.md for detailed instructions on how to fix this." 