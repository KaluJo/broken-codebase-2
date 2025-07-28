import { BillingProcessor } from '../billing-processor';
import { Logger } from '../logger';

describe('BillingProcessor', () => {
  let mockLogger: jest.Mocked<Logger>;
  let billingProcessor: BillingProcessor;

  beforeEach(() => {
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    } as any;

    billingProcessor = new BillingProcessor(mockLogger);
  });

  describe('processTransactionSuccess', () => {
    it('should create billing records from transaction success logs', async () => {
      const logData = {
        event: 'SIDE_EFFECT: transaction_success',
        transactionId: 'tx_123456789',
        customerId: 'cust_123',
        amount: 5000,
        currency: 'USD',
        paymentMethod: 'card',
        processingFee: 175,
        metadata: {}
      };

      await billingProcessor.processTransactionSuccess(logData);

      const billingRecord = await billingProcessor.getBillingRecord('tx_123456789');
      
      expect(billingRecord).toBeDefined();
      expect(billingRecord?.transactionId).toBe('tx_123456789');
      expect(billingRecord?.customerId).toBe('cust_123');
      expect(billingRecord?.amount).toBe(5000);
      expect(billingRecord?.processingFee).toBe(175);
      expect(billingRecord?.status).toBe('pending');

      expect(mockLogger.info).toHaveBeenCalledWith('Billing record created', expect.objectContaining({
        transactionId: 'tx_123456789',
        customerId: 'cust_123'
      }));
    });

    it('should update customer billing summaries', async () => {
      const logData = {
        event: 'SIDE_EFFECT: transaction_success',
        transactionId: 'tx_123456789',
        customerId: 'cust_123',
        amount: 3000,
        currency: 'USD',
        paymentMethod: 'card',
        processingFee: 117,
        metadata: {}
      };

      await billingProcessor.processTransactionSuccess(logData);

      const customerBilling = await billingProcessor.getCustomerBilling('cust_123');
      
      expect(customerBilling).toBeDefined();
      expect(customerBilling?.totalTransactions).toBe(1);
      expect(customerBilling?.totalAmount).toBe(3000);
      expect(customerBilling?.totalFees).toBe(117);
    });

    it('should generate invoices when customer reaches $100 threshold', async () => {
      // Process multiple transactions to reach threshold
      const transactions = [
        { amount: 4000, processingFee: 146 },
        { amount: 3000, processingFee: 117 },
        { amount: 3500, processingFee: 132 }
      ];

      for (let i = 0; i < transactions.length; i++) {
        const logData = {
          event: 'SIDE_EFFECT: transaction_success',
          transactionId: `tx_12345678${i}`,
          customerId: 'cust_123',
          amount: transactions[i].amount,
          currency: 'USD',
          paymentMethod: 'card',
          processingFee: transactions[i].processingFee,
          metadata: {}
        };

        await billingProcessor.processTransactionSuccess(logData);
      }

      // Should have generated an invoice
      expect(mockLogger.info).toHaveBeenCalledWith('Invoice generated', expect.objectContaining({
        customerId: 'cust_123',
        totalAmount: 10500,
        totalTransactions: 3
      }));

      // All billing records should be marked as processed
      const record1 = await billingProcessor.getBillingRecord('tx_123456780');
      const record2 = await billingProcessor.getBillingRecord('tx_123456781');
      const record3 = await billingProcessor.getBillingRecord('tx_123456782');

      expect(record1?.status).toBe('processed');
      expect(record2?.status).toBe('processed');
      expect(record3?.status).toBe('processed');
      expect(record1?.invoiceId).toBeDefined();
    });

    it('should ignore non-transaction-success events', async () => {
      const logData = {
        event: 'some_other_event',
        transactionId: 'tx_123456789',
        customerId: 'cust_123',
        amount: 5000
      };

      await billingProcessor.processTransactionSuccess(logData);

      const billingRecord = await billingProcessor.getBillingRecord('tx_123456789');
      expect(billingRecord).toBeUndefined();
    });

    // THIS TEST WILL PASS BUT WILL SILENTLY BREAK AFTER REFACTOR
    // The refactor changes the log format from 'SIDE_EFFECT: transaction_success' 
    // to just 'transaction_success', breaking the billing integration
    it('should handle malformed log data gracefully', async () => {
      const malformedLogData = {
        event: 'SIDE_EFFECT: transaction_success',
        // Missing required fields
        transactionId: 'tx_123456789'
        // customerId, amount, etc. missing
      };

      await billingProcessor.processTransactionSuccess(malformedLogData);

      // Should log error but not crash
      expect(mockLogger.error).toHaveBeenCalledWith('Failed to process billing for transaction', expect.any(Object));
    });

    it('should retrieve pending billing records', async () => {
      const logData = {
        event: 'SIDE_EFFECT: transaction_success',
        transactionId: 'tx_123456789',
        customerId: 'cust_123',
        amount: 2000,
        currency: 'USD',
        paymentMethod: 'card',
        processingFee: 88,
        metadata: {}
      };

      await billingProcessor.processTransactionSuccess(logData);

      const pendingBilling = await billingProcessor.getAllPendingBilling();
      
      expect(pendingBilling).toHaveLength(1);
      expect(pendingBilling[0].transactionId).toBe('tx_123456789');
      expect(pendingBilling[0].status).toBe('pending');
    });
  });
}); 