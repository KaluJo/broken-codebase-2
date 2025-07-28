import { TransactionResult } from 'payflex-sdk';
import { Logger } from './logger';

interface BillingRecord {
  transactionId: string;
  customerId: string;
  amount: number;
  currency: string;
  processingFee: number;
  billingDate: string;
  status: 'pending' | 'processed' | 'failed';
  invoiceId?: string;
}

interface CustomerBilling {
  customerId: string;
  totalTransactions: number;
  totalAmount: number;
  totalFees: number;
  lastBillingDate: string;
}

export class BillingProcessor {
  private logger: Logger;
  private billingRecords: Map<string, BillingRecord> = new Map();
  private customerBilling: Map<string, CustomerBilling> = new Map();

  constructor(logger: Logger) {
    this.logger = logger;
  }

  // This method processes the SIDE_EFFECT log from transaction-handler
  async processTransactionSuccess(logData: any): Promise<void> {
    try {
      // CRITICAL: This depends on the exact log format from transaction-handler
      // The refactor will break this by changing the log structure
      if (logData.event !== 'SIDE_EFFECT: transaction_success') {
        return;
      }

      const billingRecord: BillingRecord = {
        transactionId: logData.transactionId,
        customerId: logData.customerId,
        amount: logData.amount,
        currency: logData.currency,
        processingFee: logData.processingFee,
        billingDate: new Date().toISOString(),
        status: 'pending'
      };

      // Store billing record
      this.billingRecords.set(logData.transactionId, billingRecord);

      // Update customer billing summary
      await this.updateCustomerBilling(logData.customerId, logData.amount, logData.processingFee);

      // Generate invoice if customer has accumulated enough charges
      await this.maybeGenerateInvoice(logData.customerId);

      this.logger.info('Billing record created', {
        transactionId: logData.transactionId,
        customerId: logData.customerId,
        amount: logData.amount
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Failed to process billing for transaction', {
        error: errorMessage,
        logData
      });
    }
  }

  private async updateCustomerBilling(customerId: string, amount: number, processingFee: number): Promise<void> {
    const existing = this.customerBilling.get(customerId) || {
      customerId,
      totalTransactions: 0,
      totalAmount: 0,
      totalFees: 0,
      lastBillingDate: new Date().toISOString()
    };

    existing.totalTransactions += 1;
    existing.totalAmount += amount;
    existing.totalFees += processingFee;
    existing.lastBillingDate = new Date().toISOString();

    this.customerBilling.set(customerId, existing);
  }

  private async maybeGenerateInvoice(customerId: string): Promise<void> {
    const customerData = this.customerBilling.get(customerId);
    if (!customerData) return;

    // Generate invoice if customer has $100+ in charges
    if (customerData.totalAmount >= 10000) { // $100 in cents
      const invoiceId = `inv_${Date.now()}_${customerId}`;
      
      // Mark all pending billing records as processed
      for (const [transactionId, record] of this.billingRecords.entries()) {
        if (record.customerId === customerId && record.status === 'pending') {
          record.status = 'processed';
          record.invoiceId = invoiceId;
          this.billingRecords.set(transactionId, record);
        }
      }

      this.logger.info('Invoice generated', {
        invoiceId,
        customerId,
        totalAmount: customerData.totalAmount,
        totalTransactions: customerData.totalTransactions
      });

      // Reset customer billing
      this.customerBilling.delete(customerId);
    }
  }

  async getBillingRecord(transactionId: string): Promise<BillingRecord | undefined> {
    return this.billingRecords.get(transactionId);
  }

  async getCustomerBilling(customerId: string): Promise<CustomerBilling | undefined> {
    return this.customerBilling.get(customerId);
  }

  async getAllPendingBilling(): Promise<BillingRecord[]> {
    return Array.from(this.billingRecords.values()).filter(record => record.status === 'pending');
  }
} 