import { PayFlexClient, TransactionData, TransactionResult } from 'payflex-sdk';
import { Logger } from './utils/logger';

interface ProcessTransactionOptions {
  amount: number;
  currency: string;
  customerId: string;
  paymentMethod: string;
  metadata?: Record<string, any>;
  enableFraudCheck?: boolean;
  enableAnalytics?: boolean;
  sendCustomerSummary?: boolean; // This is the new feature that will be added
}

interface TransactionContext {
  transactionId?: string;
  timestamp: string;
  userAgent?: string;
  ipAddress?: string;
  deviceFingerprint?: string;
}

export class TransactionHandler {
  private payflexClient: PayFlexClient;
  private logger: Logger;

  constructor(payflexClient: PayFlexClient, logger: Logger) {
    this.payflexClient = payflexClient;
    this.logger = logger;
  }

  async processTransaction(
    options: ProcessTransactionOptions,
    context: TransactionContext
  ): Promise<TransactionResult> {
    const startTime = Date.now();
    
    try {
      this.logger.info('Starting transaction processing', {
        customerId: options.customerId,
        amount: options.amount,
        currency: options.currency
      });

      // Pre-transaction validation and logging
      await this.validateTransaction(options);
      
      // Log transaction attempt for audit trail
      await this.logTransactionAttempt(options, context);

      // Prepare transaction data for PayFlex
      const transactionData: TransactionData = {
        amount: options.amount,
        currency: options.currency,
        customerId: options.customerId,
        paymentMethod: options.paymentMethod,
        metadata: {
          ...options.metadata,
          processingTimestamp: new Date().toISOString(),
          context: context
        }
        // Note: sendCustomerSummary is NOT being passed here yet
        // This is the bug - the new feature isn't implemented
      };

      // Process the transaction
      const result = await this.payflexClient.processTransaction(transactionData);

      // Post-transaction processing
      await this.handleTransactionResult(result, options, context);

      const endTime = Date.now();
      this.logger.info('Transaction completed successfully', {
        transactionId: result.id,
        processingTime: endTime - startTime,
        customerId: options.customerId
      });

      return result;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Transaction processing failed', {
        error: errorMessage,
        customerId: options.customerId,
        amount: options.amount
      });
      throw error;
    }
  }

  private async validateTransaction(options: ProcessTransactionOptions): Promise<void> {
    if (options.amount <= 0) {
      throw new Error('Transaction amount must be positive');
    }

    if (!options.customerId) {
      throw new Error('Customer ID is required');
    }

    if (!options.currency || options.currency.length !== 3) {
      throw new Error('Valid currency code is required');
    }
  }

  private async logTransactionAttempt(
    options: ProcessTransactionOptions,
    context: TransactionContext
  ): Promise<void> {
    // This creates an audit trail that dependent services rely on
    this.logger.info('AUDIT: Transaction attempt', {
      event: 'transaction_attempt',
      customerId: options.customerId,
      amount: options.amount,
      currency: options.currency,
      timestamp: context.timestamp,
      metadata: {
        paymentMethod: options.paymentMethod,
        enableFraudCheck: options.enableFraudCheck,
        enableAnalytics: options.enableAnalytics,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent
      }
    });
  }

  private async handleTransactionResult(
    result: TransactionResult,
    options: ProcessTransactionOptions,
    context: TransactionContext
  ): Promise<void> {
    // Post-transaction side effects that dependent services rely on
    this.logger.info('AUDIT: Transaction completed', {
      event: 'transaction_completed',
      transactionId: result.id,
      customerId: result.customerId,
      amount: result.amount,
      status: result.status,
      processingFee: result.processingFee,
      timestamp: new Date().toISOString()
    });

    // This side effect is critical for dependent services
    if (result.status === 'completed') {
      this.logger.info('SIDE_EFFECT: transaction_success', {
        transactionId: result.id,
        customerId: result.customerId,
        amount: result.amount,
        currency: result.currency,
        paymentMethod: result.paymentMethod,
        processingFee: result.processingFee,
        metadata: result.metadata
      });
    }
  }

  async getTransactionHistory(customerId: string): Promise<TransactionResult[]> {
    // Simplified implementation
    return [];
  }

  async refundTransaction(transactionId: string, amount: number): Promise<any> {
    try {
      const result = await this.payflexClient.refundTransaction(transactionId, amount);
      
      this.logger.info('AUDIT: Refund processed', {
        event: 'refund_processed',
        transactionId,
        refundId: result.id,
        amount,
        timestamp: new Date().toISOString()
      });

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Refund processing failed', {
        transactionId,
        amount,
        error: errorMessage
      });
      throw error;
    }
  }
} 