import dotenv from 'dotenv';
import express from 'express';
import { PayFlexClient } from 'payflex-sdk';
import { TransactionHandler } from './transaction-handler';
import { Logger } from './utils/logger';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

// Initialize PayFlex client
const payflexClient = new PayFlexClient({
  apiKey: process.env.PAYFLEX_API_KEY!,
  secretKey: process.env.PAYFLEX_SECRET_KEY!
});

const logger = new Logger('payment-service');
const transactionHandler = new TransactionHandler(payflexClient, logger);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Process transaction endpoint
app.post('/api/transactions', async (req, res) => {
  try {
    const {
      amount,
      currency,
      customerId,
      paymentMethod,
      metadata,
      enableFraudCheck,
      enableAnalytics,
      sendCustomerSummary
    } = req.body;

    const context = {
      timestamp: new Date().toISOString(),
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
      deviceFingerprint: req.headers['x-device-fingerprint'] as string
    };

    const result = await transactionHandler.processTransaction({
      amount,
      currency,
      customerId,
      paymentMethod,
      metadata,
      enableFraudCheck,
      enableAnalytics,
      sendCustomerSummary
    }, context);

    res.json(result);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Transaction API error', { error: errorMessage });
    res.status(400).json({ error: errorMessage });
  }
});

// Get transaction endpoint
app.get('/api/transactions/:transactionId', async (req, res) => {
  try {
    const result = await payflexClient.getTransaction(req.params.transactionId);
    res.json(result);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Get transaction error', { error: errorMessage });
    res.status(404).json({ error: 'Transaction not found' });
  }
});

// Refund transaction endpoint
app.post('/api/transactions/:transactionId/refund', async (req, res) => {
  try {
    const { amount } = req.body;
    const result = await transactionHandler.refundTransaction(req.params.transactionId, amount);
    res.json(result);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Refund API error', { error: errorMessage });
    res.status(400).json({ error: errorMessage });
  }
});

app.listen(port, () => {
  logger.info(`Payment service listening on port ${port}`);
});

export { transactionHandler, payflexClient, logger }; 