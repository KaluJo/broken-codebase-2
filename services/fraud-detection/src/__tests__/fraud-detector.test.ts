import { FraudDetector } from '../fraud-detector';
import { Logger } from '../logger';

describe('FraudDetector', () => {
  let mockLogger: jest.Mocked<Logger>;
  let fraudDetector: FraudDetector;

  beforeEach(() => {
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    } as any;

    fraudDetector = new FraudDetector(mockLogger);
  });

  describe('analyzeTransaction', () => {
    it('should analyze transactions for fraud patterns', async () => {
      const logData = {
        event: 'transaction_attempt',
        customerId: 'cust_123',
        amount: 5000,
        timestamp: '2024-01-01T00:00:00Z',
        metadata: {
          paymentMethod: 'card',
          ipAddress: '192.168.1.1',
          userAgent: 'Mozilla/5.0 Chrome/91.0'
        }
      };

      await fraudDetector.analyzeTransaction(logData);

      expect(mockLogger.info).toHaveBeenCalledWith('Fraud analysis completed', expect.objectContaining({
        customerId: 'cust_123',
        amount: 5000
      }));
    });

    it('should detect velocity fraud - too many transactions per hour', async () => {
      const baseTimestamp = new Date('2024-01-01T00:00:00Z').getTime();

      // Create 6 transactions in one hour (triggers velocity alert at 5+)
      for (let i = 0; i < 6; i++) {
        const logData = {
          event: 'transaction_attempt',
          customerId: 'cust_velocity',
          amount: 1000,
          timestamp: new Date(baseTimestamp + (i * 5 * 60 * 1000)).toISOString(), // 5 minutes apart
          metadata: {
            paymentMethod: 'card',
            ipAddress: '192.168.1.1',
            userAgent: 'Mozilla/5.0 Chrome/91.0'
          }
        };

        await fraudDetector.analyzeTransaction(logData);
      }

      // Should have created a velocity fraud alert
      expect(mockLogger.warn).toHaveBeenCalledWith('Fraud alert created', expect.objectContaining({
        customerId: 'cust_velocity',
        alertType: 'velocity',
        severity: 'high'
      }));
    });

    it('should detect amount fraud - transaction much larger than average', async () => {
      const customerId = 'cust_amount';

      // Create a few normal transactions first
      for (let i = 0; i < 3; i++) {
        const logData = {
          event: 'transaction_attempt',
          customerId,
          amount: 2000, // $20 normal transactions
          timestamp: '2024-01-01T00:00:00Z',
          metadata: {
            paymentMethod: 'card',
            ipAddress: '192.168.1.1',
            userAgent: 'Mozilla/5.0 Chrome/91.0'
          }
        };

        await fraudDetector.analyzeTransaction(logData);
      }

      // Then a much larger transaction
      const logData = {
        event: 'transaction_attempt',
        customerId,
        amount: 100000, // $1000 - 50x the average
        timestamp: '2024-01-01T01:00:00Z',
        metadata: {
          paymentMethod: 'card',
          ipAddress: '192.168.1.1',
          userAgent: 'Mozilla/5.0 Chrome/91.0'
        }
      };

      await fraudDetector.analyzeTransaction(logData);

      // Should have created an amount fraud alert
      expect(mockLogger.warn).toHaveBeenCalledWith('Fraud alert created', expect.objectContaining({
        customerId,
        alertType: 'amount',
        severity: 'high'
      }));
    });

    it('should detect pattern fraud - rapid payment method switching', async () => {
      const customerId = 'cust_pattern';
      const paymentMethods = ['card', 'bank_transfer', 'wallet'];

      // Create transactions with rapidly changing payment methods
      for (let i = 0; i < 5; i++) {
        const logData = {
          event: 'transaction_attempt',
          customerId,
          amount: 3000,
          timestamp: '2024-01-01T00:00:00Z',
          metadata: {
            paymentMethod: paymentMethods[i % 3],
            ipAddress: '192.168.1.1',
            userAgent: 'Mozilla/5.0 Chrome/91.0'
          }
        };

        await fraudDetector.analyzeTransaction(logData);
      }

      // Should have created a pattern fraud alert
      expect(mockLogger.warn).toHaveBeenCalledWith('Fraud alert created', expect.objectContaining({
        customerId,
        alertType: 'pattern',
        severity: 'medium'
      }));
    });

    it('should detect location fraud - multiple IP addresses', async () => {
      const customerId = 'cust_location';
      const ipAddresses = ['192.168.1.1', '10.0.0.1', '172.16.0.1', '203.0.113.1'];

      // Create transactions from different IP addresses
      for (let i = 0; i < 10; i++) {
        const logData = {
          event: 'transaction_attempt',
          customerId,
          amount: 2000,
          timestamp: '2024-01-01T00:00:00Z',
          metadata: {
            paymentMethod: 'card',
            ipAddress: ipAddresses[i % 4],
            userAgent: 'Mozilla/5.0 Chrome/91.0'
          }
        };

        await fraudDetector.analyzeTransaction(logData);
      }

      // Should have created a location fraud alert
      expect(mockLogger.warn).toHaveBeenCalledWith('Fraud alert created', expect.objectContaining({
        customerId,
        alertType: 'location',
        severity: 'medium'
      }));
    });

    it('should create critical alerts for very high amounts', async () => {
      const logData = {
        event: 'transaction_attempt',
        customerId: 'cust_critical',
        amount: 100000, // Large transaction
        timestamp: '2024-01-01T00:00:00Z',
        metadata: {
          paymentMethod: 'card',
          ipAddress: '192.168.1.1',
          userAgent: 'Mozilla/5.0 Chrome/91.0'
        }
      };

      // Create multiple large transactions quickly to trigger critical velocity alert
      const baseTimestamp = new Date('2024-01-01T00:00:00Z').getTime();
      for (let i = 0; i < 3; i++) {
        const criticalLogData = {
          ...logData,
          timestamp: new Date(baseTimestamp + (i * 10 * 60 * 1000)).toISOString() // 10 minutes apart
        };
        await fraudDetector.analyzeTransaction(criticalLogData);
      }

      // Should log critical alert
      expect(mockLogger.error).toHaveBeenCalledWith('CRITICAL FRAUD ALERT - BLOCKING CUSTOMER', expect.objectContaining({
        customerId: 'cust_critical'
      }));
    });

    // THIS TEST WILL PASS BUT MISS THE SILENT BREAKAGE
    // After refactor, the metadata structure changes and fraud detection breaks
    // but this test doesn't catch it because it's too shallow
    it('should handle missing metadata gracefully', async () => {
      const logData = {
        event: 'transaction_attempt',
        customerId: 'cust_123',
        amount: 5000,
        timestamp: '2024-01-01T00:00:00Z',
        // After refactor: metadata structure changes from flat to nested
        // Old: metadata: { paymentMethod: 'card', ipAddress: '...' }
        // New: metadata: { context: { ipAddress: '...' }, paymentMethod: 'card' }
        metadata: undefined
      };

      await fraudDetector.analyzeTransaction(logData);

      // Test passes because it doesn't verify fraud detection actually worked
      expect(mockLogger.info).toHaveBeenCalledWith('Fraud analysis completed', expect.any(Object));
      
      // MISSING: Should verify that fraud rules actually ran with correct data
      // After refactor, fraud detection silently fails due to changed metadata structure
    });

    it('should ignore non-transaction-attempt events', async () => {
      const logData = {
        event: 'some_other_event',
        customerId: 'cust_123',
        amount: 5000,
        timestamp: '2024-01-01T00:00:00Z'
      };

      await fraudDetector.analyzeTransaction(logData);

      // Should not have created any alerts or fraud profiles
      const alerts = await fraudDetector.getFraudAlerts('cust_123');
      const profile = await fraudDetector.getCustomerFraudProfile('cust_123');
      
      expect(alerts).toHaveLength(0);
      expect(profile).toBeUndefined();
    });
  });

  describe('fraud profile management', () => {
    it('should build and update customer fraud profiles', async () => {
      const customerId = 'cust_profile';

      // Create some transactions that will generate alerts
      for (let i = 0; i < 7; i++) {
        const logData = {
          event: 'transaction_attempt',
          customerId,
          amount: 80000, // High amount
          timestamp: '2024-01-01T00:00:00Z',
          metadata: {
            paymentMethod: 'card',
            ipAddress: '192.168.1.1',
            userAgent: 'Mozilla/5.0 Chrome/91.0'
          }
        };

        await fraudDetector.analyzeTransaction(logData);
      }

      const fraudProfile = await fraudDetector.getCustomerFraudProfile(customerId);
      
      expect(fraudProfile).toBeDefined();
      expect(fraudProfile?.customerId).toBe(customerId);
      expect(fraudProfile?.totalAlerts).toBeGreaterThan(0);
      expect(fraudProfile?.fraudScore).toBeGreaterThan(0);
    });

    it('should allow resolving fraud alerts', async () => {
      const logData = {
        event: 'transaction_attempt',
        customerId: 'cust_resolve',
        amount: 600000, // $6000 - triggers large amount alert
        timestamp: '2024-01-01T00:00:00Z',
        metadata: {
          paymentMethod: 'card',
          ipAddress: '192.168.1.1',
          userAgent: 'Mozilla/5.0 Chrome/91.0'
        }
      };

      await fraudDetector.analyzeTransaction(logData);

      const alerts = await fraudDetector.getFraudAlerts('cust_resolve');
      expect(alerts).toHaveLength(1);
      
      const alertId = alerts[0].id;
      await fraudDetector.resolveAlert(alertId, false);

      const resolvedAlerts = await fraudDetector.getFraudAlerts('cust_resolve');
      expect(resolvedAlerts[0].resolved).toBe(true);
      expect(resolvedAlerts[0].falsePositive).toBe(false);
    });
  });
}); 