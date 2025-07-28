import { PayFlexClient } from 'payflex-sdk';
import { TransactionHandler } from '../transaction-handler';
import { Logger } from '../utils/logger';
import { BillingProcessor } from '../../services/billing-service/src/billing-processor';
import { Logger as BillingLogger } from '../../services/billing-service/src/logger';
import { AnalyticsProcessor } from '../../services/analytics-service/src/analytics-processor';
import { Logger as AnalyticsLogger } from '../../services/analytics-service/src/logger';
import { FraudDetector } from '../../services/fraud-detection/src/fraud-detector';
import { Logger as FraudLogger } from '../../services/fraud-detection/src/logger';

describe('Payment Service Integration', () => {
  let payflexClient: PayFlexClient;
  let transactionHandler: TransactionHandler;
  let logger: Logger;
  let billingProcessor: BillingProcessor;
  let analyticsProcessor: AnalyticsProcessor;
  let fraudDetector: FraudDetector;

  beforeEach(() => {
    logger = new Logger('integration-test');
    
    // Use real PayFlex client (not mocked) to test actual SDK integration
    payflexClient = new PayFlexClient({
      apiKey: 'test_key',
      secretKey: 'test_secret'
    });
    
    transactionHandler = new TransactionHandler(payflexClient, logger);
    billingProcessor = new BillingProcessor(new BillingLogger('billing-test'));
    analyticsProcessor = new AnalyticsProcessor(new AnalyticsLogger('analytics-test'));
    fraudDetector = new FraudDetector(new FraudLogger('fraud-test'));
  });

  describe('End-to-End Transaction Processing', () => {
    it('should process a complete transaction workflow with all dependent services', async () => {
      const transactionOptions = {
        amount: 5000,
        currency: 'USD',
        customerId: 'cust_integration_test',
        paymentMethod: 'card',
        enableFraudCheck: true,
        enableAnalytics: true,
        sendCustomerSummary: false // Start with false
      };

      const context = {
        timestamp: new Date().toISOString(),
        userAgent: 'Mozilla/5.0 (Test Browser)',
        ipAddress: '192.168.1.100',
        deviceFingerprint: 'test_device_123'
      };

      // Mock console methods to capture logs
      const logs: any[] = [];
      const originalLog = console.log;
      console.log = (data) => {
        try {
          logs.push(JSON.parse(data));
        } catch (e) {
          logs.push(data);
        }
      };

      try {
        // Process the transaction
        const result = await transactionHandler.processTransaction(transactionOptions, context);

        // Verify basic transaction success
        expect(result).toBeDefined();
        expect(result.id).toMatch(/^tx_/);
        expect(result.status).toBe('completed');
        expect(result.amount).toBe(5000);

        // Extract logs for dependent services
        const auditLogs = logs.filter(log => 
          typeof log === 'object' && log.message && log.message.startsWith('AUDIT:')
        );
        const sideEffectLogs = logs.filter(log => 
          typeof log === 'object' && log.message && log.message.startsWith('SIDE_EFFECT:')
        );

        // Verify audit trail exists
        expect(auditLogs.length).toBeGreaterThan(0);
        
        const transactionAttemptLog = auditLogs.find(log => log.event === 'transaction_attempt');
        const transactionCompletedLog = auditLogs.find(log => log.event === 'transaction_completed');
        
        expect(transactionAttemptLog).toBeDefined();
        expect(transactionCompletedLog).toBeDefined();

        // Verify side effects for billing service
        expect(sideEffectLogs.length).toBeGreaterThan(0);
        const sideEffectLog = sideEffectLogs.find(log => 
          log.message === 'SIDE_EFFECT: transaction_success'
        );
        expect(sideEffectLog).toBeDefined();

        // Process with dependent services
        if (transactionAttemptLog) {
          await analyticsProcessor.processTransactionAttempt(transactionAttemptLog);
          await fraudDetector.analyzeTransaction(transactionAttemptLog);
        }

        if (transactionCompletedLog) {
          await analyticsProcessor.processTransactionCompletion(transactionCompletedLog);
        }

        if (sideEffectLog) {
          await billingProcessor.processTransactionSuccess(sideEffectLog);
        }

        // Verify dependent services processed correctly
        const customerAnalytics = await analyticsProcessor.getCustomerAnalytics('cust_integration_test');
        const customerBilling = await billingProcessor.getBillingRecord(result.id);
        const fraudProfile = await fraudDetector.getCustomerFraudProfile('cust_integration_test');

        expect(customerAnalytics).toBeDefined();
        expect(customerAnalytics?.totalTransactions).toBe(1);
        expect(customerAnalytics?.paymentMethodPreferences['card']).toBe(1);

        expect(customerBilling).toBeDefined();
        expect(customerBilling?.amount).toBe(5000);
        expect(customerBilling?.status).toBe('pending');

        // Fraud detection should have processed (though no alerts expected for normal transaction)
        // The fraud profile might not exist for a single normal transaction

      } finally {
        console.log = originalLog;
      }
    });

    // THIS TEST WILL FAIL AFTER REFACTOR - it demonstrates the breakage
    it('should demonstrate sendCustomerSummary feature with proper SDK integration', async () => {
      const transactionOptions = {
        amount: 7500,
        currency: 'USD', 
        customerId: 'cust_summary_test',
        paymentMethod: 'card',
        sendCustomerSummary: true // This is the new feature!
      };

      const context = {
        timestamp: new Date().toISOString(),
        userAgent: 'Mozilla/5.0 (Test Browser)',
        ipAddress: '192.168.1.101'
      };

      const result = await transactionHandler.processTransaction(transactionOptions, context);

      // These assertions will FAIL initially because the feature isn't implemented
      expect(result.customerSummary).toBeDefined();
      expect(result.customerSummary?.totalTransactions).toBeGreaterThan(0);
      expect(result.customerSummary?.loyaltyPoints).toBeDefined();
      expect(result.customerSummary?.riskScore).toBeDefined();
      expect(result.customerSummary?.preferredPaymentMethod).toBeDefined();
    });

    it('should maintain dependent service compatibility during high transaction volume', async () => {
      const customerId = 'cust_volume_test';
      let allLogs: any[] = [];

      // Mock console to capture all logs
      const originalLog = console.log;
      console.log = (data) => {
        try {
          allLogs.push(JSON.parse(data));
        } catch (e) {
          allLogs.push(data);
        }
      };

      try {
                 // Process multiple transactions to test system under load
         const transactions: any[] = [];
         for (let i = 0; i < 5; i++) {
          const transactionOptions = {
            amount: 2000 + (i * 500),
            currency: 'USD',
            customerId,
            paymentMethod: i % 2 === 0 ? 'card' : 'bank_transfer',
            enableFraudCheck: true,
            enableAnalytics: true
          };

          const context = {
            timestamp: new Date(Date.now() + (i * 1000)).toISOString(),
            userAgent: 'Mozilla/5.0 (Test Browser)',
            ipAddress: `192.168.1.${100 + i}`
          };

          const result = await transactionHandler.processTransaction(transactionOptions, context);
          transactions.push(result);
        }

        // Verify all transactions succeeded
        expect(transactions).toHaveLength(5);
                 transactions.forEach((tx: any) => {
           expect(tx.status).toBe('completed');
         });

        // Process logs with dependent services
        const auditLogs = allLogs.filter(log => 
          typeof log === 'object' && log.message && log.message.startsWith('AUDIT:')
        );
        const sideEffectLogs = allLogs.filter(log => 
          typeof log === 'object' && log.message === 'SIDE_EFFECT: transaction_success'
        );

        // Should have audit logs for each transaction (attempt + completion)
        expect(auditLogs.length).toBe(10); // 5 attempts + 5 completions

        // Should have side effect logs for billing
        expect(sideEffectLogs.length).toBe(5);

        // Process with all dependent services
        for (const log of auditLogs) {
          if (log.event === 'transaction_attempt') {
            await analyticsProcessor.processTransactionAttempt(log);
            await fraudDetector.analyzeTransaction(log);
          } else if (log.event === 'transaction_completed') {
            await analyticsProcessor.processTransactionCompletion(log);
          }
        }

        for (const log of sideEffectLogs) {
          await billingProcessor.processTransactionSuccess(log);
        }

        // Verify dependent services processed all transactions
        const customerAnalytics = await analyticsProcessor.getCustomerAnalytics(customerId);
        expect(customerAnalytics?.totalTransactions).toBe(5);
        
        // Should have tracked both payment methods
        expect(customerAnalytics?.paymentMethodPreferences['card']).toBe(3);
        expect(customerAnalytics?.paymentMethodPreferences['bank_transfer']).toBe(2);

        // Check billing processed all transactions
        const allPendingBilling = await billingProcessor.getAllPendingBilling();
        const customerBilling = allPendingBilling.filter(b => b.customerId === customerId);
        expect(customerBilling).toHaveLength(5);

        // Fraud detection should have built a profile
        const fraudProfile = await fraudDetector.getCustomerFraudProfile(customerId);
        expect(fraudProfile).toBeDefined();

      } finally {
        console.log = originalLog;
      }
    });

    // This test will reveal silent breakage after refactor
    it('should detect when log format changes break dependent services', async () => {
      const transactionOptions = {
        amount: 3000,
        currency: 'USD',
        customerId: 'cust_log_format_test',
        paymentMethod: 'wallet'
      };

      const context = {
        timestamp: new Date().toISOString(),
        userAgent: 'Mozilla/5.0 (Format Test)',
        ipAddress: '192.168.1.200'
      };

      const logs: any[] = [];
      const originalLog = console.log;
      console.log = (data) => {
        try {
          logs.push(JSON.parse(data));
        } catch (e) {
          logs.push(data);
        }
      };

      try {
        await transactionHandler.processTransaction(transactionOptions, context);

        // Verify the exact log formats that dependent services expect
        const sideEffectLog = logs.find(log => 
          typeof log === 'object' && 
          log.message === 'SIDE_EFFECT: transaction_success'
        );

        // This assertion will break if refactor changes log format
        expect(sideEffectLog).toBeDefined();
        expect(sideEffectLog.transactionId).toBeDefined();
        expect(sideEffectLog.customerId).toBe('cust_log_format_test');
        expect(sideEffectLog.paymentMethod).toBe('wallet');

        const attemptLog = logs.find(log => 
          typeof log === 'object' && 
          log.event === 'transaction_attempt'
        );

        // Verify metadata structure for analytics/fraud services
        expect(attemptLog).toBeDefined();
        expect(attemptLog.metadata).toBeDefined();
        expect(attemptLog.metadata.paymentMethod).toBe('wallet');
        expect(attemptLog.metadata.userAgent).toBe('Mozilla/5.0 (Format Test)');
        expect(attemptLog.metadata.ipAddress).toBe('192.168.1.200');

        // Process with dependent services to verify they work
        await billingProcessor.processTransactionSuccess(sideEffectLog);
        await analyticsProcessor.processTransactionAttempt(attemptLog);
        await fraudDetector.analyzeTransaction(attemptLog);

        // Verify services processed successfully
        const analytics = await analyticsProcessor.getCustomerAnalytics('cust_log_format_test');
        expect(analytics?.paymentMethodPreferences['wallet']).toBe(1);

      } finally {
        console.log = originalLog;
      }
    });
  });
}); 