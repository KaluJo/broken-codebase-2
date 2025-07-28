# 🚀 Quick Setup Guide for Juniors

Welcome! This guide will get you up and running with the Payment Service integration challenge in minutes.

## 📋 Prerequisites

Before you start, make sure you have:
- **Node.js** (v16 or higher) - [Download here](https://nodejs.org/)
- **npm** (comes with Node.js)
- A terminal/command prompt
- A code editor (VS Code recommended)

## 🏁 Step-by-Step Setup

### 1. Install Dependencies
```bash
npm install
```
This downloads all the required packages including TypeScript, Jest, Express, and the simulated PayFlex SDK.

### 2. Build the Project
```bash
npm run build
```
This compiles the TypeScript code into JavaScript in the `dist/` folder.

### 3. Start the Server
```bash
npm start
```
The server will start on `http://localhost:3000`

**OR** for development with auto-reload:
```bash
npm run dev
```

### 4. Test It Works
Open another terminal and test the health endpoint:
```bash
curl http://localhost:3000/health
```

You should see: `{"status":"healthy","timestamp":"..."}`

## 🧪 Running Tests

### Run All Tests
```bash
npm test
```
**⚠️ Important**: These tests will PASS, but they don't actually test everything! This is part of the challenge.

### Run Integration Tests
```bash
npm run test:integration
```
**⚠️ Warning**: Some of these tests will FAIL initially - this shows the real bugs!

## 🔍 Your Mission: Find and Fix the Bugs

### Test the Missing Feature

1. **Start the server**:
   ```bash
   npm run dev
   ```

2. **Test the broken feature**:
   ```bash
   curl -X POST http://localhost:3000/api/transactions \
     -H "Content-Type: application/json" \
     -d '{
       "amount": 5000,
       "currency": "USD", 
       "customerId": "cust_123",
       "paymentMethod": "card",
       "sendCustomerSummary": true
     }'
   ```

3. **What you should see**: A transaction response WITHOUT `customerSummary` field
4. **What you should get**: A response WITH `customerSummary` containing customer analytics

### The Real Challenge

The `sendCustomerSummary: true` flag should return additional customer data like:
```json
{
  "id": "tx_123...",
  "status": "completed",
  "amount": 5000,
  "customerSummary": {
    "totalTransactions": 15,
    "totalAmount": 125000,
    "loyaltyPoints": 50,
    "riskScore": 23.5,
    "preferredPaymentMethod": "card"
  }
}
```

## 🐛 What's Broken?

### 1. Missing Feature Implementation
- The `sendCustomerSummary` flag is accepted but not passed to the PayFlex SDK
- Check `src/transaction-handler.ts` around line 60

### 2. Bad Tests  
- Tests pass but don't verify the new feature works
- Check `src/__tests__/transaction-handler.test.ts` around line 70

### 3. Silent Service Breakage
When you fix the main issue, these services might break silently:
- **Billing Service**: Won't generate invoices
- **Analytics Service**: Will lose payment tracking  
- **Fraud Detection**: Will miss suspicious patterns

## 🔧 How to Debug

### Check Server Logs
When you run `npm run dev`, watch the console output for:
```
✅ "Billing record created" - Billing service working
✅ "Transaction analytics recorded" - Analytics working  
✅ "Fraud analysis completed" - Fraud detection working
```

### Check Integration Tests
```bash
npm run test:integration
```

If these fail after your changes, you've broken dependent services!

### Verify the Fix
After implementing the feature:
```bash
curl -X POST http://localhost:3000/api/transactions \
  -H "Content-Type: application/json" \
  -d '{"sendCustomerSummary": true, "amount": 5000, "currency": "USD", "customerId": "test_123", "paymentMethod": "card"}' | \
  grep customerSummary
```

Should return the customerSummary data.

## 📁 Project Structure

```
broken-codebase-2/
├── src/
│   ├── transaction-handler.ts    # 🔥 Main file to fix
│   ├── index.ts                  # Express server
│   ├── utils/logger.ts           # Logging utility
│   └── __tests__/               # Unit tests
├── services/                     # Dependent services
│   ├── billing-service/         # Invoice generation
│   ├── analytics-service/       # Transaction analytics
│   └── fraud-detection/         # Fraud monitoring
├── node_modules/payflex-sdk/    # Simulated payment SDK
└── README.md                    # Full challenge details
```

## 🎯 Success Criteria

You've completed the challenge when:

1. ✅ `sendCustomerSummary: true` returns customer analytics data
2. ✅ All original tests still pass
3. ✅ Integration tests pass
4. ✅ Billing service still generates invoices
5. ✅ Analytics service tracks payment methods correctly
6. ✅ Fraud detection still catches suspicious patterns

## 🆘 Need Help?

### Common Issues

**"Cannot find module" errors**
```bash
npm install
npm run build
```

**"Tests pass but feature doesn't work"**
- This is expected! The tests are part of the problem.
- Look at the actual API response, not just the test results.

**"Integration tests fail after my changes"**
- You've probably broken the log format that dependent services expect.
- Check the console output for error messages.

### Debugging Tips

1. **Use the dev server**: `npm run dev` shows real-time logs
2. **Check the PayFlex SDK**: Look at `node_modules/payflex-sdk/index.js` to see what the SDK actually supports
3. **Compare log formats**: Before and after your changes
4. **Test manually**: Use curl to test the API directly

## 📖 Next Steps

1. Read the full `README.md` for detailed background
2. Fix the missing feature implementation
3. Update the tests to actually test the feature  
4. Ensure dependent services keep working
5. Document your changes

Good luck! Remember: **passing tests ≠ working code** 🕵️‍♀️

---

**Pro Tip**: The real skill is noticing when things break silently. Pay attention to what the dependent services are doing! 