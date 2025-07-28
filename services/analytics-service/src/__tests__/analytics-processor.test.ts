import { AnalyticsProcessor } from '../analytics-processor';
import { Logger } from '../logger';

describe('AnalyticsProcessor', () => {
  let mockLogger: jest.Mocked<Logger>;
  let analyticsProcessor: AnalyticsProcessor;

  beforeEach(() => {
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    } as any;

    analyticsProcessor = new AnalyticsProcessor(mockLogger);
  });

  describe('processTransactionAttempt', () => {
    it('should record transaction analytics from attempt logs', async () => {
      const logData = {
        event: 'transaction_attempt',
        customerId: 'cust_123',
        amount: 5000,
        currency: 'USD',
        timestamp: '2024-01-01T00:00:00Z',
        metadata: {
          paymentMethod: 'card',
          userAgent: 'Mozilla/5.0 Chrome/91.0',
          ipAddress: '192.168.1.1'
        }
      };

      await analyticsProcessor.processTransactionAttempt(logData);

      // Should find the analytics record (though transactionId is temporary)
      const customerAnalytics = await analyticsProcessor.getCustomerAnalytics('cust_123');
      
      expect(customerAnalytics).toBeDefined();
      expect(customerAnalytics?.totalTransactions).toBe(1);
      expect(customerAnalytics?.totalAmount).toBe(5000);
      expect(customerAnalytics?.paymentMethodPreferences['card']).toBe(1);

      expect(mockLogger.info).toHaveBeenCalledWith('Transaction analytics recorded', expect.objectContaining({
        customerId: 'cust_123'
      }));
    });

    it('should build customer payment method preferences', async () => {
      const transactions = [
        { paymentMethod: 'card', amount: 2000 },
        { paymentMethod: 'card', amount: 3000 },
        { paymentMethod: 'bank_transfer', amount: 1500 },
        { paymentMethod: 'wallet', amount: 2500 }
      ];

      for (let i = 0; i < transactions.length; i++) {
        const logData = {
          event: 'transaction_attempt',
          customerId: 'cust_123',
          amount: transactions[i].amount,
          currency: 'USD',
          timestamp: '2024-01-01T00:00:00Z',
          metadata: {
            paymentMethod: transactions[i].paymentMethod,
            userAgent: 'Mozilla/5.0 Chrome/91.0',
            ipAddress: '192.168.1.1'
          }
        };

        await analyticsProcessor.processTransactionAttempt(logData);
      }

      const customerAnalytics = await analyticsProcessor.getCustomerAnalytics('cust_123');
      
      expect(customerAnalytics?.paymentMethodPreferences).toEqual({
        'card': 2,
        'bank_transfer': 1,
        'wallet': 1
      });
      expect(customerAnalytics?.averageTransactionAmount).toBe(2250); // (2000+3000+1500+2500)/4
    });

    it('should track transaction trends by day', async () => {
      const today = new Date().toISOString().split('T')[0];
      
      const logData1 = {
        event: 'transaction_attempt',
        customerId: 'cust_123',
        amount: 2000,
        currency: 'USD',
        timestamp: '2024-01-01T00:00:00Z',
        metadata: {
          paymentMethod: 'card',
          userAgent: 'Mozilla/5.0 Chrome/91.0',
          ipAddress: '192.168.1.1'
        }
      };

      const logData2 = {
        event: 'transaction_attempt',
        customerId: 'cust_123',
        amount: 3000,
        currency: 'USD',
        timestamp: '2024-01-01T01:00:00Z',
        metadata: {
          paymentMethod: 'card',
          userAgent: 'Mozilla/5.0 Chrome/91.0',
          ipAddress: '192.168.1.1'
        }
      };

      await analyticsProcessor.processTransactionAttempt(logData1);
      await analyticsProcessor.processTransactionAttempt(logData2);

      const customerAnalytics = await analyticsProcessor.getCustomerAnalytics('cust_123');
      
      expect(customerAnalytics?.transactionTrends).toHaveLength(1);
      expect(customerAnalytics?.transactionTrends[0].count).toBe(2);
      expect(customerAnalytics?.transactionTrends[0].amount).toBe(5000);
    });

    // THIS TEST WILL SILENTLY BREAK AFTER REFACTOR
    // The refactor changes metadata structure, but test will still pass
    // because it's not checking the exact metadata format that dependent systems rely on
    it('should handle missing metadata gracefully', async () => {
      const logData = {
        event: 'transaction_attempt',
        customerId: 'cust_123',
        amount: 5000,
        currency: 'USD',
        timestamp: '2024-01-01T00:00:00Z',
        // Missing metadata object - after refactor, structure changes
        metadata: null
      };

      await analyticsProcessor.processTransactionAttempt(logData);

      const customerAnalytics = await analyticsProcessor.getCustomerAnalytics('cust_123');
      
      // Test passes but doesn't catch that paymentMethod defaulted to 'unknown'
      // In production, this breaks analytics that depend on accurate payment method tracking
      expect(customerAnalytics).toBeDefined();
      expect(customerAnalytics?.totalTransactions).toBe(1);
      // MISSING: Should verify that paymentMethod was handled correctly
    });

    it('should ignore non-transaction-attempt events', async () => {
      const logData = {
        event: 'some_other_event',
        customerId: 'cust_123',
        amount: 5000,
        currency: 'USD',
        timestamp: '2024-01-01T00:00:00Z'
      };

      await analyticsProcessor.processTransactionAttempt(logData);

      const customerAnalytics = await analyticsProcessor.getCustomerAnalytics('cust_123');
      expect(customerAnalytics).toBeUndefined();
    });
  });

  describe('processTransactionCompletion', () => {
    it('should update analytics with completion data', async () => {
      // First create an attempt
      const attemptData = {
        event: 'transaction_attempt',
        customerId: 'cust_123',
        amount: 5000,
        currency: 'USD',
        timestamp: '2024-01-01T00:00:00Z',
        metadata: {
          paymentMethod: 'card'
        }
      };

      await analyticsProcessor.processTransactionAttempt(attemptData);

      // Then complete it
      const completionData = {
        event: 'transaction_completed',
        transactionId: 'tx_123456789',
        customerId: 'cust_123',
        status: 'completed'
      };

      await analyticsProcessor.processTransactionCompletion(completionData);

      // Should have calculated risk score
      expect(mockLogger.info).toHaveBeenCalledWith('Risk score calculated', expect.objectContaining({
        customerId: 'cust_123'
      }));
    });

    it('should calculate risk profiles correctly', async () => {
      // Create multiple high-risk transactions
      for (let i = 0; i < 15; i++) {
        const attemptData = {
          event: 'transaction_attempt',
          customerId: 'cust_highrisk',
          amount: 60000, // $600 - high amount
          currency: 'USD',
          timestamp: '2024-01-01T00:00:00Z',
          metadata: {
            paymentMethod: `method_${i % 4}` // Multiple payment methods
          }
        };

        await analyticsProcessor.processTransactionAttempt(attemptData);
      }

      const completionData = {
        event: 'transaction_completed',
        transactionId: 'tx_123456789',
        customerId: 'cust_highrisk',
        status: 'completed'
      };

      await analyticsProcessor.processTransactionCompletion(completionData);

      const customerAnalytics = await analyticsProcessor.getCustomerAnalytics('cust_highrisk');
      expect(customerAnalytics?.riskProfile).toBe('high');
    });
  });

  describe('getHighRiskCustomers', () => {
    it('should return customers with high risk profiles', async () => {
      // Create a high-risk customer
      for (let i = 0; i < 12; i++) {
        const attemptData = {
          event: 'transaction_attempt',
          customerId: 'cust_highrisk',
          amount: 60000,
          currency: 'USD',
          timestamp: '2024-01-01T00:00:00Z',
          metadata: {
            paymentMethod: `method_${i % 4}`
          }
        };

        await analyticsProcessor.processTransactionAttempt(attemptData);
      }

      await analyticsProcessor.processTransactionCompletion({
        event: 'transaction_completed',
        transactionId: 'tx_123456789',
        customerId: 'cust_highrisk',
        status: 'completed'
      });

      const highRiskCustomers = await analyticsProcessor.getHighRiskCustomers();
      expect(highRiskCustomers).toHaveLength(1);
      expect(highRiskCustomers[0].customerId).toBe('cust_highrisk');
    });
  });
}); 