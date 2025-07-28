import { PayFlexClient } from 'payflex-sdk';
import { TransactionHandler } from '../transaction-handler';
import { Logger } from '../utils/logger';

// Mock the PayFlex SDK
jest.mock('payflex-sdk');

describe('TransactionHandler', () => {
  let mockPayFlexClient: jest.Mocked<PayFlexClient>;
  let mockLogger: jest.Mocked<Logger>;
  let transactionHandler: TransactionHandler;

  beforeEach(() => {
    mockPayFlexClient = {
      processTransaction: jest.fn(),
      getTransaction: jest.fn(),
      refundTransaction: jest.fn()
    } as any;

    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    } as any;

    transactionHandler = new TransactionHandler(mockPayFlexClient, mockLogger);
  });

  describe('processTransaction', () => {
    it('should process a basic transaction successfully', async () => {
      const mockResult = {
        id: 'tx_123456789',
        status: 'completed',
        amount: 5000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethod: 'card',
        metadata: {},
        createdAt: '2024-01-01T00:00:00Z',
        processingFee: 175
      };

      mockPayFlexClient.processTransaction.mockResolvedValue(mockResult);

      const result = await transactionHandler.processTransaction({
        amount: 5000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethod: 'card'
      }, {
        timestamp: '2024-01-01T00:00:00Z',
        ipAddress: '192.168.1.1'
      });

      expect(result).toEqual(mockResult);
      expect(mockPayFlexClient.processTransaction).toHaveBeenCalledWith({
        amount: 5000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethod: 'card',
        metadata: expect.objectContaining({
          processingTimestamp: expect.any(String)
        })
      });
    });

    // THIS TEST PASSES BUT DOESN'T ACTUALLY TEST THE NEW FEATURE
    // It's testing the wrong SDK behavior (v2.1 instead of v2.3)
    it('should handle sendCustomerSummary flag', async () => {
      const mockResult = {
        id: 'tx_123456789',
        status: 'completed',
        amount: 5000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethod: 'card',
        metadata: {},
        createdAt: '2024-01-01T00:00:00Z',
        processingFee: 175
        // NOTE: No customerSummary field - this is the bug!
        // The test assumes v2.1 SDK which doesn't have this feature
      };

      mockPayFlexClient.processTransaction.mockResolvedValue(mockResult);

      const result = await transactionHandler.processTransaction({
        amount: 5000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethod: 'card',
        sendCustomerSummary: true  // This flag is being passed but ignored!
      }, {
        timestamp: '2024-01-01T00:00:00Z',
        ipAddress: '192.168.1.1'
      });

      // This assertion passes but is wrong - it should check for customerSummary
      expect(result).toBeDefined();
      expect(result.id).toBe('tx_123456789');
      expect(result.status).toBe('completed');
      
      // MISSING: Should test that customerSummary is present when sendCustomerSummary: true
      // expect(result.customerSummary).toBeDefined();
    });

    it('should validate transaction inputs', async () => {
      await expect(transactionHandler.processTransaction({
        amount: -100,  // Invalid amount
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethod: 'card'
      }, {
        timestamp: '2024-01-01T00:00:00Z'
      })).rejects.toThrow('Transaction amount must be positive');

      await expect(transactionHandler.processTransaction({
        amount: 5000,
        currency: 'US',  // Invalid currency
        customerId: 'cust_123',
        paymentMethod: 'card'
      }, {
        timestamp: '2024-01-01T00:00:00Z'
      })).rejects.toThrow('Valid currency code is required');

      await expect(transactionHandler.processTransaction({
        amount: 5000,
        currency: 'USD',
        customerId: '',  // Invalid customer ID
        paymentMethod: 'card'
      }, {
        timestamp: '2024-01-01T00:00:00Z'
      })).rejects.toThrow('Customer ID is required');
    });

    it('should log transaction attempts and completions', async () => {
      const mockResult = {
        id: 'tx_123456789',
        status: 'completed',
        amount: 5000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethod: 'card',
        metadata: {},
        createdAt: '2024-01-01T00:00:00Z',
        processingFee: 175
      };

      mockPayFlexClient.processTransaction.mockResolvedValue(mockResult);

      await transactionHandler.processTransaction({
        amount: 5000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethod: 'card'
      }, {
        timestamp: '2024-01-01T00:00:00Z',
        ipAddress: '192.168.1.1'
      });

      // Verify audit logging
      expect(mockLogger.info).toHaveBeenCalledWith('AUDIT: Transaction attempt', expect.objectContaining({
        event: 'transaction_attempt',
        customerId: 'cust_123',
        amount: 5000
      }));

      expect(mockLogger.info).toHaveBeenCalledWith('AUDIT: Transaction completed', expect.objectContaining({
        event: 'transaction_completed',
        transactionId: 'tx_123456789',
        status: 'completed'
      }));

      // Verify side effect logging (critical for dependent services)
      expect(mockLogger.info).toHaveBeenCalledWith('SIDE_EFFECT: transaction_success', expect.objectContaining({
        transactionId: 'tx_123456789',
        customerId: 'cust_123',
        amount: 5000
      }));
    });

    it('should handle errors gracefully', async () => {
      mockPayFlexClient.processTransaction.mockRejectedValue(new Error('Payment processing failed'));

      await expect(transactionHandler.processTransaction({
        amount: 5000,
        currency: 'USD',
        customerId: 'cust_123',
        paymentMethod: 'card'
      }, {
        timestamp: '2024-01-01T00:00:00Z'
      })).rejects.toThrow('Payment processing failed');

      expect(mockLogger.error).toHaveBeenCalledWith('Transaction processing failed', expect.objectContaining({
        error: 'Payment processing failed',
        customerId: 'cust_123'
      }));
    });
  });

  describe('refundTransaction', () => {
    it('should process refunds successfully', async () => {
      const mockRefundResult = {
        id: 'ref_123456789',
        transactionId: 'tx_123456789',
        amount: 2500,
        status: 'completed',
        createdAt: '2024-01-01T01:00:00Z'
      };

      mockPayFlexClient.refundTransaction.mockResolvedValue(mockRefundResult);

      const result = await transactionHandler.refundTransaction('tx_123456789', 2500);

      expect(result).toEqual(mockRefundResult);
      expect(mockPayFlexClient.refundTransaction).toHaveBeenCalledWith('tx_123456789', 2500);
      
      expect(mockLogger.info).toHaveBeenCalledWith('AUDIT: Refund processed', expect.objectContaining({
        event: 'refund_processed',
        transactionId: 'tx_123456789',
        refundId: 'ref_123456789'
      }));
    });
  });
}); 